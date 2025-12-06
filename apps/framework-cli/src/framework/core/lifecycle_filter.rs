//! Lifecycle-aware filtering for infrastructure changes
//!
//! This module provides functionality to filter infrastructure changes based on
//! lifecycle protection policies. It enforces that:
//! - DeletionProtected tables cannot be dropped or have columns removed
//! - ExternallyManaged tables cannot be dropped or created automatically
//! - When a drop is blocked, the corresponding create is also blocked to prevent errors

use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure_map::{
    ColumnChange, FilteredChange, OlapChange, TableChange,
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
/// - Filters out column removals from DeletionProtected tables
///
/// # Arguments
/// * `changes` - The changes to filter (typically from a diff strategy)
/// * `target_table` - The target table state (used to check lifecycle)
///
/// # Returns
/// A `FilterResult` containing both applied and filtered changes
pub fn apply_lifecycle_filter(changes: Vec<OlapChange>, target_table: &Table) -> FilterResult {
    let mut applied = Vec::new();
    let mut filtered = Vec::new();
    let mut blocked_tables = HashSet::new();

    for change in changes {
        match change {
            OlapChange::Table(TableChange::Removed(removed_table)) => {
                if should_block_table_removal(&removed_table, target_table) {
                    blocked_tables.insert(removed_table.name.clone());
                    filtered.push(create_removal_filtered_change(
                        removed_table,
                        target_table.life_cycle,
                    ));
                } else {
                    applied.push(OlapChange::Table(TableChange::Removed(removed_table)));
                }
            }
            OlapChange::Table(TableChange::Added(added_table)) => {
                // Block orphan creates when the corresponding drop was blocked
                if blocked_tables.contains(&added_table.name) {
                    tracing::debug!(
                        "Blocking orphan CREATE for table '{}' after blocking DROP",
                        added_table.name
                    );
                    filtered.push(FilteredChange {
                        change: OlapChange::Table(TableChange::Added(added_table.clone())),
                        reason: format!(
                            "Table '{}' CREATE blocked because corresponding DROP was blocked",
                            added_table.name
                        ),
                    });
                } else {
                    applied.push(OlapChange::Table(TableChange::Added(added_table)));
                }
            }
            OlapChange::Table(TableChange::Updated {
                name,
                column_changes,
                order_by_change,
                partition_by_change,
                before,
                after,
            }) => {
                let (filtered_columns, removed_columns) =
                    filter_column_changes(column_changes, &after);

                // Record filtered column removals
                for removed in removed_columns {
                    if let ColumnChange::Removed(col) = removed {
                        filtered.push(FilteredChange {
                            change: OlapChange::Table(TableChange::Updated {
                                name: name.clone(),
                                column_changes: vec![ColumnChange::Removed(col.clone())],
                                order_by_change: order_by_change.clone(),
                                partition_by_change: partition_by_change.clone(),
                                before: before.clone(),
                                after: after.clone(),
                            }),
                            reason: format!(
                                "Table '{}' has DeletionProtected lifecycle - column '{}' removal blocked",
                                name, col.name
                            ),
                        });
                    }
                }

                applied.push(OlapChange::Table(TableChange::Updated {
                    name,
                    column_changes: filtered_columns,
                    order_by_change,
                    partition_by_change,
                    before,
                    after,
                }));
            }
            _ => applied.push(change),
        }
    }

    FilterResult { applied, filtered }
}

/// Determines if a table removal should be blocked based on lifecycle policies
///
/// CRITICAL: Uses target_table lifecycle (AFTER state), not removed_table lifecycle (BEFORE state)
/// This handles transitions TO protected lifecycles (e.g., FullyManaged -> DeletionProtected)
fn should_block_table_removal(removed_table: &Table, target_table: &Table) -> bool {
    match target_table.life_cycle {
        LifeCycle::DeletionProtected => {
            tracing::warn!(
                "Strategy attempted to drop deletion-protected table '{}' - blocking operation",
                removed_table.name
            );
            true
        }
        LifeCycle::ExternallyManaged => {
            tracing::warn!(
                "Strategy attempted to drop externally-managed table '{}' - blocking operation",
                removed_table.name
            );
            true
        }
        LifeCycle::FullyManaged => false,
    }
}

/// Creates a FilteredChange entry for a blocked table removal
fn create_removal_filtered_change(removed_table: Table, lifecycle: LifeCycle) -> FilteredChange {
    let reason = match lifecycle {
        LifeCycle::DeletionProtected => format!(
            "Table '{}' has DeletionProtected lifecycle - DROP operation blocked",
            removed_table.name
        ),
        LifeCycle::ExternallyManaged => format!(
            "Table '{}' has ExternallyManaged lifecycle - DROP operation blocked",
            removed_table.name
        ),
        LifeCycle::FullyManaged => {
            unreachable!("FullyManaged tables should not be filtered")
        }
    };

    FilteredChange {
        change: OlapChange::Table(TableChange::Removed(removed_table)),
        reason,
    }
}

/// Filters column changes to respect DeletionProtected lifecycle
///
/// Returns a tuple of (filtered_changes, removed_changes) where:
/// - filtered_changes: Changes that can be applied
/// - removed_changes: Changes that were filtered out
fn filter_column_changes(
    column_changes: Vec<ColumnChange>,
    after_table: &Table,
) -> (Vec<ColumnChange>, Vec<ColumnChange>) {
    if after_table.life_cycle != LifeCycle::DeletionProtected {
        return (column_changes, Vec::new());
    }

    let original_len = column_changes.len();
    let mut filtered = Vec::new();
    let mut removed = Vec::new();

    for change in column_changes {
        match change {
            ColumnChange::Removed(_) => removed.push(change),
            _ => filtered.push(change),
        }
    }

    if original_len != filtered.len() {
        tracing::debug!(
            "Filtered {} column removals for deletion-protected table '{}'",
            original_len - filtered.len(),
            after_table.name
        );
    }

    (filtered, removed)
}
