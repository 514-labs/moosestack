//! Lifecycle-aware filtering for infrastructure changes
//!
//! This module provides functionality to filter infrastructure changes based on
//! lifecycle protection policies. It enforces that:
//! - DeletionProtected tables cannot be dropped or have columns removed
//! - ExternallyManaged tables cannot be dropped or created automatically
//! - When a drop is blocked, the corresponding create is also blocked to prevent errors
//!
//! # Position in the Pipeline
//!
//! This filter operates AFTER both:
//! 1. The diff algorithm has detected what changed (columns, ORDER BY, PARTITION BY, etc.)
//! 2. The database-specific strategy (e.g., ClickHouseTableDiffStrategy) has converted
//!    high-level changes into database-specific operations
//!
//! By this point, ORDER BY/PARTITION BY/primary key changes have already been converted
//! to `Removed` + `Added` operations by the strategy. The `TableChange::Updated` variant
//! only contains column-level changes as actual operations - the `order_by_change` and
//! `partition_by_change` fields are metadata/context, not operations to execute.
//!
//! # Design Philosophy
//!
//! This filter's job is strictly to block changes that violate lifecycle policies.
//! It does NOT re-evaluate whether changes are "meaningful" - that determination
//! was already made by the diff algorithm and strategy. Changes that pass through
//! this filter may have empty operation lists if all their operations were blocked,
//! and downstream code is expected to handle such cases gracefully.
//!
//! # Defense in Depth: Lifecycle Guard
//!
//! In addition to filtering during diff computation, this module provides a
//! `validate_lifecycle_compliance` function that acts as a final guard before
//! execution. This ensures that even if a bug allows a dangerous change through
//! the diffing logic, it will be caught and rejected before reaching the database.
//! This guard is called in `olap::execute_changes` as the last line of defense.

use crate::framework::core::infrastructure::materialized_view::MaterializedView;
use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure_map::{
    Change, ColumnChange, FilteredChange, OlapChange, TableChange,
};
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use std::collections::HashSet;

/// Result of applying lifecycle filtering to a set of changes
#[derive(Debug)]
pub struct FilterResult {
    /// Changes that passed the lifecycle filter and can be applied
    pub applied: Vec<OlapChange>,
    /// Changes that were blocked by lifecycle policies
    pub filtered: Vec<FilteredChange>,
}

/// Applies lifecycle protection rules to a set of OLAP changes
///
/// This function filters changes based on table lifecycle policies:
/// - Blocks DROP operations on DeletionProtected and ExternallyManaged tables
/// - Blocks orphan CREATE operations when their corresponding DROP was blocked
/// - Filters out column changes based on lifecycle rules
///
/// # Arguments
/// * `changes` - The changes to filter (typically from a diff strategy)
/// * `target_table` - The target table state (used to check lifecycle)
/// * `default_database` - The default database name for generating table IDs
///
/// # Returns
/// A `FilterResult` containing both applied and filtered changes
pub fn apply_lifecycle_filter(
    changes: Vec<OlapChange>,
    target_table: &Table,
    default_database: &str,
) -> FilterResult {
    let mut applied = Vec::new();
    let mut filtered = Vec::new();

    // to block orphan CREATE in DROP+CREATE pair
    let mut blocked_table_ids: HashSet<String> = HashSet::new();
    for change in changes {
        filter_single_change(
            change,
            target_table,
            default_database,
            &mut blocked_table_ids,
            &mut applied,
            &mut filtered,
        );
    }

    FilterResult { applied, filtered }
}

/// Filters a single OLAP change based on lifecycle policies
fn filter_single_change(
    change: OlapChange,
    target_table: &Table,
    default_database: &str,
    blocked_table_ids: &mut HashSet<String>,
    applied: &mut Vec<OlapChange>,
    filtered: &mut Vec<FilteredChange>,
) {
    match change {
        OlapChange::Table(TableChange::Removed(removed_table)) => {
            filter_table_removal(
                removed_table,
                target_table,
                default_database,
                blocked_table_ids,
                applied,
                filtered,
            );
        }
        OlapChange::Table(TableChange::Added(added_table)) => {
            filter_table_addition(
                added_table,
                default_database,
                blocked_table_ids,
                applied,
                filtered,
            );
        }
        OlapChange::Table(TableChange::Updated {
            name,
            column_changes,
            order_by_change,
            partition_by_change,
            before,
            after,
        }) => {
            filter_table_update(
                name,
                column_changes,
                order_by_change,
                partition_by_change,
                before,
                after,
                applied,
                filtered,
            );
        }
        _ => applied.push(change),
    }
}

/// Filters a table removal operation
fn filter_table_removal(
    removed_table: Table,
    target_table: &Table,
    default_database: &str,
    blocked_table_ids: &mut HashSet<String>,
    applied: &mut Vec<OlapChange>,
    filtered: &mut Vec<FilteredChange>,
) {
    if should_block_table_removal(&removed_table, target_table) {
        blocked_table_ids.insert(removed_table.id(default_database));
        filtered.push(create_removal_filtered_change(
            removed_table,
            target_table.life_cycle,
        ));
    } else {
        applied.push(OlapChange::Table(TableChange::Removed(removed_table)));
    }
}

/// Filters a table addition operation (blocks orphan creates)
fn filter_table_addition(
    added_table: Table,
    default_database: &str,
    blocked_table_ids: &HashSet<String>,
    applied: &mut Vec<OlapChange>,
    filtered: &mut Vec<FilteredChange>,
) {
    if blocked_table_ids.contains(&added_table.id(default_database)) {
        tracing::debug!(
            "Blocking orphan CREATE for table '{}' after blocking DROP",
            added_table.display_name()
        );
        filtered.push(create_orphan_create_filtered_change(added_table));
    } else {
        applied.push(OlapChange::Table(TableChange::Added(added_table)));
    }
}

/// Creates a FilteredChange for an orphan CREATE that was blocked
fn create_orphan_create_filtered_change(table: Table) -> FilteredChange {
    FilteredChange {
        reason: format!(
            "Table '{}' CREATE blocked because corresponding DROP was blocked",
            table.display_name()
        ),
        change: OlapChange::Table(TableChange::Added(table)),
    }
}

/// Filters a table update operation (filters column changes)
#[allow(clippy::too_many_arguments)]
fn filter_table_update(
    name: String,
    column_changes: Vec<ColumnChange>,
    order_by_change: crate::framework::core::infrastructure_map::OrderByChange,
    partition_by_change: crate::framework::core::infrastructure_map::PartitionByChange,
    before: Table,
    after: Table,
    applied: &mut Vec<OlapChange>,
    filtered: &mut Vec<FilteredChange>,
) {
    let (allowed_columns, blocked_columns) = filter_column_changes(column_changes, &after);

    // Record blocked column changes
    if !blocked_columns.is_empty() {
        filtered.push(create_column_changes_filtered_change(
            &name,
            blocked_columns,
            order_by_change.clone(),
            partition_by_change.clone(),
            before.clone(),
            after.clone(),
        ));
    }

    // Always pass through the Updated change with filtered column_changes
    applied.push(OlapChange::Table(TableChange::Updated {
        name,
        column_changes: allowed_columns,
        order_by_change,
        partition_by_change,
        before,
        after,
    }));
}

/// Creates a FilteredChange for blocked column changes
fn create_column_changes_filtered_change(
    table_name: &str,
    blocked_columns: Vec<ColumnChange>,
    order_by_change: crate::framework::core::infrastructure_map::OrderByChange,
    partition_by_change: crate::framework::core::infrastructure_map::PartitionByChange,
    before: Table,
    after: Table,
) -> FilteredChange {
    let blocked_column_names: Vec<String> = blocked_columns
        .iter()
        .map(|c| match c {
            ColumnChange::Removed(col) => col.name.clone(),
            ColumnChange::Added { column, .. } => column.name.clone(),
            ColumnChange::Updated { after: col, .. } => col.name.clone(),
        })
        .collect();

    FilteredChange {
        reason: format!(
            "Table '{}' has {:?} lifecycle - {} column change(s) blocked: {}",
            after.display_name(),
            after.life_cycle,
            blocked_column_names.len(),
            blocked_column_names.join(", ")
        ),
        change: OlapChange::Table(TableChange::Updated {
            name: table_name.to_string(),
            column_changes: blocked_columns,
            order_by_change,
            partition_by_change,
            before,
            after,
        }),
    }
}

/// Determines if a table removal should be blocked based on lifecycle policies
///
/// CRITICAL: Uses target_table lifecycle (AFTER state), not removed_table lifecycle (BEFORE state)
/// This handles transitions TO protected lifecycles (e.g., FullyManaged -> DeletionProtected)
fn should_block_table_removal(removed_table: &Table, target_table: &Table) -> bool {
    if target_table.life_cycle.is_drop_protected() {
        tracing::warn!(
            "Strategy attempted to drop {:?} table '{}' - blocking operation",
            target_table.life_cycle,
            removed_table.display_name()
        );
        true
    } else {
        false
    }
}

/// Creates a FilteredChange entry for a blocked table removal
fn create_removal_filtered_change(removed_table: Table, lifecycle: LifeCycle) -> FilteredChange {
    FilteredChange {
        reason: format!(
            "Table '{}' has {:?} lifecycle - DROP operation blocked",
            removed_table.display_name(),
            lifecycle
        ),
        change: OlapChange::Table(TableChange::Removed(removed_table)),
    }
}

/// Filters column changes to respect lifecycle protection policies.
///
/// Returns a tuple of (allowed_changes, blocked_changes) where:
/// - allowed_changes: Changes that can be applied
/// - blocked_changes: Changes that were blocked by lifecycle policies
///
/// For `ExternallyManaged` tables: blocks ALL column changes (add, remove, update)
/// For `DeletionProtected` tables: blocks only column removals
fn filter_column_changes(
    column_changes: Vec<ColumnChange>,
    after_table: &Table,
) -> (Vec<ColumnChange>, Vec<ColumnChange>) {
    // ExternallyManaged: block ALL column changes
    if after_table.life_cycle.is_any_modification_protected() {
        if !column_changes.is_empty() {
            tracing::debug!(
                "Filtered {} column changes for {:?} table '{}' (no modifications allowed)",
                column_changes.len(),
                after_table.life_cycle,
                after_table.display_name()
            );
        }
        return (Vec::new(), column_changes);
    }

    // DeletionProtected: block only column removals
    if !after_table.life_cycle.is_column_removal_protected() {
        return (column_changes, Vec::new());
    }

    let mut allowed = Vec::new();
    let mut blocked = Vec::new();

    for change in column_changes {
        if matches!(change, ColumnChange::Removed(_)) {
            blocked.push(change);
        } else {
            allowed.push(change);
        }
    }

    if !blocked.is_empty() {
        tracing::debug!(
            "Filtered {} column removals for {:?} table '{}'",
            blocked.len(),
            after_table.life_cycle,
            after_table.display_name()
        );
    }

    (allowed, blocked)
}

// ============================================================================
// LIFECYCLE GUARD - Defense in Depth
// ============================================================================
//
// The guard below is called at the execution boundary (in olap::execute_changes)
// as a final safety check. Unlike the filter above which removes disallowed
// operations during diff computation, this guard ERRORS if a violation is found.
// A violation at this point indicates a bug in the diffing/filtering logic.

/// A lifecycle violation that was detected at the execution boundary.
///
/// This represents a change that violates lifecycle policies but somehow
/// made it through the diff/filter pipeline. Finding one of these indicates
/// a bug in the earlier stages.
#[derive(Debug, Clone)]
pub struct LifecycleViolation {
    /// Human-readable description of the violation
    pub message: String,
    /// Name of the resource (table or materialized view) involved
    pub resource_name: String,
    /// Database containing the table (None means default database)
    pub database: Option<String>,
    /// The lifecycle of the table
    pub life_cycle: LifeCycle,
    /// Type of violation
    pub violation_type: ViolationType,
}

/// Types of lifecycle violations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ViolationType {
    /// Attempted to drop a protected table
    TableDrop,
    /// Attempted to remove a column from a protected table
    ColumnRemoval,
    /// Attempted to add a column to an externally managed table
    ColumnAddition,
    /// Attempted to modify a column in an externally managed table
    ColumnModification,
    /// Attempted to modify an externally managed table (generic)
    TableModification,
    /// Attempted to drop or update (DROP+CREATE) a protected materialized view
    MaterializedViewDrop,
    /// Attempted to create an externally managed materialized view
    MaterializedViewCreate,
}

impl std::fmt::Display for LifecycleViolation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

/// Validates that a set of OLAP changes comply with lifecycle policies.
///
/// This is a **guard function** meant to be called at the execution boundary
/// (in `olap::execute_changes`) as a final safety check before changes are
/// sent to the database.
///
/// Unlike `apply_lifecycle_filter` which filters out disallowed operations,
/// this function **returns an error** if any violations are found. A violation
/// at this point indicates a bug in the diff/filter pipeline that should be
/// fixed.
///
/// # Arguments
/// * `changes` - The OLAP changes about to be executed
/// * `default_database` - The default database name for computing table IDs
///
/// # Returns
/// * `Ok(())` if all changes comply with lifecycle policies
/// * `Err(Vec<LifecycleViolation>)` if any violations are found
///
/// # What is checked
/// - `TableChange::Removed` for `DeletionProtected` or `ExternallyManaged` tables
///   (checks BOTH the removed table's lifecycle AND any corresponding Added table's lifecycle
///   to catch transitions TO protected lifecycles like `FullyManaged → DeletionProtected`)
/// - `ColumnChange::Removed` for `DeletionProtected` or `ExternallyManaged` tables
/// - Any modifications (column add/update, TTL, settings) for `ExternallyManaged` tables
///
/// # Example
/// ```ignore
/// // In olap::execute_changes
/// validate_lifecycle_compliance(changes, &project.clickhouse_config.db_name)?;
/// // Only execute if validation passed
/// execute_ordered_changes(changes);
/// ```
pub fn validate_lifecycle_compliance(
    changes: &[OlapChange],
    default_database: &str,
) -> Vec<LifecycleViolation> {
    use std::collections::HashMap;

    let mut violations = Vec::new();

    // First pass: collect all Added tables and their lifecycles.
    // This allows us to check the TARGET lifecycle for Removed+Added pairs,
    // catching transitions TO protected lifecycles (e.g., FullyManaged → DeletionProtected).
    let added_table_lifecycles: HashMap<String, LifeCycle> = changes
        .iter()
        .filter_map(|change| {
            if let OlapChange::Table(TableChange::Added(table)) = change {
                // Use table ID as key for consistent matching with Removed tables
                let key = table.id(default_database);
                Some((key, table.life_cycle))
            } else {
                None
            }
        })
        .collect();

    for change in changes {
        match change {
            OlapChange::Table(table_change) => {
                check_table_change_compliance(
                    table_change,
                    default_database,
                    &added_table_lifecycles,
                    &mut violations,
                );
            }
            OlapChange::MaterializedView(mv_change) => {
                check_materialized_view_change_compliance(mv_change, &mut violations);
            }
            _ => {}
        }
    }

    if !violations.is_empty() {
        // Log all violations for debugging
        for violation in &violations {
            let table_display = match &violation.database {
                Some(db) => format!("{}.{}", db, violation.resource_name),
                None => violation.resource_name.clone(),
            };
            tracing::error!(
                "LIFECYCLE GUARD VIOLATION: {} (table: {}, lifecycle: {:?}, type: {:?})",
                violation.message,
                table_display,
                violation.life_cycle,
                violation.violation_type
            );
        }
    };
    violations
}

/// Checks a materialized view change for lifecycle violations
///
/// MV update = DROP + CREATE in ClickHouse (no ALTER MATERIALIZED VIEW for SELECT changes).
/// So both removals and updates are blocked for drop-protected MVs.
/// Additions are blocked for externally-managed MVs.
fn check_materialized_view_change_compliance(
    mv_change: &Change<MaterializedView>,
    violations: &mut Vec<LifecycleViolation>,
) {
    match mv_change {
        Change::Removed(mv) => {
            if mv.life_cycle.is_drop_protected() {
                violations.push(LifecycleViolation {
                    message: format!(
                        "Attempted to DROP materialized view '{}' which has {:?} lifecycle. \
                        This is a bug - the diff/filter pipeline should have blocked this.",
                        mv.name, mv.life_cycle
                    ),
                    resource_name: mv.name.clone(),
                    database: mv.database.clone(),
                    life_cycle: mv.life_cycle,
                    violation_type: ViolationType::MaterializedViewDrop,
                });
            }
        }
        Change::Updated { after, .. } => {
            // MV update requires DROP+CREATE - block if drop-protected
            if after.life_cycle.is_drop_protected() {
                violations.push(LifecycleViolation {
                    message: format!(
                        "Attempted to UPDATE (DROP+CREATE) materialized view '{}' which has \
                        {:?} lifecycle. This is a bug - the diff/filter pipeline should have blocked this.",
                        after.name, after.life_cycle
                    ),
                    resource_name: after.name.clone(),
                    database: after.database.clone(),
                    life_cycle: after.life_cycle,
                    violation_type: ViolationType::MaterializedViewDrop,
                });
            }
        }
        Change::Added(mv) => {
            if mv.life_cycle.is_any_modification_protected() {
                violations.push(LifecycleViolation {
                    message: format!(
                        "Attempted to CREATE materialized view '{}' which has {:?} lifecycle. \
                        This is a bug - the diff/filter pipeline should have blocked this.",
                        mv.name, mv.life_cycle
                    ),
                    resource_name: mv.name.clone(),
                    database: mv.database.clone(),
                    life_cycle: mv.life_cycle,
                    violation_type: ViolationType::MaterializedViewCreate,
                });
            }
        }
    }
}

/// Checks a single table change for lifecycle violations
fn check_table_change_compliance(
    table_change: &TableChange,
    default_database: &str,
    added_table_lifecycles: &std::collections::HashMap<String, LifeCycle>,
    violations: &mut Vec<LifecycleViolation>,
) {
    match table_change {
        TableChange::Removed(table) => {
            check_table_drop_compliance(
                table,
                default_database,
                added_table_lifecycles,
                violations,
            );
        }
        TableChange::Updated {
            name,
            column_changes,
            after,
            ..
        } => {
            check_column_changes_compliance(name, column_changes, after, violations);
        }
        TableChange::SettingsChanged { table, name, .. } => {
            check_settings_change_compliance(table, name, violations);
        }
        TableChange::TtlChanged { table, name, .. } => {
            check_ttl_change_compliance(table, name, violations);
        }
        // Added and ValidationError are allowed
        _ => {}
    }
}

/// Checks if a table drop violates lifecycle policies
///
/// The logic depends on whether this is a drop+create pair or a pure deletion:
///
/// 1. **Drop+Create pair** (Removed + Added for same table): Check only the AFTER lifecycle.
///    - If user deliberately removes protection (`DeletionProtected → FullyManaged`), allow the drop.
///    - If user adds protection (`FullyManaged → DeletionProtected`), block the drop.
///
/// 2. **Pure deletion** (Removed without corresponding Added): Check the BEFORE lifecycle.
///    - User must first change lifecycle to `FullyManaged` before deleting the model.
fn check_table_drop_compliance(
    table: &Table,
    default_database: &str,
    added_table_lifecycles: &std::collections::HashMap<String, LifeCycle>,
    violations: &mut Vec<LifecycleViolation>,
) {
    let table_id = table.id(default_database);

    // Check if there's a corresponding Added table (drop+create scenario)
    if let Some(&target_lifecycle) = added_table_lifecycles.get(&table_id) {
        // Drop+Create pair: check only the AFTER/target lifecycle
        // If user removes protection, they intend to allow the drop
        if target_lifecycle.is_drop_protected() {
            violations.push(create_table_drop_violation(table, target_lifecycle));
        }
    } else {
        // Pure deletion: check the BEFORE state (removed table's own lifecycle)
        // User must first change lifecycle to FullyManaged before deleting
        if table.life_cycle.is_drop_protected() {
            violations.push(create_table_drop_violation(table, table.life_cycle));
        }
    }
}

/// Creates a violation for an illegal table drop
///
/// The `lifecycle` parameter is the lifecycle that triggered the violation -
/// this may be either the removed table's lifecycle (BEFORE state) or the
/// target table's lifecycle (AFTER state) for drop+create transitions.
fn create_table_drop_violation(table: &Table, lifecycle: LifeCycle) -> LifecycleViolation {
    LifecycleViolation {
        message: format!(
            "Attempted to DROP table '{}' which has {:?} lifecycle. \
            This is a bug - the diff/filter pipeline should have blocked this.",
            table.display_name(),
            lifecycle
        ),
        resource_name: table.name.clone(),
        database: table.database.clone(),
        life_cycle: lifecycle,
        violation_type: ViolationType::TableDrop,
    }
}

/// Checks if column changes violate lifecycle policies
fn check_column_changes_compliance(
    table_name: &str,
    column_changes: &[ColumnChange],
    table: &Table,
    violations: &mut Vec<LifecycleViolation>,
) {
    if table.life_cycle.is_any_modification_protected() {
        // ExternallyManaged: block ALL column changes
        for column_change in column_changes {
            violations.push(create_column_change_violation(
                table_name,
                column_change,
                table,
            ));
        }
    } else if table.life_cycle.is_column_removal_protected() {
        // DeletionProtected: only block column removals
        for column_change in column_changes {
            if let ColumnChange::Removed(column) = column_change {
                violations.push(create_column_removal_violation(table_name, column, table));
            }
        }
    }
}

/// Creates a violation for an illegal column change on ExternallyManaged table
fn create_column_change_violation(
    table_name: &str,
    column_change: &ColumnChange,
    table: &Table,
) -> LifecycleViolation {
    let (col_name, violation_type) = match column_change {
        ColumnChange::Removed(col) => (col.name.clone(), ViolationType::ColumnRemoval),
        ColumnChange::Added { column, .. } => (column.name.clone(), ViolationType::ColumnAddition),
        ColumnChange::Updated { after: col, .. } => {
            (col.name.clone(), ViolationType::ColumnModification)
        }
    };

    LifecycleViolation {
        message: format!(
            "Attempted to modify column '{}' on table '{}' which has \
            {:?} lifecycle. This is a bug - the diff/filter \
            pipeline should have blocked this.",
            col_name,
            table.display_name(),
            table.life_cycle
        ),
        resource_name: table_name.to_string(),
        database: table.database.clone(),
        life_cycle: table.life_cycle,
        violation_type,
    }
}

/// Creates a violation for an illegal column removal on DeletionProtected table
fn create_column_removal_violation(
    table_name: &str,
    column: &crate::framework::core::infrastructure::table::Column,
    table: &Table,
) -> LifecycleViolation {
    LifecycleViolation {
        message: format!(
            "Attempted to DROP COLUMN '{}' from table '{}' which has \
            {:?} lifecycle. This is a bug - the diff/filter \
            pipeline should have blocked this.",
            column.name,
            table.display_name(),
            table.life_cycle
        ),
        resource_name: table_name.to_string(),
        database: table.database.clone(),
        life_cycle: table.life_cycle,
        violation_type: ViolationType::ColumnRemoval,
    }
}

/// Checks if a settings change violates lifecycle policies
fn check_settings_change_compliance(
    table: &Table,
    table_name: &str,
    violations: &mut Vec<LifecycleViolation>,
) {
    if table.life_cycle.is_any_modification_protected() {
        violations.push(create_table_modification_violation(
            table, table_name, "settings",
        ));
    }
}

/// Checks if a TTL change violates lifecycle policies
fn check_ttl_change_compliance(
    table: &Table,
    table_name: &str,
    violations: &mut Vec<LifecycleViolation>,
) {
    if table.life_cycle.is_any_modification_protected() {
        violations.push(create_table_modification_violation(
            table, table_name, "TTL",
        ));
    }
}

/// Creates a violation for an illegal table modification (settings/TTL)
fn create_table_modification_violation(
    table: &Table,
    table_name: &str,
    modification_type: &str,
) -> LifecycleViolation {
    LifecycleViolation {
        message: format!(
            "Attempted to modify {} on table '{}' which has \
            {:?} lifecycle. This is a bug - the diff/filter \
            pipeline should have blocked this.",
            modification_type,
            table.display_name(),
            table.life_cycle
        ),
        resource_name: table_name.to_string(),
        database: table.database.clone(),
        life_cycle: table.life_cycle,
        violation_type: ViolationType::TableModification,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, IntType, OrderBy};
    use crate::framework::core::infrastructure_map::{OrderByChange, PartitionByChange};
    use crate::framework::versions::Version;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

    fn create_test_table(name: &str, life_cycle: LifeCycle) -> Table {
        Table {
            name: name.to_string(),
            columns: vec![Column {
                name: "id".to_string(),
                data_type: ColumnType::Int(IntType::Int64),
                required: true,
                unique: false,
                primary_key: true,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
                codec: None,
                materialized: None,
            }],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            engine: ClickhouseEngine::MergeTree,
            version: Some(Version::from_string("1.0.0".to_string())),
            source_primitive: crate::framework::core::infrastructure_map::PrimitiveSignature {
                name: "test".to_string(),
                primitive_type:
                    crate::framework::core::infrastructure_map::PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle,
            engine_params_hash: None,
            table_settings_hash: None,
            table_settings: None,
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
        }
    }

    fn create_test_column(name: &str) -> Column {
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
        }
    }

    // =========================================================================
    // Tests for validate_lifecycle_compliance (Guard function)
    // =========================================================================

    #[test]
    fn test_guard_allows_fully_managed_table_drop() {
        let table = create_test_table("test_table", LifeCycle::FullyManaged);
        let changes = vec![OlapChange::Table(TableChange::Removed(table))];

        let result = validate_lifecycle_compliance(&changes, "test_db");
        assert!(
            result.is_empty(),
            "Should allow dropping FullyManaged tables"
        );
    }

    #[test]
    fn test_guard_blocks_deletion_protected_table_drop() {
        let table = create_test_table("protected_table", LifeCycle::DeletionProtected);
        let changes = vec![OlapChange::Table(TableChange::Removed(table))];

        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].resource_name, "protected_table");
        assert_eq!(violations[0].violation_type, ViolationType::TableDrop);
        assert_eq!(violations[0].life_cycle, LifeCycle::DeletionProtected);
    }

    #[test]
    fn test_guard_blocks_externally_managed_table_drop() {
        let table = create_test_table("external_table", LifeCycle::ExternallyManaged);
        let changes = vec![OlapChange::Table(TableChange::Removed(table))];

        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].resource_name, "external_table");
        assert_eq!(violations[0].violation_type, ViolationType::TableDrop);
        assert_eq!(violations[0].life_cycle, LifeCycle::ExternallyManaged);
    }

    #[test]
    fn test_guard_allows_column_removal_from_fully_managed() {
        let before = create_test_table("test_table", LifeCycle::FullyManaged);
        let after = create_test_table("test_table", LifeCycle::FullyManaged);
        let column = create_test_column("old_column");

        let changes = vec![OlapChange::Table(TableChange::Updated {
            name: "test_table".to_string(),
            column_changes: vec![ColumnChange::Removed(column)],
            order_by_change: OrderByChange {
                before: OrderBy::Fields(vec![]),
                after: OrderBy::Fields(vec![]),
            },
            partition_by_change: PartitionByChange {
                before: None,
                after: None,
            },
            before,
            after,
        })];

        let result = validate_lifecycle_compliance(&changes, "test_db");
        assert!(
            result.is_empty(),
            "Should allow column removal from FullyManaged tables"
        );
    }

    #[test]
    fn test_guard_blocks_column_removal_from_deletion_protected() {
        let before = create_test_table("protected_table", LifeCycle::DeletionProtected);
        let after = create_test_table("protected_table", LifeCycle::DeletionProtected);
        let column = create_test_column("sensitive_column");

        let changes = vec![OlapChange::Table(TableChange::Updated {
            name: "protected_table".to_string(),
            column_changes: vec![ColumnChange::Removed(column)],
            order_by_change: OrderByChange {
                before: OrderBy::Fields(vec![]),
                after: OrderBy::Fields(vec![]),
            },
            partition_by_change: PartitionByChange {
                before: None,
                after: None,
            },
            before,
            after,
        })];

        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].resource_name, "protected_table");
        assert_eq!(violations[0].violation_type, ViolationType::ColumnRemoval);
    }

    #[test]
    fn test_guard_allows_column_addition_to_deletion_protected() {
        let before = create_test_table("protected_table", LifeCycle::DeletionProtected);
        let after = create_test_table("protected_table", LifeCycle::DeletionProtected);
        let column = create_test_column("new_column");

        let changes = vec![OlapChange::Table(TableChange::Updated {
            name: "protected_table".to_string(),
            column_changes: vec![ColumnChange::Added {
                column,
                position_after: None,
            }],
            order_by_change: OrderByChange {
                before: OrderBy::Fields(vec![]),
                after: OrderBy::Fields(vec![]),
            },
            partition_by_change: PartitionByChange {
                before: None,
                after: None,
            },
            before,
            after,
        })];

        let result = validate_lifecycle_compliance(&changes, "test_db");
        assert!(
            result.is_empty(),
            "Should allow adding columns to DeletionProtected tables"
        );
    }

    #[test]
    fn test_guard_collects_multiple_violations() {
        let table1 = create_test_table("protected_table1", LifeCycle::DeletionProtected);
        let table2 = create_test_table("external_table", LifeCycle::ExternallyManaged);

        let changes = vec![
            OlapChange::Table(TableChange::Removed(table1)),
            OlapChange::Table(TableChange::Removed(table2)),
        ];

        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 2, "Should collect all violations");
        assert!(violations
            .iter()
            .any(|v| v.resource_name == "protected_table1"));
        assert!(violations
            .iter()
            .any(|v| v.resource_name == "external_table"));
    }

    #[test]
    fn test_guard_allows_table_addition() {
        let table = create_test_table("new_table", LifeCycle::FullyManaged);
        let changes = vec![OlapChange::Table(TableChange::Added(table))];

        let result = validate_lifecycle_compliance(&changes, "test_db");
        assert!(result.is_empty(), "Should allow table additions");
    }

    /// Tests the critical case where the guard catches a lifecycle TRANSITION
    /// to a protected state during a drop+create operation.
    ///
    /// Scenario: A table transitions from FullyManaged → DeletionProtected
    /// (e.g., user adds @DeletionProtected annotation and also changes ORDER BY)
    ///
    /// The strategy converts this to Removed(old_table) + Added(new_table).
    /// The old_table has FullyManaged lifecycle, the new_table has DeletionProtected.
    /// The guard must check the TARGET lifecycle, not just the removed table's lifecycle.
    #[test]
    fn test_guard_blocks_transition_to_deletion_protected() {
        // Before: FullyManaged table
        let removed_table = create_test_table("transitioning_table", LifeCycle::FullyManaged);
        // After: Same table but now DeletionProtected (plus some structural change)
        let added_table = create_test_table("transitioning_table", LifeCycle::DeletionProtected);

        let changes = vec![
            OlapChange::Table(TableChange::Removed(removed_table)),
            OlapChange::Table(TableChange::Added(added_table)),
        ];

        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].resource_name, "transitioning_table");
        assert_eq!(violations[0].violation_type, ViolationType::TableDrop);
        // The violation should report the TARGET lifecycle, not the old one
        assert_eq!(violations[0].life_cycle, LifeCycle::DeletionProtected);
    }

    /// Tests transition to ExternallyManaged during drop+create
    #[test]
    fn test_guard_blocks_transition_to_externally_managed() {
        let removed_table = create_test_table("transitioning_table", LifeCycle::FullyManaged);
        let added_table = create_test_table("transitioning_table", LifeCycle::ExternallyManaged);

        let changes = vec![
            OlapChange::Table(TableChange::Removed(removed_table)),
            OlapChange::Table(TableChange::Added(added_table)),
        ];

        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].life_cycle, LifeCycle::ExternallyManaged);
    }

    /// Ensures that normal drop+create (both FullyManaged) is still allowed
    #[test]
    fn test_guard_allows_fully_managed_drop_create() {
        let removed_table = create_test_table("test_table", LifeCycle::FullyManaged);
        let added_table = create_test_table("test_table", LifeCycle::FullyManaged);

        let changes = vec![
            OlapChange::Table(TableChange::Removed(removed_table)),
            OlapChange::Table(TableChange::Added(added_table)),
        ];

        let result = validate_lifecycle_compliance(&changes, "test_db");
        assert!(
            result.is_empty(),
            "Should allow drop+create for FullyManaged tables"
        );
    }

    /// Tests that deliberately removing protection allows the drop+create.
    ///
    /// Scenario: User removes @DeletionProtected annotation AND makes a structural change.
    /// The user explicitly intends to allow the table to be dropped.
    #[test]
    fn test_guard_allows_removal_of_protection() {
        // Before: DeletionProtected table
        let removed_table = create_test_table("transitioning_table", LifeCycle::DeletionProtected);
        // After: User removed the protection annotation (plus some structural change)
        let added_table = create_test_table("transitioning_table", LifeCycle::FullyManaged);

        let changes = vec![
            OlapChange::Table(TableChange::Removed(removed_table)),
            OlapChange::Table(TableChange::Added(added_table)),
        ];

        let result = validate_lifecycle_compliance(&changes, "test_db");
        assert!(
            result.is_empty(),
            "Should allow drop+create when user deliberately removes protection"
        );
    }

    /// Tests that removing ExternallyManaged allows the drop+create
    #[test]
    fn test_guard_allows_removal_of_externally_managed() {
        let removed_table = create_test_table("transitioning_table", LifeCycle::ExternallyManaged);
        let added_table = create_test_table("transitioning_table", LifeCycle::FullyManaged);

        let changes = vec![
            OlapChange::Table(TableChange::Removed(removed_table)),
            OlapChange::Table(TableChange::Added(added_table)),
        ];

        let result = validate_lifecycle_compliance(&changes, "test_db");
        assert!(
            result.is_empty(),
            "Should allow drop+create when user deliberately removes ExternallyManaged"
        );
    }

    #[test]
    fn test_guard_allows_ttl_change() {
        let table = create_test_table("test_table", LifeCycle::DeletionProtected);
        let changes = vec![OlapChange::Table(TableChange::TtlChanged {
            name: "test_table".to_string(),
            before: Some("timestamp + INTERVAL 1 DAY".to_string()),
            after: Some("timestamp + INTERVAL 7 DAY".to_string()),
            table,
        })];

        let result = validate_lifecycle_compliance(&changes, "test_db");
        assert!(
            result.is_empty(),
            "Should allow TTL changes on protected tables"
        );
    }

    #[test]
    fn test_guard_allows_settings_change() {
        let table = create_test_table("test_table", LifeCycle::DeletionProtected);
        let changes = vec![OlapChange::Table(TableChange::SettingsChanged {
            name: "test_table".to_string(),
            before_settings: None,
            after_settings: Some([("index_granularity".to_string(), "8192".to_string())].into()),
            table,
        })];

        let result = validate_lifecycle_compliance(&changes, "test_db");
        assert!(
            result.is_empty(),
            "Should allow settings changes on protected tables"
        );
    }

    #[test]
    fn test_guard_empty_changes() {
        let changes: Vec<OlapChange> = vec![];

        let result = validate_lifecycle_compliance(&changes, "test_db");
        assert!(result.is_empty(), "Empty changes should pass validation");
    }

    // =========================================================================
    // Tests for ExternallyManaged protection (no modifications allowed)
    // =========================================================================

    #[test]
    fn test_guard_blocks_column_removal_from_externally_managed() {
        let before = create_test_table("external_table", LifeCycle::ExternallyManaged);
        let after = create_test_table("external_table", LifeCycle::ExternallyManaged);
        let column = create_test_column("some_column");

        let changes = vec![OlapChange::Table(TableChange::Updated {
            name: "external_table".to_string(),
            column_changes: vec![ColumnChange::Removed(column)],
            order_by_change: OrderByChange {
                before: OrderBy::Fields(vec![]),
                after: OrderBy::Fields(vec![]),
            },
            partition_by_change: PartitionByChange {
                before: None,
                after: None,
            },
            before,
            after,
        })];

        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].violation_type, ViolationType::ColumnRemoval);
        assert_eq!(violations[0].life_cycle, LifeCycle::ExternallyManaged);
    }

    #[test]
    fn test_guard_blocks_column_addition_to_externally_managed() {
        let before = create_test_table("external_table", LifeCycle::ExternallyManaged);
        let after = create_test_table("external_table", LifeCycle::ExternallyManaged);
        let column = create_test_column("new_column");

        let changes = vec![OlapChange::Table(TableChange::Updated {
            name: "external_table".to_string(),
            column_changes: vec![ColumnChange::Added {
                column,
                position_after: None,
            }],
            order_by_change: OrderByChange {
                before: OrderBy::Fields(vec![]),
                after: OrderBy::Fields(vec![]),
            },
            partition_by_change: PartitionByChange {
                before: None,
                after: None,
            },
            before,
            after,
        })];

        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].violation_type, ViolationType::ColumnAddition);
        assert_eq!(violations[0].life_cycle, LifeCycle::ExternallyManaged);
    }

    #[test]
    fn test_guard_blocks_column_modification_on_externally_managed() {
        let before = create_test_table("external_table", LifeCycle::ExternallyManaged);
        let after = create_test_table("external_table", LifeCycle::ExternallyManaged);
        let before_col = create_test_column("col");
        let after_col = create_test_column("col");

        let changes = vec![OlapChange::Table(TableChange::Updated {
            name: "external_table".to_string(),
            column_changes: vec![ColumnChange::Updated {
                before: before_col,
                after: after_col,
            }],
            order_by_change: OrderByChange {
                before: OrderBy::Fields(vec![]),
                after: OrderBy::Fields(vec![]),
            },
            partition_by_change: PartitionByChange {
                before: None,
                after: None,
            },
            before,
            after,
        })];

        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(
            violations[0].violation_type,
            ViolationType::ColumnModification
        );
        assert_eq!(violations[0].life_cycle, LifeCycle::ExternallyManaged);
    }

    #[test]
    fn test_guard_blocks_ttl_change_on_externally_managed() {
        let table = create_test_table("external_table", LifeCycle::ExternallyManaged);
        let changes = vec![OlapChange::Table(TableChange::TtlChanged {
            name: "external_table".to_string(),
            before: Some("timestamp + INTERVAL 1 DAY".to_string()),
            after: Some("timestamp + INTERVAL 7 DAY".to_string()),
            table,
        })];

        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(
            violations[0].violation_type,
            ViolationType::TableModification
        );
        assert_eq!(violations[0].life_cycle, LifeCycle::ExternallyManaged);
    }

    #[test]
    fn test_guard_blocks_settings_change_on_externally_managed() {
        let table = create_test_table("external_table", LifeCycle::ExternallyManaged);
        let changes = vec![OlapChange::Table(TableChange::SettingsChanged {
            name: "external_table".to_string(),
            before_settings: None,
            after_settings: Some([("index_granularity".to_string(), "8192".to_string())].into()),
            table,
        })];

        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(
            violations[0].violation_type,
            ViolationType::TableModification
        );
        assert_eq!(violations[0].life_cycle, LifeCycle::ExternallyManaged);
    }

    // =========================================================================
    // Tests for MaterializedView lifecycle guard
    // =========================================================================

    fn create_test_mv(
        name: &str,
        life_cycle: LifeCycle,
    ) -> crate::framework::core::infrastructure::materialized_view::MaterializedView {
        use crate::framework::core::infrastructure::materialized_view::MaterializedView;
        let mut mv = MaterializedView::new(name, "SELECT 1", vec![], "target");
        mv.life_cycle = life_cycle;
        mv
    }

    #[test]
    fn test_guard_allows_fully_managed_mv_drop() {
        let mv = create_test_mv("my_mv", LifeCycle::FullyManaged);
        let changes = vec![OlapChange::MaterializedView(Change::Removed(Box::new(mv)))];
        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert!(
            violations.is_empty(),
            "Should allow dropping FullyManaged MVs"
        );
    }

    #[test]
    fn test_guard_blocks_deletion_protected_mv_drop() {
        let mv = create_test_mv("protected_mv", LifeCycle::DeletionProtected);
        let changes = vec![OlapChange::MaterializedView(Change::Removed(Box::new(mv)))];
        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].resource_name, "protected_mv");
        assert_eq!(
            violations[0].violation_type,
            ViolationType::MaterializedViewDrop
        );
        assert_eq!(violations[0].life_cycle, LifeCycle::DeletionProtected);
    }

    #[test]
    fn test_guard_blocks_externally_managed_mv_drop() {
        let mv = create_test_mv("external_mv", LifeCycle::ExternallyManaged);
        let changes = vec![OlapChange::MaterializedView(Change::Removed(Box::new(mv)))];
        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(
            violations[0].violation_type,
            ViolationType::MaterializedViewDrop
        );
        assert_eq!(violations[0].life_cycle, LifeCycle::ExternallyManaged);
    }

    #[test]
    fn test_guard_blocks_deletion_protected_mv_update() {
        // MV update = DROP+CREATE, so block if drop-protected
        let before = create_test_mv("protected_mv", LifeCycle::FullyManaged);
        let after = create_test_mv("protected_mv", LifeCycle::DeletionProtected);
        let changes = vec![OlapChange::MaterializedView(Change::Updated {
            before: Box::new(before),
            after: Box::new(after),
        })];
        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].resource_name, "protected_mv");
        assert_eq!(
            violations[0].violation_type,
            ViolationType::MaterializedViewDrop
        );
        assert_eq!(violations[0].life_cycle, LifeCycle::DeletionProtected);
    }

    #[test]
    fn test_guard_allows_fully_managed_mv_update() {
        let before = create_test_mv("my_mv", LifeCycle::FullyManaged);
        let after = create_test_mv("my_mv", LifeCycle::FullyManaged);
        let changes = vec![OlapChange::MaterializedView(Change::Updated {
            before: Box::new(before),
            after: Box::new(after),
        })];
        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert!(
            violations.is_empty(),
            "Should allow updating FullyManaged MVs"
        );
    }

    #[test]
    fn test_guard_blocks_externally_managed_mv_update() {
        // MV update = DROP+CREATE, so block if drop-protected (ExternallyManaged is drop-protected)
        let before = create_test_mv("external_mv", LifeCycle::ExternallyManaged);
        let after = create_test_mv("external_mv", LifeCycle::ExternallyManaged);
        let changes = vec![OlapChange::MaterializedView(Change::Updated {
            before: Box::new(before),
            after: Box::new(after),
        })];
        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].resource_name, "external_mv");
        assert_eq!(
            violations[0].violation_type,
            ViolationType::MaterializedViewDrop
        );
        assert_eq!(violations[0].life_cycle, LifeCycle::ExternallyManaged);
    }

    /// Tests that deliberately removing DeletionProtected via update allows the DROP+CREATE.
    ///
    /// Scenario: User removes @DeletionProtected annotation AND changes the SELECT statement.
    /// Since MV update = DROP+CREATE, only the AFTER lifecycle matters — FullyManaged is not
    /// drop-protected, so the update should proceed.
    #[test]
    fn test_guard_allows_mv_removal_of_deletion_protection() {
        let before = create_test_mv("my_mv", LifeCycle::DeletionProtected);
        let after = create_test_mv("my_mv", LifeCycle::FullyManaged);
        let changes = vec![OlapChange::MaterializedView(Change::Updated {
            before: Box::new(before),
            after: Box::new(after),
        })];
        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert!(
            violations.is_empty(),
            "Removing DeletionProtected via update should be allowed"
        );
    }

    /// Tests that deliberately removing ExternallyManaged via update allows the DROP+CREATE.
    ///
    /// Scenario: User removes @ExternallyManaged annotation AND changes the SELECT statement.
    /// Since the AFTER lifecycle is FullyManaged (not drop-protected), the update should proceed.
    #[test]
    fn test_guard_allows_mv_removal_of_externally_managed() {
        let before = create_test_mv("my_mv", LifeCycle::ExternallyManaged);
        let after = create_test_mv("my_mv", LifeCycle::FullyManaged);
        let changes = vec![OlapChange::MaterializedView(Change::Updated {
            before: Box::new(before),
            after: Box::new(after),
        })];
        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert!(
            violations.is_empty(),
            "Removing ExternallyManaged via update should be allowed"
        );
    }

    #[test]
    fn test_guard_blocks_externally_managed_mv_create() {
        let mv = create_test_mv("external_mv", LifeCycle::ExternallyManaged);
        let changes = vec![OlapChange::MaterializedView(Change::Added(Box::new(mv)))];
        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].resource_name, "external_mv");
        assert_eq!(
            violations[0].violation_type,
            ViolationType::MaterializedViewCreate
        );
        assert_eq!(violations[0].life_cycle, LifeCycle::ExternallyManaged);
    }

    #[test]
    fn test_guard_allows_fully_managed_mv_create() {
        let mv = create_test_mv("my_mv", LifeCycle::FullyManaged);
        let changes = vec![OlapChange::MaterializedView(Change::Added(Box::new(mv)))];
        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert!(
            violations.is_empty(),
            "Should allow creating FullyManaged MVs"
        );
    }

    #[test]
    fn test_guard_allows_deletion_protected_mv_create() {
        // DELETION_PROTECTED blocks drops but not creation
        let mv = create_test_mv("protected_mv", LifeCycle::DeletionProtected);
        let changes = vec![OlapChange::MaterializedView(Change::Added(Box::new(mv)))];
        let violations = validate_lifecycle_compliance(&changes, "test_db");
        assert!(
            violations.is_empty(),
            "Should allow creating DeletionProtected MVs"
        );
    }
}
