use clickhouse::sql_parser::normalize_sql_for_comparison;
use clickhouse::ClickhouseChangesError;

use crate::framework::core::infrastructure::select_row_policy::SelectRowPolicy;
use crate::framework::core::infrastructure::sql_resource::SqlResource;
use crate::framework::core::lifecycle_filter::{self, LifecycleViolation};
use crate::framework::core::version_bump;
use crate::infrastructure::olap::clickhouse::TableWithUnsupportedType;
use crate::{
    framework::core::infrastructure::table::Table, framework::core::infrastructure_map::OlapChange,
    project::Project,
};

pub mod clickhouse;
pub mod clickhouse_http_client;
pub mod ddl_ordering;

#[derive(Debug, thiserror::Error)]
pub enum OlapChangesError {
    #[error("Failed to execute the changes on Clickhouse")]
    ClickhouseChanges(#[from] ClickhouseChangesError),
    #[error("Database error: {0}")]
    DatabaseError(String),
    #[error("Failed to order OLAP changes")]
    OrderingError(#[from] ddl_ordering::PlanOrderingError),

    #[error("Failed to parse ClickHouse type: {0}")]
    ClickhouseTypeParser(#[from] clickhouse::type_parser::ClickHouseTypeError),
    #[error("Failed to parse ClickHouse SQL: {0}")]
    ClickhouseSqlParse(#[from] clickhouse::sql_parser::SqlParseError),

    /// Lifecycle policy violations detected at execution boundary.
    /// This indicates a bug in the diff/filter pipeline - protected changes
    /// should have been blocked earlier.
    #[error("Lifecycle policy violations detected: {}", format_violations(.0))]
    LifecycleViolation(Vec<LifecycleViolation>),
}

fn format_violations(violations: &[LifecycleViolation]) -> String {
    violations
        .iter()
        .map(|v| v.message.clone())
        .collect::<Vec<_>>()
        .join("; ")
}

/// Trait defining operations that can be performed on an OLAP database
#[async_trait::async_trait]
pub trait OlapOperations {
    /// Retrieves all tables from the database
    ///
    /// # Arguments
    ///
    /// * `db_name` - The name of the database to list tables from
    /// * `project` - The project configuration containing the current version
    ///
    /// # Returns
    ///
    /// * `Result<(Vec<Table>, Vec<TableWithUnsupportedType>), OlapChangesError>` -
    /// A list of Table objects and a list of TableWithUnsupportedType on success, or an error if the operation fails
    ///
    /// # Errors
    ///
    /// Returns `OlapChangesError` if:
    /// - The database connection fails
    /// - The database doesn't exist
    /// - The query execution fails
    /// - Table metadata cannot be retrieved
    async fn list_tables(
        &self,
        db_name: &str,
        project: &Project,
    ) -> Result<(Vec<Table>, Vec<TableWithUnsupportedType>), OlapChangesError>;

    /// Retrieves all SQL resources (views and materialized views) from the database
    ///
    /// # Arguments
    ///
    /// * `db_name` - The name of the database to list SQL resources from
    /// * `default_database` - The default database name for resolving unqualified table references
    ///
    /// # Returns
    ///
    /// * `Result<Vec<SqlResource>, OlapChangesError>` - A list of SqlResource objects
    ///
    /// # Errors
    ///
    /// Returns `OlapChangesError` if:
    /// - The database connection fails
    /// - The database doesn't exist
    /// - The query execution fails
    /// - SQL parsing fails
    async fn list_sql_resources(
        &self,
        db_name: &str,
        default_database: &str,
    ) -> Result<Vec<SqlResource>, OlapChangesError>;

    /// Retrieves all row policies from the database that are assigned to moose_rls_role.
    ///
    /// # Arguments
    /// * `db_name` - The name of the database to list row policies from
    ///
    /// # Returns
    /// * `Result<Vec<SelectRowPolicy>, OlapChangesError>` - Row policies found in the database
    async fn list_row_policies(
        &self,
        db_name: &str,
    ) -> Result<Vec<SelectRowPolicy>, OlapChangesError>;

    /// Normalizes SQL using the database's native formatting.
    ///
    /// This is used to compare SQL statements for semantic equivalence,
    /// handling differences in formatting, parenthesization, and numeric literals.
    ///
    /// # Arguments
    /// * `sql` - The SQL string to normalize
    /// * `default_database` - The default database name to strip from the result
    ///
    /// # Returns
    /// * `Result<String, OlapChangesError>` - The normalized SQL string
    ///
    /// # Default Implementation
    /// Uses Rust-based AST normalization as a fallback.
    /// Implementations should override this to use native database normalization.
    async fn normalize_sql(
        &self,
        sql: &str,
        default_database: &str,
    ) -> Result<String, OlapChangesError> {
        // Default implementation uses Rust-based normalization
        Ok(normalize_sql_for_comparison(sql, default_database))
    }
}

/// This method dispatches the execution of the changes to the right olap storage.
/// When we have multiple storages (DuckDB, ...) this is where it goes.
///
/// # Note on Filtering
/// Filtering based on `migration_config.ignore_operations` happens BEFORE this function
/// is called, during the diff computation in `plan_changes()`. Tables are normalized
/// before diffing to prevent ignored fields (like partition_by, TTL) from triggering
/// unnecessary drop+create operations.
///
/// # Lifecycle Guard
/// Before executing any changes, this function validates that no lifecycle policy
/// violations are present. This is a defense-in-depth measure - the diff/filter
/// pipeline should have already blocked protected operations, but this guard
/// ensures that even if a bug allows a violation through, it will be caught here
/// before any changes reach the database.
pub async fn execute_changes(
    project: &Project,
    changes: &[OlapChange],
) -> Result<(), OlapChangesError> {
    // LIFECYCLE GUARD: Final safety check before execution
    // This catches any lifecycle violations that may have slipped through the
    // diff/filter pipeline. A violation here indicates a bug that should be fixed.
    let violations = lifecycle_filter::validate_lifecycle_compliance(
        changes,
        &project.clickhouse_config.db_name,
    );
    if !violations.is_empty() {
        return Err(OlapChangesError::LifecycleViolation(violations));
    };

    // Order changes based on dependencies, including database context for SQL resources
    let (teardown_plan, setup_plan) =
        ddl_ordering::order_olap_changes(changes, &project.clickhouse_config.db_name)?;

    // Execute the ordered changes
    clickhouse::execute_changes(project, &teardown_plan, &setup_plan).await?;
    Ok(())
}

/// Execute OLAP changes with version-bump awareness.
///
/// Ordering matches the plan phase:
/// 1. Teardown (non-bump drops)
/// 2. Bump creates (new tables — before setup so dependents can reference them)
/// 3. Setup (non-bump creates, including MVs/views that may reference bump tables)
/// 4. Bump backfills (old table still alive)
/// 5. Bump drops (old tables removed last)
pub async fn execute_changes_with_version_bumps(
    project: &Project,
    changes: &[OlapChange],
    version_bump_decisions: &[version_bump::VersionBumpDecision],
) -> Result<(), OlapChangesError> {
    use crate::framework::core::infrastructure_map::TableChange;

    let (_bumps, remaining_changes) = version_bump::extract_version_bumps(changes);

    let db_name = &project.clickhouse_config.db_name;

    // Lifecycle guard on non-bump changes
    let violations = lifecycle_filter::validate_lifecycle_compliance(&remaining_changes, db_name);
    if !violations.is_empty() {
        return Err(OlapChangesError::LifecycleViolation(violations));
    }

    let (teardown_plan, setup_plan) =
        ddl_ordering::order_olap_changes(&remaining_changes, db_name)?;

    // Phase 1: Teardown (non-bump drops)
    if !teardown_plan.is_empty() {
        clickhouse::execute_changes(project, &teardown_plan, &[]).await?;
    }

    // Phase 2: Bump creates (InPlace only — NewAlongside tables are created in Phase 3)
    for decision in version_bump_decisions {
        if decision.bump.kind == version_bump::VersionBumpKind::InPlace {
            let create = vec![OlapChange::Table(TableChange::Added(
                decision.bump.new_table.clone(),
            ))];
            execute_changes(project, &create).await?;
        }
    }

    // Phase 3: Setup (non-bump creates, may reference bump tables)
    if !setup_plan.is_empty() {
        clickhouse::execute_changes(project, &[], &setup_plan).await?;
    }

    // Phase 4: Backfills
    for decision in version_bump_decisions {
        if let Some(sql) = &decision.backfill_sql {
            let client = clickhouse::create_client(project.clickhouse_config.clone());
            clickhouse::run_query(sql, &client).await.map_err(|e| {
                OlapChangesError::ClickhouseChanges(ClickhouseChangesError::ClickhouseClient {
                    error: e,
                    resource: Some(format!(
                        "backfill {} → {}",
                        decision.bump.old_table.name, decision.bump.new_table.name
                    )),
                })
            })?;
        }
    }

    // Phase 5: Bump drops
    for decision in version_bump_decisions {
        if decision.old_table_disposition == version_bump::OldTableDisposition::Drop {
            let drop = vec![OlapChange::Table(TableChange::Removed(
                decision.bump.old_table.clone(),
            ))];
            execute_changes(project, &drop).await?;
        }
    }

    Ok(())
}

/// Execute OLAP changes via the InfraDelta path.
/// Ensures the RLS access-control infrastructure (role, user, grants, policy targeting)
/// matches the current config. Separated from `execute_changes` because RLS bootstrap
/// must run on every startup regardless of whether OLAP schema changed.
pub async fn bootstrap_rls(
    project: &Project,
    desired_row_policies: &[SelectRowPolicy],
) -> Result<(), OlapChangesError> {
    clickhouse::rls_bootstrap(project, desired_row_policies).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    // Filtering logic is tested in:
    // - framework/core/migration_plan.rs for operation-level filtering
    // - framework/core/plan.rs integration with normalize_table_for_diff
    // - integration tests for end-to-end validation
}
