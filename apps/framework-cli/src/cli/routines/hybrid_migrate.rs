//! Hybrid execution engine for static+dynamic migrations.
//!
//! Combines auto-apply operations (computed from the live diff) with
//! plan-worthy operations (loaded from timestamped plan files in `migrations/`).
//!
//! This module is called by both `moose migrate` and `moose prod`.

// Called by `moose migrate` (Task 6) and will be called by `moose prod` (Task 7).

use std::collections::HashMap;
use std::path::Path;

use anyhow::Result;
use tracing::{debug, info, warn};

use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure_map::{InfraChanges, InfrastructureMap};
use crate::framework::core::migration_plan::MigrationPlan;
use crate::framework::core::operation_class::{
    classify_serializable_op, has_plan_worthy_changes, OperationClass,
};
use crate::framework::core::plan::infra_changes_to_operations;
use crate::framework::core::state_storage::StateStorage;
use crate::infrastructure::olap::clickhouse::{
    check_ready, create_client, SerializableOlapOperation,
};
use crate::project::Project;
use crate::utilities::constants::MIGRATIONS_DIR;

use super::migrate::execute_operations;
use super::plan_files::{
    detect_scoped_drift, discover_plan_files, load_plan, load_state, ScopedDriftStatus,
};

/// Runs a hybrid migration: auto-apply safe operations from the live diff,
/// and merge in plan-worthy operations from reviewed plan files.
///
/// # Errors
///
/// Returns an error when:
/// - Plan-worthy operations are detected but no plan files exist and
///   `prod_auto_allow_destructive` is false.
/// - A plan file's scoped drift check reports `Drifted`.
/// - ClickHouse is unreachable or an operation fails to execute.
pub async fn execute_hybrid_migration(
    project: &Project,
    current_tables: &HashMap<String, Table>,
    target_infra_map: &InfrastructureMap,
    changes: &InfraChanges,
    state_storage: &dyn StateStorage,
    prod_auto_allow_destructive: bool,
) -> Result<()> {
    // 1. Convert high-level InfraChanges to ordered DDL operations.
    let all_ops = infra_changes_to_operations(changes, &project.clickhouse_config.db_name)?;

    if all_ops.is_empty() {
        info!("Hybrid migration: no operations to apply");
        state_storage
            .store_infrastructure_map(target_infra_map)
            .await?;
        return Ok(());
    }

    // 2. Classify using OlapChange-level classification.
    //    We must classify at the OlapChange level because the conversion to
    //    SerializableOlapOperation loses semantic information — e.g.
    //    PopulateMaterializedView becomes RawSql, which would be incorrectly
    //    classified as plan-worthy.
    let has_plan_worthy = has_plan_worthy_changes(changes);

    // 3. Resolve plan-worthy operations.
    let planned_ops: Vec<SerializableOlapOperation> = if has_plan_worthy {
        let migrations_dir = Path::new(MIGRATIONS_DIR);
        let plan_files = discover_plan_files(migrations_dir);

        if plan_files.is_empty() {
            if prod_auto_allow_destructive {
                info!(
                    "Hybrid migration: no plan files found but prod_auto_allow_destructive is \
                     enabled; proceeding with computed operations"
                );
                // Return empty vec so the merge falls back to the computed ops.
                Vec::new()
            } else {
                let destructive_descriptions: Vec<String> = all_ops
                    .iter()
                    .filter(|op| classify_serializable_op(op) == OperationClass::PlanWorthy)
                    .map(describe_op)
                    .collect();

                let summary = destructive_descriptions
                    .iter()
                    .map(|d| format!("  - {d}"))
                    .collect::<Vec<_>>()
                    .join("\n");

                anyhow::bail!(
                    "Hybrid migration blocked: {} destructive operation(s) detected but no \
                     plan files found in {}/.\n\
                     {}\n\n\
                     To proceed, either:\n  \
                     1. Run `moose generate migration` to create reviewed plan files, or\n  \
                     2. Set `prod_auto_allow_destructive = true` under [migration_config] \
                     in moose.config.toml.",
                    destructive_descriptions.len(),
                    MIGRATIONS_DIR,
                    summary,
                );
            }
        } else {
            load_and_validate_plan_files(
                migrations_dir,
                current_tables,
                &project.clickhouse_config.db_name,
            )?
        }
    } else {
        Vec::new()
    };

    // 4. Merge: preserve original dependency ordering from infra_changes_to_operations,
    //    but substitute plan-file versions for any plan-worthy slot.
    let merged_ops: Vec<SerializableOlapOperation> = if planned_ops.is_empty() {
        all_ops
    } else {
        all_ops
            .into_iter()
            .map(|op| {
                if classify_serializable_op(&op) == OperationClass::PlanWorthy {
                    planned_ops
                        .iter()
                        .find(|p| ops_match(&op, p))
                        .cloned()
                        .unwrap_or(op)
                } else {
                    op
                }
            })
            .collect()
    };

    // 5. Execute via the existing migration executor.
    let client = create_client(project.clickhouse_config.clone());
    check_ready(&client).await?;

    let plan = MigrationPlan {
        created_at: chrono::Utc::now(),
        operations: merged_ops,
    };
    execute_operations(project, &plan, &client).await?;

    // 6. Persist updated state.
    state_storage
        .store_infrastructure_map(target_infra_map)
        .await?;

    Ok(())
}

/// Loads and validates all plan files from the migrations directory.
///
/// For each plan file found:
/// 1. Loads the plan YAML.
/// 2. Loads the associated `_state.json` (derived from the plan filename stem).
/// 3. Runs scoped drift detection against the current database tables.
/// 4. Returns applicable operations, skips already-applied plans, and errors on drift.
fn load_and_validate_plan_files(
    migrations_dir: &Path,
    current_tables: &HashMap<String, Table>,
    default_database: &str,
) -> Result<Vec<SerializableOlapOperation>> {
    let plan_files = discover_plan_files(migrations_dir);
    let mut all_ops = Vec::new();

    for plan_path in &plan_files {
        let plan = load_plan(plan_path)?;

        // Derive the state file path: same stem + `_state.json`
        let stem = plan_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown");
        let state_path = migrations_dir.join(format!("{stem}_state.json"));

        let expected_tables = if state_path.exists() {
            let state = load_state(&state_path)?;
            state.tables
        } else {
            warn!(
                "No state file found at {}; treating all tables as new (no drift check)",
                state_path.display()
            );
            HashMap::new()
        };

        let drift_status = detect_scoped_drift(
            current_tables,
            &expected_tables,
            &plan.operations,
            default_database,
        );

        match drift_status {
            ScopedDriftStatus::Applicable => {
                debug!(
                    "Plan file {} is applicable ({} ops)",
                    plan_path.display(),
                    plan.operations.len()
                );
                all_ops.extend(plan.operations);
            }
            ScopedDriftStatus::AlreadyApplied => {
                info!(
                    "Plan file {} already applied, skipping",
                    plan_path.display()
                );
            }
            ScopedDriftStatus::Drifted { changed_tables } => {
                anyhow::bail!(
                    "Plan file {} cannot be applied: database drift detected on table(s): {}\n\n\
                     The current database state does not match the expected state captured \
                     when this plan was generated. Either:\n  \
                     1. Re-generate the migration plan with `moose generate migration`, or\n  \
                     2. Investigate and resolve the drift manually.",
                    plan_path.display(),
                    changed_tables.join(", "),
                );
            }
        }
    }

    Ok(all_ops)
}

/// Checks whether two operations represent the same logical change.
///
/// Compares the operation identity key, which includes all fields that
/// distinguish one operation from another of the same kind (e.g. table name
/// AND column name for column operations, not just table name).
fn ops_match(a: &SerializableOlapOperation, b: &SerializableOlapOperation) -> bool {
    op_identity(a) == op_identity(b)
}

/// Returns a string that uniquely identifies this operation for matching
/// purposes. Includes all fields that distinguish one operation from another
/// of the same kind.
fn op_identity(op: &SerializableOlapOperation) -> String {
    match op {
        SerializableOlapOperation::CreateTable { table } => {
            format!("CreateTable:{}", table.name)
        }
        SerializableOlapOperation::DropTable { table, .. } => {
            format!("DropTable:{table}")
        }
        SerializableOlapOperation::AddTableColumn { table, column, .. } => {
            format!("AddTableColumn:{}.{}", table, column.name)
        }
        SerializableOlapOperation::DropTableColumn {
            table, column_name, ..
        } => format!("DropTableColumn:{table}.{column_name}"),
        SerializableOlapOperation::ModifyTableColumn {
            table,
            after_column,
            ..
        } => format!("ModifyTableColumn:{}.{}", table, after_column.name),
        SerializableOlapOperation::RenameTableColumn {
            table,
            before_column_name,
            after_column_name,
            ..
        } => format!("RenameTableColumn:{table}.{before_column_name}->{after_column_name}"),
        SerializableOlapOperation::ModifyTableSettings { table, .. } => {
            format!("ModifyTableSettings:{table}")
        }
        SerializableOlapOperation::ModifyTableTtl { table, .. } => {
            format!("ModifyTableTtl:{table}")
        }
        SerializableOlapOperation::AddTableIndex { table, index, .. } => {
            format!("AddTableIndex:{}.{}", table, index.name)
        }
        SerializableOlapOperation::DropTableIndex {
            table, index_name, ..
        } => format!("DropTableIndex:{table}.{index_name}"),
        SerializableOlapOperation::AddTableProjection {
            table, projection, ..
        } => format!("AddTableProjection:{}.{}", table, projection.name),
        SerializableOlapOperation::DropTableProjection {
            table,
            projection_name,
            ..
        } => format!("DropTableProjection:{table}.{projection_name}"),
        SerializableOlapOperation::ModifySampleBy { table, .. } => {
            format!("ModifySampleBy:{table}")
        }
        SerializableOlapOperation::RemoveSampleBy { table, .. } => {
            format!("RemoveSampleBy:{table}")
        }
        SerializableOlapOperation::CreateMaterializedView { name, .. } => {
            format!("CreateMV:{name}")
        }
        SerializableOlapOperation::DropMaterializedView { name, .. } => {
            format!("DropMV:{name}")
        }
        SerializableOlapOperation::CreateView { name, .. } => {
            format!("CreateView:{name}")
        }
        SerializableOlapOperation::DropView { name, .. } => format!("DropView:{name}"),
        SerializableOlapOperation::RawSql { description, .. } => {
            format!("RawSql:{description}")
        }
        SerializableOlapOperation::CreateRowPolicy { policy } => {
            format!("CreateRowPolicy:{}", policy.name)
        }
        SerializableOlapOperation::DropRowPolicy { policy } => {
            format!("DropRowPolicy:{}", policy.name)
        }
    }
}

/// Returns a brief human-readable description of an operation for error messages.
fn describe_op(op: &SerializableOlapOperation) -> String {
    match op {
        SerializableOlapOperation::DropTable { table, .. } => format!("DropTable({table})"),
        SerializableOlapOperation::DropTableColumn {
            table, column_name, ..
        } => format!("DropTableColumn({table}.{column_name})"),
        SerializableOlapOperation::DropMaterializedView { name, .. } => {
            format!("DropMaterializedView({name})")
        }
        SerializableOlapOperation::DropView { name, .. } => format!("DropView({name})"),
        SerializableOlapOperation::RawSql { description, .. } => {
            format!("RawSql({description})")
        }
        other => op_identity(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType};

    fn test_column(name: &str) -> Column {
        Column {
            name: name.to_string(),
            data_type: ColumnType::String,
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
            alias: None,
        }
    }

    // Regression: ops_match must distinguish operations on the same table
    // but different columns. Before the fix, two DropTableColumn ops on
    // "AmazonReview" for different columns were considered matching because
    // op_target only returned the table name.
    #[test]
    fn ops_match_distinguishes_different_columns_on_same_table() {
        let drop_vine = SerializableOlapOperation::DropTableColumn {
            table: "AmazonReview".to_string(),
            column_name: "vine".to_string(),
            database: None,
            cluster_name: None,
        };
        let drop_total_votes = SerializableOlapOperation::DropTableColumn {
            table: "AmazonReview".to_string(),
            column_name: "total_votes".to_string(),
            database: None,
            cluster_name: None,
        };

        // Same column → match
        assert!(ops_match(&drop_vine, &drop_vine));
        // Different columns on same table → must NOT match
        assert!(!ops_match(&drop_vine, &drop_total_votes));
    }

    #[test]
    fn ops_match_distinguishes_different_column_adds_on_same_table() {
        let add_col_a = SerializableOlapOperation::AddTableColumn {
            table: "Events".to_string(),
            column: test_column("col_a"),
            after_column: None,
            database: None,
            cluster_name: None,
        };
        let add_col_b = SerializableOlapOperation::AddTableColumn {
            table: "Events".to_string(),
            column: test_column("col_b"),
            after_column: None,
            database: None,
            cluster_name: None,
        };

        assert!(ops_match(&add_col_a, &add_col_a));
        assert!(!ops_match(&add_col_a, &add_col_b));
    }

    #[test]
    fn ops_match_same_op_matches() {
        let op = SerializableOlapOperation::DropTable {
            table: "events".to_string(),
            database: None,
            cluster_name: None,
        };
        assert!(ops_match(&op, &op));
    }

    #[test]
    fn ops_match_different_op_types_dont_match() {
        let drop = SerializableOlapOperation::DropTable {
            table: "events".to_string(),
            database: None,
            cluster_name: None,
        };
        let drop_col = SerializableOlapOperation::DropTableColumn {
            table: "events".to_string(),
            column_name: "col".to_string(),
            database: None,
            cluster_name: None,
        };
        assert!(!ops_match(&drop, &drop_col));
    }
}
