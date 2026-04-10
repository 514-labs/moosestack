use crate::framework::core::infrastructure::materialized_view::MaterializedView;
use crate::framework::core::infrastructure::select_row_policy::SelectRowPolicy;
use crate::framework::core::infrastructure::sql_resource::SqlResource;
use crate::framework::core::infrastructure::table::{Column, Table, TableIndex, TableProjection};
use crate::framework::core::infrastructure::view::{Dmv1View, View};
use crate::framework::core::infrastructure_map::{
    Change, ColumnChange, InfrastructureMap, OlapChange, TableChange,
};
use crate::infrastructure::olap::ddl_ordering::{AtomicOlapOperation, DependencyInfo};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Records the user's policy decision for a destructive operation.
///
/// When a migration requires a destructive change (e.g., dropping and recreating a table
/// because ORDER BY changed), the user is prompted for confirmation. This struct captures
/// that decision so it can be persisted in the migration file and replayed without
/// re-prompting.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DestructivePolicy {
    /// Human-readable description of what was confirmed
    /// (e.g., "Drop and recreate table 'events' because ORDER BY changed")
    pub description: String,
    /// Timestamp when the user approved this operation
    pub approved_at: DateTime<Utc>,
}

/// A semantic infrastructure delta for OLAP resources.
///
/// Each variant represents a single logical change to the infrastructure map.
/// Deltas are the unit of migration: they are serialized into migration files,
/// committed to the repo, and applied in sequence to reconstruct the infrastructure
/// map via fold.
///
/// The execution loop for each delta is:
/// 1. `delta.to_atomic_operations(&map, db)` — lower to DDL (map has prior state from fold)
/// 2. Execute the DDL against ClickHouse
/// 3. `delta.apply(&mut map, db)` — update the map for the next delta
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
#[allow(clippy::large_enum_variant)]
pub enum InfraDelta {
    // ── Table lifecycle ─────────────────────────────────────────────
    /// Create a new table
    CreateTable { table: Table },

    /// Drop an existing table (destructive, requires policy)
    DropTable {
        table: Table,
        policy: DestructivePolicy,
    },

    /// Drop and recreate a table because a non-alterable property changed
    /// (ORDER BY, PARTITION BY, engine, primary key, readonly settings).
    /// Preserves intent: the user confirmed this as a single operation.
    /// DDL lowering splits into DROP + CREATE internally.
    RecreateTable {
        before: Table,
        after: Table,
        policy: DestructivePolicy,
    },

    // ── Table column mutations ──────────────────────────────────────
    // These use `table_id` (the `Table::id(default_database)` key) for lookup.
    // The full Table is obtained from the map during lowering.
    /// Add a column to an existing table
    AddTableColumn {
        table_id: String,
        column: Column,
        /// Column name after which to insert, or None for first position
        after_column: Option<String>,
    },

    /// Drop a column from an existing table
    DropTableColumn {
        table_id: String,
        column_name: String,
    },

    /// Modify a column's type, default, codec, TTL, etc.
    ModifyTableColumn {
        table_id: String,
        before_column: Column,
        after_column: Column,
    },

    /// Rename a column
    RenameTableColumn {
        table_id: String,
        before_name: String,
        after_name: String,
    },

    // ── Table property mutations ────────────────────────────────────
    /// Modify table-level settings (e.g., index_granularity)
    ModifyTableSettings {
        table_id: String,
        before: Option<HashMap<String, String>>,
        after: Option<HashMap<String, String>>,
    },

    /// Modify or remove table-level TTL
    ModifyTableTtl {
        table_id: String,
        before: Option<String>,
        after: Option<String>,
    },

    /// Add a secondary index to a table
    AddTableIndex { table_id: String, index: TableIndex },

    /// Drop a secondary index from a table
    DropTableIndex {
        table_id: String,
        index_name: String,
    },

    /// Add a projection to a table
    AddTableProjection {
        table_id: String,
        projection: TableProjection,
    },

    /// Drop a projection from a table
    DropTableProjection {
        table_id: String,
        projection_name: String,
    },

    /// Set or change the SAMPLE BY expression
    ModifySampleBy {
        table_id: String,
        expression: String,
    },

    /// Remove the SAMPLE BY expression
    RemoveSampleBy { table_id: String },

    // ── Views ───────────────────────────────────────────────────────
    /// Create a new view
    CreateView { view: View },

    /// Drop an existing view
    DropView { view: View },

    /// Create a new materialized view
    CreateMaterializedView { mv: MaterializedView },

    /// Drop an existing materialized view
    DropMaterializedView { mv: MaterializedView },

    /// Create a DMv1 view (table alias for data model versioning)
    CreateDmv1View { view: Dmv1View },

    /// Drop a DMv1 view
    DropDmv1View { view: Dmv1View },

    // ── Row policies ────────────────────────────────────────────────
    /// Create a row-level security policy
    CreateRowPolicy { policy: SelectRowPolicy },

    /// Drop a row-level security policy
    DropRowPolicy { policy: SelectRowPolicy },

    // ── SQL resources ───────────────────────────────────────────────
    /// Run a SQL resource's setup scripts
    RunSetupSql { resource: SqlResource },

    /// Run a SQL resource's teardown scripts
    RunTeardownSql { resource: SqlResource },

    // ── Execution-only (no-op on map fold) ──────────────────────────
    /// Backfill data from one table to another after a recreate.
    /// This is a no-op on the infrastructure map — it only matters at execution time.
    BackfillTable {
        source_table: String,
        target_table: String,
        columns: Vec<String>,
        sql: String,
    },

    /// Populate a materialized view with initial data.
    /// This is a no-op on the infrastructure map — it only matters at execution time.
    PopulateMaterializedView {
        view_name: String,
        target_table: String,
        target_database: Option<String>,
        select_statement: String,
        should_truncate: bool,
    },
}

// ── Error types ─────────────────────────────────────────────────────

/// Error applying a delta to an infrastructure map
#[derive(Debug, thiserror::Error)]
#[error("failed to apply delta in migration '{migration_id}'")]
pub struct DeltaApplyError {
    pub migration_id: String,
    #[source]
    pub kind: DeltaApplyErrorKind,
}

/// Specific reasons a delta application can fail
#[derive(Debug, thiserror::Error)]
pub enum DeltaApplyErrorKind {
    #[error("table '{table_id}' not found in infrastructure map")]
    TableNotFound { table_id: String },

    #[error("column '{column_name}' not found in table '{table_id}'")]
    ColumnNotFound {
        table_id: String,
        column_name: String,
    },

    #[error("table '{table_id}' already exists in infrastructure map")]
    DuplicateTable { table_id: String },

    #[error("view '{view_id}' not found in infrastructure map")]
    ViewNotFound { view_id: String },

    #[error("materialized view '{mv_id}' not found in infrastructure map")]
    MaterializedViewNotFound { mv_id: String },

    #[error("DMv1 view '{view_id}' not found in infrastructure map")]
    Dmv1ViewNotFound { view_id: String },

    #[error("row policy '{policy_name}' not found in infrastructure map")]
    RowPolicyNotFound { policy_name: String },

    #[error("SQL resource '{resource_name}' not found in infrastructure map")]
    SqlResourceNotFound { resource_name: String },

    #[error("index '{index_name}' not found in table '{table_id}'")]
    IndexNotFound {
        table_id: String,
        index_name: String,
    },

    #[error("projection '{projection_name}' not found in table '{table_id}'")]
    ProjectionNotFound {
        table_id: String,
        projection_name: String,
    },
}

// ── apply() implementation ──────────────────────────────────────────

impl InfraDelta {
    /// Apply this delta to an infrastructure map, mutating it in place.
    ///
    /// This is the fold step: `foldl apply empty_map deltas == target_map`.
    /// Each variant either inserts, removes, or mutates a component in the map.
    /// Execution-only variants (`BackfillTable`, `PopulateMaterializedView`) are no-ops.
    ///
    /// # Errors
    /// Returns `DeltaApplyErrorKind` if the map is not in the expected state
    /// (e.g., table not found for a column mutation, duplicate table on create).
    pub fn apply(
        &self,
        map: &mut InfrastructureMap,
        default_database: &str,
    ) -> Result<(), DeltaApplyErrorKind> {
        match self {
            // ── Table lifecycle ──────────────────────────────────
            InfraDelta::CreateTable { table } => {
                let id = table.id(default_database);
                if map.tables.contains_key(&id) {
                    return Err(DeltaApplyErrorKind::DuplicateTable { table_id: id });
                }
                map.tables.insert(id, table.clone());
            }

            InfraDelta::DropTable { table, .. } => {
                let id = table.id(default_database);
                if map.tables.remove(&id).is_none() {
                    return Err(DeltaApplyErrorKind::TableNotFound { table_id: id });
                }
            }

            InfraDelta::RecreateTable { before, after, .. } => {
                let before_id = before.id(default_database);
                if map.tables.remove(&before_id).is_none() {
                    return Err(DeltaApplyErrorKind::TableNotFound {
                        table_id: before_id,
                    });
                }
                let after_id = after.id(default_database);
                map.tables.insert(after_id, after.clone());
            }

            // ── Column mutations ────────────────────────────────
            InfraDelta::AddTableColumn {
                table_id,
                column,
                after_column,
            } => {
                let table = map.tables.get_mut(table_id).ok_or_else(|| {
                    DeltaApplyErrorKind::TableNotFound {
                        table_id: table_id.clone(),
                    }
                })?;
                let pos = match after_column {
                    Some(after_name) => {
                        match table.columns.iter().position(|c| c.name == *after_name) {
                            Some(i) => i + 1,
                            None => {
                                tracing::warn!(
                                    "Anchor column '{}' not found in table '{}', appending column '{}' at end",
                                    after_name, table_id, column.name
                                );
                                table.columns.len()
                            }
                        }
                    }
                    None => 0,
                };
                table.columns.insert(pos, column.clone());
            }

            InfraDelta::DropTableColumn {
                table_id,
                column_name,
            } => {
                let table = map.tables.get_mut(table_id).ok_or_else(|| {
                    DeltaApplyErrorKind::TableNotFound {
                        table_id: table_id.clone(),
                    }
                })?;
                let pos = table
                    .columns
                    .iter()
                    .position(|c| c.name == *column_name)
                    .ok_or_else(|| DeltaApplyErrorKind::ColumnNotFound {
                        table_id: table_id.clone(),
                        column_name: column_name.clone(),
                    })?;
                table.columns.remove(pos);
            }

            InfraDelta::ModifyTableColumn {
                table_id,
                before_column,
                after_column,
            } => {
                let table = map.tables.get_mut(table_id).ok_or_else(|| {
                    DeltaApplyErrorKind::TableNotFound {
                        table_id: table_id.clone(),
                    }
                })?;
                let col = table
                    .columns
                    .iter_mut()
                    .find(|c| c.name == before_column.name)
                    .ok_or_else(|| DeltaApplyErrorKind::ColumnNotFound {
                        table_id: table_id.clone(),
                        column_name: before_column.name.clone(),
                    })?;
                *col = after_column.clone();
            }

            InfraDelta::RenameTableColumn {
                table_id,
                before_name,
                after_name,
            } => {
                let table = map.tables.get_mut(table_id).ok_or_else(|| {
                    DeltaApplyErrorKind::TableNotFound {
                        table_id: table_id.clone(),
                    }
                })?;
                let col = table
                    .columns
                    .iter_mut()
                    .find(|c| c.name == *before_name)
                    .ok_or_else(|| DeltaApplyErrorKind::ColumnNotFound {
                        table_id: table_id.clone(),
                        column_name: before_name.clone(),
                    })?;
                col.name = after_name.clone();
            }

            // ── Table property mutations ────────────────────────
            InfraDelta::ModifyTableSettings {
                table_id, after, ..
            } => {
                let table = map.tables.get_mut(table_id).ok_or_else(|| {
                    DeltaApplyErrorKind::TableNotFound {
                        table_id: table_id.clone(),
                    }
                })?;
                table.table_settings = after.clone();
            }

            InfraDelta::ModifyTableTtl {
                table_id, after, ..
            } => {
                let table = map.tables.get_mut(table_id).ok_or_else(|| {
                    DeltaApplyErrorKind::TableNotFound {
                        table_id: table_id.clone(),
                    }
                })?;
                table.table_ttl_setting = after.clone();
            }

            InfraDelta::AddTableIndex { table_id, index } => {
                let table = map.tables.get_mut(table_id).ok_or_else(|| {
                    DeltaApplyErrorKind::TableNotFound {
                        table_id: table_id.clone(),
                    }
                })?;
                table.indexes.push(index.clone());
            }

            InfraDelta::DropTableIndex {
                table_id,
                index_name,
            } => {
                let table = map.tables.get_mut(table_id).ok_or_else(|| {
                    DeltaApplyErrorKind::TableNotFound {
                        table_id: table_id.clone(),
                    }
                })?;
                let pos = table
                    .indexes
                    .iter()
                    .position(|i| i.name == *index_name)
                    .ok_or_else(|| DeltaApplyErrorKind::IndexNotFound {
                        table_id: table_id.clone(),
                        index_name: index_name.clone(),
                    })?;
                table.indexes.remove(pos);
            }

            InfraDelta::AddTableProjection {
                table_id,
                projection,
            } => {
                let table = map.tables.get_mut(table_id).ok_or_else(|| {
                    DeltaApplyErrorKind::TableNotFound {
                        table_id: table_id.clone(),
                    }
                })?;
                table.projections.push(projection.clone());
            }

            InfraDelta::DropTableProjection {
                table_id,
                projection_name,
            } => {
                let table = map.tables.get_mut(table_id).ok_or_else(|| {
                    DeltaApplyErrorKind::TableNotFound {
                        table_id: table_id.clone(),
                    }
                })?;
                let pos = table
                    .projections
                    .iter()
                    .position(|p| p.name == *projection_name)
                    .ok_or_else(|| DeltaApplyErrorKind::ProjectionNotFound {
                        table_id: table_id.clone(),
                        projection_name: projection_name.clone(),
                    })?;
                table.projections.remove(pos);
            }

            InfraDelta::ModifySampleBy {
                table_id,
                expression,
            } => {
                let table = map.tables.get_mut(table_id).ok_or_else(|| {
                    DeltaApplyErrorKind::TableNotFound {
                        table_id: table_id.clone(),
                    }
                })?;
                table.sample_by = Some(expression.clone());
            }

            InfraDelta::RemoveSampleBy { table_id } => {
                let table = map.tables.get_mut(table_id).ok_or_else(|| {
                    DeltaApplyErrorKind::TableNotFound {
                        table_id: table_id.clone(),
                    }
                })?;
                table.sample_by = None;
            }

            // ── Views ───────────────────────────────────────────
            InfraDelta::CreateView { view } => {
                let id = view.id(default_database);
                if map.views.contains_key(&id) {
                    tracing::warn!("View '{}' already exists in map, overwriting", id);
                }
                map.views.insert(id, view.clone());
            }

            InfraDelta::DropView { view } => {
                let id = view.id(default_database);
                if map.views.remove(&id).is_none() {
                    return Err(DeltaApplyErrorKind::ViewNotFound { view_id: id });
                }
            }

            InfraDelta::CreateMaterializedView { mv } => {
                let id = mv.id(default_database);
                if map.materialized_views.contains_key(&id) {
                    tracing::warn!(
                        "Materialized view '{}' already exists in map, overwriting",
                        id
                    );
                }
                map.materialized_views.insert(id, mv.clone());
            }

            InfraDelta::DropMaterializedView { mv } => {
                let id = mv.id(default_database);
                if map.materialized_views.remove(&id).is_none() {
                    return Err(DeltaApplyErrorKind::MaterializedViewNotFound { mv_id: id });
                }
            }

            InfraDelta::CreateDmv1View { view } => {
                let id = view.id();
                if map.dmv1_views.contains_key(&id) {
                    tracing::warn!("DMv1 view '{}' already exists in map, overwriting", id);
                }
                map.dmv1_views.insert(id, view.clone());
            }

            InfraDelta::DropDmv1View { view } => {
                let id = view.id();
                if map.dmv1_views.remove(&id).is_none() {
                    return Err(DeltaApplyErrorKind::Dmv1ViewNotFound { view_id: id });
                }
            }

            // ── Row policies ────────────────────────────────────
            InfraDelta::CreateRowPolicy { policy } => {
                map.select_row_policies
                    .insert(policy.name.clone(), policy.clone());
            }

            InfraDelta::DropRowPolicy { policy } => {
                if map.select_row_policies.remove(&policy.name).is_none() {
                    return Err(DeltaApplyErrorKind::RowPolicyNotFound {
                        policy_name: policy.name.clone(),
                    });
                }
            }

            // ── SQL resources ───────────────────────────────────
            InfraDelta::RunSetupSql { resource } => {
                let id = resource.id(default_database);
                map.sql_resources.insert(id, resource.clone());
            }

            InfraDelta::RunTeardownSql { resource } => {
                let id = resource.id(default_database);
                if map.sql_resources.remove(&id).is_none() {
                    return Err(DeltaApplyErrorKind::SqlResourceNotFound { resource_name: id });
                }
            }

            // ── Execution-only (no-op) ──────────────────────────
            InfraDelta::BackfillTable { .. } | InfraDelta::PopulateMaterializedView { .. } => {
                // These only matter at DDL execution time, not during map reconstruction.
            }
        }
        Ok(())
    }

    /// Returns a human-readable summary of this delta for display purposes.
    pub fn summary(&self) -> String {
        match self {
            InfraDelta::CreateTable { table } => format!("Create table '{}'", table.name),
            InfraDelta::DropTable { table, .. } => format!("Drop table '{}'", table.name),
            InfraDelta::RecreateTable { before, .. } => {
                format!("Recreate table '{}'", before.name)
            }
            InfraDelta::AddTableColumn {
                table_id, column, ..
            } => format!("Add column '{}' to '{}'", column.name, table_id),
            InfraDelta::DropTableColumn {
                table_id,
                column_name,
            } => format!("Drop column '{}' from '{}'", column_name, table_id),
            InfraDelta::ModifyTableColumn {
                table_id,
                before_column,
                ..
            } => format!("Modify column '{}' in '{}'", before_column.name, table_id),
            InfraDelta::RenameTableColumn {
                table_id,
                before_name,
                after_name,
            } => format!(
                "Rename column '{}' to '{}' in '{}'",
                before_name, after_name, table_id
            ),
            InfraDelta::ModifyTableSettings { table_id, .. } => {
                format!("Modify settings for '{}'", table_id)
            }
            InfraDelta::ModifyTableTtl { table_id, .. } => {
                format!("Modify TTL for '{}'", table_id)
            }
            InfraDelta::AddTableIndex { table_id, index } => {
                format!("Add index '{}' to '{}'", index.name, table_id)
            }
            InfraDelta::DropTableIndex {
                table_id,
                index_name,
            } => format!("Drop index '{}' from '{}'", index_name, table_id),
            InfraDelta::AddTableProjection {
                table_id,
                projection,
            } => format!("Add projection '{}' to '{}'", projection.name, table_id),
            InfraDelta::DropTableProjection {
                table_id,
                projection_name,
            } => format!("Drop projection '{}' from '{}'", projection_name, table_id),
            InfraDelta::ModifySampleBy { table_id, .. } => {
                format!("Modify SAMPLE BY for '{}'", table_id)
            }
            InfraDelta::RemoveSampleBy { table_id } => {
                format!("Remove SAMPLE BY from '{}'", table_id)
            }
            InfraDelta::CreateView { view } => format!("Create view '{}'", view.name),
            InfraDelta::DropView { view } => format!("Drop view '{}'", view.name),
            InfraDelta::CreateMaterializedView { mv } => {
                format!("Create materialized view '{}'", mv.name)
            }
            InfraDelta::DropMaterializedView { mv } => {
                format!("Drop materialized view '{}'", mv.name)
            }
            InfraDelta::CreateDmv1View { view } => format!("Create DMv1 view '{}'", view.name),
            InfraDelta::DropDmv1View { view } => format!("Drop DMv1 view '{}'", view.name),
            InfraDelta::CreateRowPolicy { policy } => {
                format!("Create row policy '{}'", policy.name)
            }
            InfraDelta::DropRowPolicy { policy } => {
                format!("Drop row policy '{}'", policy.name)
            }
            InfraDelta::RunSetupSql { resource } => {
                format!("Run setup SQL for '{}'", resource.name)
            }
            InfraDelta::RunTeardownSql { resource } => {
                format!("Run teardown SQL for '{}'", resource.name)
            }
            InfraDelta::BackfillTable {
                source_table,
                target_table,
                ..
            } => format!("Backfill '{}' from '{}'", target_table, source_table),
            InfraDelta::PopulateMaterializedView { view_name, .. } => {
                format!("Populate materialized view '{}'", view_name)
            }
        }
    }

    /// Lower this delta to `AtomicOlapOperation`s for DDL execution.
    ///
    /// The `map` parameter is the infrastructure map at the point of application
    /// (the fold of all prior deltas). Column-level and index/projection-level
    /// operations need the full `Table` from the map for the `AtomicOlapOperation`
    /// variants that carry it.
    ///
    /// `RecreateTable` splits into `DropTable` + `CreateTable`.
    /// `BackfillTable` becomes `RawSql`.
    /// Execution-only variants produce their DDL equivalents.
    ///
    /// Note: `default_database` is currently unused because table lookups use
    /// the pre-computed `table_id` key. Once deltas are made database-agnostic
    /// (514-1096), this parameter will be used to resolve table references at
    /// lowering time.
    pub fn to_atomic_operations(
        &self,
        map: &InfrastructureMap,
        _default_database: &str,
    ) -> Vec<AtomicOlapOperation> {
        let empty_deps = DependencyInfo::default();
        match self {
            // ── Table lifecycle ──────────────────────────────────
            InfraDelta::CreateTable { table } => {
                vec![AtomicOlapOperation::CreateTable {
                    table: table.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::DropTable { table, .. } => {
                vec![AtomicOlapOperation::DropTable {
                    table: table.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::RecreateTable { before, after, .. } => {
                vec![
                    AtomicOlapOperation::DropTable {
                        table: before.clone(),
                        dependency_info: empty_deps.clone(),
                    },
                    AtomicOlapOperation::CreateTable {
                        table: after.clone(),
                        dependency_info: empty_deps,
                    },
                ]
            }

            // ── Column mutations (need table from map) ──────────
            InfraDelta::AddTableColumn {
                table_id,
                column,
                after_column,
            } => {
                let table = match map.tables.get(table_id) {
                    Some(t) => t.clone(),
                    None => {
                        tracing::warn!(
                            "Table '{}' not found in map during delta lowering, skipping operation",
                            table_id
                        );
                        return vec![];
                    }
                };
                vec![AtomicOlapOperation::AddTableColumn {
                    table,
                    column: column.clone(),
                    after_column: after_column.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::DropTableColumn {
                table_id,
                column_name,
            } => {
                let table = match map.tables.get(table_id) {
                    Some(t) => t.clone(),
                    None => {
                        tracing::warn!(
                            "Table '{}' not found in map during delta lowering, skipping operation",
                            table_id
                        );
                        return vec![];
                    }
                };
                vec![AtomicOlapOperation::DropTableColumn {
                    table,
                    column_name: column_name.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::ModifyTableColumn {
                table_id,
                before_column,
                after_column,
            } => {
                let table = match map.tables.get(table_id) {
                    Some(t) => t.clone(),
                    None => {
                        tracing::warn!(
                            "Table '{}' not found in map during delta lowering, skipping operation",
                            table_id
                        );
                        return vec![];
                    }
                };
                vec![AtomicOlapOperation::ModifyTableColumn {
                    table,
                    before_column: before_column.clone(),
                    after_column: after_column.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::RenameTableColumn {
                table_id,
                before_name,
                after_name,
            } => {
                let table = match map.tables.get(table_id) {
                    Some(t) => t.clone(),
                    None => {
                        tracing::warn!(
                            "Table '{}' not found in map during delta lowering, skipping operation",
                            table_id
                        );
                        return vec![];
                    }
                };
                vec![AtomicOlapOperation::RenameTableColumn {
                    table,
                    before_column_name: before_name.clone(),
                    after_column_name: after_name.clone(),
                    dependency_info: empty_deps,
                }]
            }

            // ── Table property mutations ────────────────────────
            InfraDelta::ModifyTableSettings {
                table_id,
                before,
                after,
            } => {
                let table = match map.tables.get(table_id) {
                    Some(t) => t.clone(),
                    None => {
                        tracing::warn!(
                            "Table '{}' not found in map during delta lowering, skipping operation",
                            table_id
                        );
                        return vec![];
                    }
                };
                vec![AtomicOlapOperation::ModifyTableSettings {
                    table,
                    before_settings: before.clone(),
                    after_settings: after.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::ModifyTableTtl {
                table_id,
                before,
                after,
            } => {
                let table = match map.tables.get(table_id) {
                    Some(t) => t.clone(),
                    None => {
                        tracing::warn!(
                            "Table '{}' not found in map during delta lowering, skipping operation",
                            table_id
                        );
                        return vec![];
                    }
                };
                vec![AtomicOlapOperation::ModifyTableTtl {
                    table,
                    before: before.clone(),
                    after: after.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::AddTableIndex { table_id, index } => {
                let table = match map.tables.get(table_id) {
                    Some(t) => t.clone(),
                    None => {
                        tracing::warn!(
                            "Table '{}' not found in map during delta lowering, skipping operation",
                            table_id
                        );
                        return vec![];
                    }
                };
                vec![AtomicOlapOperation::AddTableIndex {
                    table,
                    index: index.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::DropTableIndex {
                table_id,
                index_name,
            } => {
                let table = match map.tables.get(table_id) {
                    Some(t) => t.clone(),
                    None => {
                        tracing::warn!(
                            "Table '{}' not found in map during delta lowering, skipping operation",
                            table_id
                        );
                        return vec![];
                    }
                };
                vec![AtomicOlapOperation::DropTableIndex {
                    table,
                    index_name: index_name.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::AddTableProjection {
                table_id,
                projection,
            } => {
                let table = match map.tables.get(table_id) {
                    Some(t) => t.clone(),
                    None => {
                        tracing::warn!(
                            "Table '{}' not found in map during delta lowering, skipping operation",
                            table_id
                        );
                        return vec![];
                    }
                };
                vec![AtomicOlapOperation::AddTableProjection {
                    table,
                    projection: projection.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::DropTableProjection {
                table_id,
                projection_name,
            } => {
                let table = match map.tables.get(table_id) {
                    Some(t) => t.clone(),
                    None => {
                        tracing::warn!(
                            "Table '{}' not found in map during delta lowering, skipping operation",
                            table_id
                        );
                        return vec![];
                    }
                };
                vec![AtomicOlapOperation::DropTableProjection {
                    table,
                    projection_name: projection_name.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::ModifySampleBy {
                table_id,
                expression,
            } => {
                let table = match map.tables.get(table_id) {
                    Some(t) => t.clone(),
                    None => {
                        tracing::warn!(
                            "Table '{}' not found in map during delta lowering, skipping operation",
                            table_id
                        );
                        return vec![];
                    }
                };
                vec![AtomicOlapOperation::ModifySampleBy {
                    table,
                    expression: expression.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::RemoveSampleBy { table_id } => {
                let table = match map.tables.get(table_id) {
                    Some(t) => t.clone(),
                    None => {
                        tracing::warn!(
                            "Table '{}' not found in map during delta lowering, skipping operation",
                            table_id
                        );
                        return vec![];
                    }
                };
                vec![AtomicOlapOperation::RemoveSampleBy {
                    table,
                    dependency_info: empty_deps,
                }]
            }

            // ── Views ───────────────────────────────────────────
            InfraDelta::CreateView { view } => {
                vec![AtomicOlapOperation::CreateView {
                    view: view.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::DropView { view } => {
                vec![AtomicOlapOperation::DropView {
                    view: view.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::CreateMaterializedView { mv } => {
                vec![AtomicOlapOperation::CreateMaterializedView {
                    mv: mv.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::DropMaterializedView { mv } => {
                vec![AtomicOlapOperation::DropMaterializedView {
                    mv: mv.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::CreateDmv1View { view } => {
                vec![AtomicOlapOperation::CreateDmv1View {
                    view: view.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::DropDmv1View { view } => {
                vec![AtomicOlapOperation::DropDmv1View {
                    view: view.clone(),
                    dependency_info: empty_deps,
                }]
            }

            // ── Row policies ────────────────────────────────────
            InfraDelta::CreateRowPolicy { policy } => {
                vec![AtomicOlapOperation::CreateRowPolicy {
                    policy: policy.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::DropRowPolicy { policy } => {
                vec![AtomicOlapOperation::DropRowPolicy {
                    policy: policy.clone(),
                    dependency_info: empty_deps,
                }]
            }

            // ── SQL resources ───────────────────────────────────
            InfraDelta::RunSetupSql { resource } => {
                vec![AtomicOlapOperation::RunSetupSql {
                    resource: resource.clone(),
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::RunTeardownSql { resource } => {
                vec![AtomicOlapOperation::RunTeardownSql {
                    resource: resource.clone(),
                    dependency_info: empty_deps,
                }]
            }

            // ── Execution-only ──────────────────────────────────
            InfraDelta::BackfillTable { sql, .. } => {
                vec![AtomicOlapOperation::RunSetupSql {
                    resource: SqlResource {
                        name: "backfill".to_string(),
                        database: None,
                        source_file: None,
                        source_line: None,
                        source_column: None,
                        setup: vec![sql.clone()],
                        teardown: vec![],
                        pulls_data_from: vec![],
                        pushes_data_to: vec![],
                    },
                    dependency_info: empty_deps,
                }]
            }
            InfraDelta::PopulateMaterializedView {
                view_name,
                target_table,
                target_database,
                select_statement,
                should_truncate,
            } => {
                vec![AtomicOlapOperation::PopulateMaterializedView {
                    view_name: view_name.clone(),
                    target_table: target_table.clone(),
                    target_database: target_database.clone(),
                    select_statement: select_statement.clone(),
                    should_truncate: *should_truncate,
                    dependency_info: empty_deps,
                }]
            }
        }
    }
}

// ── Conversion from existing diff types ─────────────────────────────

/// Convert a slice of `OlapChange`s (from the existing diff pipeline) into `InfraDelta`s.
///
/// This is the bridge between the snapshot-diff world and the delta world.
/// Key behavior:
/// - Adjacent `Removed(before) + Added(after)` pairs for the same table name are collapsed
///   into `RecreateTable` (these are emitted by `ClickHouseTableDiffStrategy` for ORDER BY,
///   PARTITION BY, engine, and primary key changes).
/// - `TableChange::Updated` is decomposed into individual column/index/projection deltas.
/// - `RecreateTable` deltas have a placeholder `DestructivePolicy` — the caller must fill
///   it in by prompting the user before persisting.
pub fn olap_changes_to_deltas(changes: &[OlapChange], default_database: &str) -> Vec<InfraDelta> {
    let mut deltas = Vec::new();
    let mut i = 0;

    while i < changes.len() {
        match &changes[i] {
            // Detect Removed+Added pairs → RecreateTable
            OlapChange::Table(TableChange::Removed(before)) => {
                if let Some(OlapChange::Table(TableChange::Added(after))) = changes.get(i + 1) {
                    if before.name == after.name {
                        deltas.push(InfraDelta::RecreateTable {
                            before: before.clone(),
                            after: after.clone(),
                            policy: DestructivePolicy {
                                description: format!(
                                    "Recreate table '{}' (pending user confirmation)",
                                    before.name
                                ),
                                approved_at: Utc::now(),
                            },
                        });
                        i += 2;
                        continue;
                    }
                }
                // Standalone removal
                deltas.push(InfraDelta::DropTable {
                    table: before.clone(),
                    policy: DestructivePolicy {
                        description: format!(
                            "Drop table '{}' (pending user confirmation)",
                            before.name
                        ),
                        approved_at: Utc::now(),
                    },
                });
            }

            OlapChange::Table(TableChange::Added(table)) => {
                deltas.push(InfraDelta::CreateTable {
                    table: table.clone(),
                });
            }

            OlapChange::Table(TableChange::Updated {
                before,
                after,
                column_changes,
                ..
            }) => {
                let table_id = before.id(default_database);
                decompose_table_update(&table_id, before, after, column_changes, &mut deltas);
            }

            OlapChange::Table(TableChange::SettingsChanged {
                table,
                before_settings,
                after_settings,
                ..
            }) => {
                deltas.push(InfraDelta::ModifyTableSettings {
                    table_id: table.id(default_database),
                    before: before_settings.clone(),
                    after: after_settings.clone(),
                });
            }

            OlapChange::Table(TableChange::TtlChanged {
                table,
                before,
                after,
                ..
            }) => {
                deltas.push(InfraDelta::ModifyTableTtl {
                    table_id: table.id(default_database),
                    before: before.clone(),
                    after: after.clone(),
                });
            }

            OlapChange::Table(TableChange::ValidationError { .. }) => {
                // Validation errors are caught by plan_validator; skip.
            }

            // ── Views ───────────────────────────────────────────
            OlapChange::MaterializedView(change) => match change {
                Change::Added(mv) => {
                    deltas.push(InfraDelta::CreateMaterializedView { mv: *mv.clone() })
                }
                Change::Removed(mv) => {
                    deltas.push(InfraDelta::DropMaterializedView { mv: *mv.clone() })
                }
                Change::Updated { before, after } => {
                    deltas.push(InfraDelta::DropMaterializedView {
                        mv: *before.clone(),
                    });
                    deltas.push(InfraDelta::CreateMaterializedView { mv: *after.clone() });
                }
            },

            OlapChange::View(change) => match change {
                Change::Added(view) => deltas.push(InfraDelta::CreateView {
                    view: *view.clone(),
                }),
                Change::Removed(view) => deltas.push(InfraDelta::DropView {
                    view: *view.clone(),
                }),
                Change::Updated { before, after } => {
                    deltas.push(InfraDelta::DropView {
                        view: *before.clone(),
                    });
                    deltas.push(InfraDelta::CreateView {
                        view: *after.clone(),
                    });
                }
            },

            OlapChange::Dmv1View(change) => match change {
                Change::Added(view) => deltas.push(InfraDelta::CreateDmv1View {
                    view: *view.clone(),
                }),
                Change::Removed(view) => deltas.push(InfraDelta::DropDmv1View {
                    view: *view.clone(),
                }),
                Change::Updated { before, after } => {
                    deltas.push(InfraDelta::DropDmv1View {
                        view: *before.clone(),
                    });
                    deltas.push(InfraDelta::CreateDmv1View {
                        view: *after.clone(),
                    });
                }
            },

            // ── Row policies ────────────────────────────────────
            OlapChange::SelectRowPolicy(change) => match change {
                Change::Added(policy) => deltas.push(InfraDelta::CreateRowPolicy {
                    policy: *policy.clone(),
                }),
                Change::Removed(policy) => deltas.push(InfraDelta::DropRowPolicy {
                    policy: *policy.clone(),
                }),
                Change::Updated { before, after } => {
                    deltas.push(InfraDelta::DropRowPolicy {
                        policy: *before.clone(),
                    });
                    deltas.push(InfraDelta::CreateRowPolicy {
                        policy: *after.clone(),
                    });
                }
            },

            // ── SQL resources ───────────────────────────────────
            OlapChange::SqlResource(change) => match change {
                Change::Added(resource) => deltas.push(InfraDelta::RunSetupSql {
                    resource: *resource.clone(),
                }),
                Change::Removed(resource) => deltas.push(InfraDelta::RunTeardownSql {
                    resource: *resource.clone(),
                }),
                Change::Updated { before, after } => {
                    deltas.push(InfraDelta::RunTeardownSql {
                        resource: *before.clone(),
                    });
                    deltas.push(InfraDelta::RunSetupSql {
                        resource: *after.clone(),
                    });
                }
            },

            // ── Populate MV ─────────────────────────────────────
            OlapChange::PopulateMaterializedView {
                view_name,
                target_table,
                target_database,
                select_statement,
                should_truncate,
                ..
            } => {
                deltas.push(InfraDelta::PopulateMaterializedView {
                    view_name: view_name.clone(),
                    target_table: target_table.clone(),
                    target_database: target_database.clone(),
                    select_statement: select_statement.clone(),
                    should_truncate: *should_truncate,
                });
            }
        }
        i += 1;
    }

    deltas
}

/// Decompose a `TableChange::Updated` into individual column/index/projection deltas.
fn decompose_table_update(
    table_id: &str,
    before: &Table,
    after: &Table,
    column_changes: &[ColumnChange],
    deltas: &mut Vec<InfraDelta>,
) {
    // Column changes
    for change in column_changes {
        match change {
            ColumnChange::Added {
                column,
                position_after,
            } => {
                deltas.push(InfraDelta::AddTableColumn {
                    table_id: table_id.to_string(),
                    column: column.clone(),
                    after_column: position_after.clone(),
                });
            }
            ColumnChange::Removed(column) => {
                deltas.push(InfraDelta::DropTableColumn {
                    table_id: table_id.to_string(),
                    column_name: column.name.clone(),
                });
            }
            ColumnChange::Updated {
                before: before_col,
                after: after_col,
            } => {
                deltas.push(InfraDelta::ModifyTableColumn {
                    table_id: table_id.to_string(),
                    before_column: before_col.clone(),
                    after_column: after_col.clone(),
                });
            }
            ColumnChange::Renamed {
                before: before_col,
                after: after_col,
                ..
            } => {
                deltas.push(InfraDelta::RenameTableColumn {
                    table_id: table_id.to_string(),
                    before_name: before_col.name.clone(),
                    after_name: after_col.name.clone(),
                });
            }
        }
    }

    // Index changes
    let before_indexes: HashMap<&str, &TableIndex> = before
        .indexes
        .iter()
        .map(|i| (i.name.as_str(), i))
        .collect();
    let after_indexes: HashMap<&str, &TableIndex> =
        after.indexes.iter().map(|i| (i.name.as_str(), i)).collect();

    for name in before_indexes.keys() {
        if !after_indexes.contains_key(name) {
            deltas.push(InfraDelta::DropTableIndex {
                table_id: table_id.to_string(),
                index_name: name.to_string(),
            });
        }
    }
    for (name, index) in &after_indexes {
        if let Some(before_index) = before_indexes.get(name) {
            // Same name exists — check if content changed
            if *before_index != *index {
                deltas.push(InfraDelta::DropTableIndex {
                    table_id: table_id.to_string(),
                    index_name: name.to_string(),
                });
                deltas.push(InfraDelta::AddTableIndex {
                    table_id: table_id.to_string(),
                    index: (*index).clone(),
                });
            }
        } else {
            deltas.push(InfraDelta::AddTableIndex {
                table_id: table_id.to_string(),
                index: (*index).clone(),
            });
        }
    }

    // Projection changes
    let before_projections: HashMap<&str, &TableProjection> = before
        .projections
        .iter()
        .map(|p| (p.name.as_str(), p))
        .collect();
    let after_projections: HashMap<&str, &TableProjection> = after
        .projections
        .iter()
        .map(|p| (p.name.as_str(), p))
        .collect();

    for name in before_projections.keys() {
        if !after_projections.contains_key(name) {
            deltas.push(InfraDelta::DropTableProjection {
                table_id: table_id.to_string(),
                projection_name: name.to_string(),
            });
        }
    }
    for (name, proj) in &after_projections {
        if let Some(before_proj) = before_projections.get(name) {
            // Same name exists — check if content changed
            if *before_proj != *proj {
                deltas.push(InfraDelta::DropTableProjection {
                    table_id: table_id.to_string(),
                    projection_name: name.to_string(),
                });
                deltas.push(InfraDelta::AddTableProjection {
                    table_id: table_id.to_string(),
                    projection: (*proj).clone(),
                });
            }
        } else {
            deltas.push(InfraDelta::AddTableProjection {
                table_id: table_id.to_string(),
                projection: (*proj).clone(),
            });
        }
    }

    // SAMPLE BY changes
    if before.sample_by != after.sample_by {
        match &after.sample_by {
            Some(expr) => deltas.push(InfraDelta::ModifySampleBy {
                table_id: table_id.to_string(),
                expression: expr.clone(),
            }),
            None => deltas.push(InfraDelta::RemoveSampleBy {
                table_id: table_id.to_string(),
            }),
        }
    }
}

/// Fill in real `DestructivePolicy` descriptions on destructive deltas using
/// information from the classified `PlanRisk`.
///
/// After `olap_changes_to_deltas` creates deltas with placeholder policies,
/// this function matches each destructive delta to its corresponding
/// `DestructiveChange` in the risk assessment and replaces the placeholder
/// with a human-readable description derived from the risk.
///
/// Call this after the user has confirmed destructive operations via
/// `migration_destructive_gate`.
pub fn fill_policies_from_risk(
    deltas: &mut [InfraDelta],
    risk: &crate::framework::core::plan_risk::PlanRisk,
) {
    use crate::framework::core::plan_risk::DestructiveChange;

    for delta in deltas.iter_mut() {
        match delta {
            InfraDelta::RecreateTable {
                before,
                ref mut policy,
                ..
            } => {
                // Find matching TableRecreate in risk
                let description = risk
                    .destructive_changes
                    .iter()
                    .find_map(|dc| match dc {
                        DestructiveChange::TableRecreate {
                            table_name_with_suffix,
                            reason,
                            ..
                        } if *table_name_with_suffix == before.name => Some(format!(
                            "User confirmed: DROP + RECREATE table '{}' ({})",
                            before.name, reason
                        )),
                        _ => None,
                    })
                    .unwrap_or_else(|| format!("User confirmed: recreate table '{}'", before.name));
                policy.description = description;
                policy.approved_at = Utc::now();
            }
            InfraDelta::DropTable {
                table,
                ref mut policy,
            } => {
                // Find matching TableDrop in risk
                let description = risk
                    .destructive_changes
                    .iter()
                    .find_map(|dc| match dc {
                        DestructiveChange::TableDrop {
                            table_name_with_suffix,
                            ..
                        } if *table_name_with_suffix == table.name => {
                            Some(format!("User confirmed: DROP TABLE '{}'", table.name))
                        }
                        _ => None,
                    })
                    .unwrap_or_else(|| format!("User confirmed: drop table '{}'", table.name));
                policy.description = description;
                policy.approved_at = Utc::now();
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{ColumnType, OrderBy, SeedFilter};
    use crate::framework::core::infrastructure_map::PrimitiveSignature;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

    const TEST_DB: &str = "test_db";

    fn make_test_table(name: &str) -> Table {
        Table {
            name: name.to_string(),
            columns: vec![make_test_column("id"), make_test_column("name")],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            engine: ClickhouseEngine::MergeTree,
            version: None,
            database: None,
            metadata: None,
            life_cycle: Default::default(),
            partition_by: None,
            sample_by: None,
            table_settings: None,
            table_ttl_setting: None,
            indexes: vec![],
            projections: vec![],
            engine_params_hash: None,
            table_settings_hash: None,
            cluster_name: None,
            primary_key_expression: None,
            seed_filter: SeedFilter::default(),
            source_primitive: PrimitiveSignature {
                name: name.to_string(),
                primitive_type:
                    crate::framework::core::infrastructure_map::PrimitiveTypes::DataModel,
            },
            constraints: vec![],
        }
    }

    fn make_test_column(name: &str) -> Column {
        Column {
            name: name.to_string(),
            data_type: ColumnType::String,
            required: true,
            unique: false,
            primary_key: name == "id",
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
            alias: None,
        }
    }

    fn make_test_index(name: &str) -> TableIndex {
        TableIndex {
            name: name.to_string(),
            expression: "id".to_string(),
            index_type: "minmax".to_string(),
            arguments: vec![],
            granularity: 1,
        }
    }

    fn make_test_projection(name: &str) -> TableProjection {
        TableProjection {
            name: name.to_string(),
            body: "SELECT id, name ORDER BY name".to_string(),
        }
    }

    fn make_policy() -> DestructivePolicy {
        DestructivePolicy {
            description: "test".to_string(),
            approved_at: Utc::now(),
        }
    }

    fn empty_map() -> InfrastructureMap {
        InfrastructureMap::default()
    }

    // ── CreateTable ─────────────────────────────────────────────

    #[test]
    fn test_apply_create_table() {
        let mut map = empty_map();
        let table = make_test_table("events");
        let delta = InfraDelta::CreateTable {
            table: table.clone(),
        };
        delta.apply(&mut map, TEST_DB).unwrap();
        assert!(map.tables.contains_key(&table.id(TEST_DB)));
    }

    #[test]
    fn test_apply_create_table_duplicate_errors() {
        let mut map = empty_map();
        let table = make_test_table("events");
        let delta = InfraDelta::CreateTable {
            table: table.clone(),
        };
        delta.apply(&mut map, TEST_DB).unwrap();
        let result = delta.apply(&mut map, TEST_DB);
        assert!(matches!(
            result,
            Err(DeltaApplyErrorKind::DuplicateTable { .. })
        ));
    }

    // ── DropTable ───────────────────────────────────────────────

    #[test]
    fn test_apply_drop_table() {
        let mut map = empty_map();
        let table = make_test_table("events");
        map.tables.insert(table.id(TEST_DB), table.clone());

        let delta = InfraDelta::DropTable {
            table: table.clone(),
            policy: make_policy(),
        };
        delta.apply(&mut map, TEST_DB).unwrap();
        assert!(!map.tables.contains_key(&table.id(TEST_DB)));
    }

    #[test]
    fn test_apply_drop_table_not_found_errors() {
        let mut map = empty_map();
        let table = make_test_table("events");
        let delta = InfraDelta::DropTable {
            table,
            policy: make_policy(),
        };
        let result = delta.apply(&mut map, TEST_DB);
        assert!(matches!(
            result,
            Err(DeltaApplyErrorKind::TableNotFound { .. })
        ));
    }

    // ── RecreateTable ───────────────────────────────────────────

    #[test]
    fn test_apply_recreate_table() {
        let mut map = empty_map();
        let before = make_test_table("events");
        let mut after = make_test_table("events");
        after.order_by = OrderBy::Fields(vec!["id".to_string(), "name".to_string()]);

        map.tables.insert(before.id(TEST_DB), before.clone());

        let delta = InfraDelta::RecreateTable {
            before: before.clone(),
            after: after.clone(),
            policy: make_policy(),
        };
        delta.apply(&mut map, TEST_DB).unwrap();

        let result = map.tables.get(&after.id(TEST_DB)).unwrap();
        assert_eq!(result.order_by, after.order_by);
    }

    // ── AddTableColumn ──────────────────────────────────────────

    #[test]
    fn test_apply_add_column() {
        let mut map = empty_map();
        let table = make_test_table("events");
        let table_id = table.id(TEST_DB);
        map.tables.insert(table_id.clone(), table);

        let new_col = make_test_column("email");
        let delta = InfraDelta::AddTableColumn {
            table_id: table_id.clone(),
            column: new_col.clone(),
            after_column: Some("id".to_string()),
        };
        delta.apply(&mut map, TEST_DB).unwrap();

        let t = map.tables.get(&table_id).unwrap();
        assert_eq!(t.columns.len(), 3);
        assert_eq!(t.columns[1].name, "email");
    }

    #[test]
    fn test_apply_add_column_at_start() {
        let mut map = empty_map();
        let table = make_test_table("events");
        let table_id = table.id(TEST_DB);
        map.tables.insert(table_id.clone(), table);

        let new_col = make_test_column("row_id");
        let delta = InfraDelta::AddTableColumn {
            table_id: table_id.clone(),
            column: new_col,
            after_column: None,
        };
        delta.apply(&mut map, TEST_DB).unwrap();

        let t = map.tables.get(&table_id).unwrap();
        assert_eq!(t.columns[0].name, "row_id");
    }

    // ── DropTableColumn ─────────────────────────────────────────

    #[test]
    fn test_apply_drop_column() {
        let mut map = empty_map();
        let table = make_test_table("events");
        let table_id = table.id(TEST_DB);
        map.tables.insert(table_id.clone(), table);

        let delta = InfraDelta::DropTableColumn {
            table_id: table_id.clone(),
            column_name: "name".to_string(),
        };
        delta.apply(&mut map, TEST_DB).unwrap();

        let t = map.tables.get(&table_id).unwrap();
        assert_eq!(t.columns.len(), 1);
        assert_eq!(t.columns[0].name, "id");
    }

    // ── ModifyTableColumn ───────────────────────────────────────

    #[test]
    fn test_apply_modify_column() {
        let mut map = empty_map();
        let table = make_test_table("events");
        let table_id = table.id(TEST_DB);
        map.tables.insert(table_id.clone(), table);

        let before_col = make_test_column("name");
        let mut after_col = make_test_column("name");
        after_col.data_type = ColumnType::Boolean;

        let delta = InfraDelta::ModifyTableColumn {
            table_id: table_id.clone(),
            before_column: before_col,
            after_column: after_col.clone(),
        };
        delta.apply(&mut map, TEST_DB).unwrap();

        let t = map.tables.get(&table_id).unwrap();
        let col = t.columns.iter().find(|c| c.name == "name").unwrap();
        assert_eq!(col.data_type, ColumnType::Boolean);
    }

    // ── RenameTableColumn ───────────────────────────────────────

    #[test]
    fn test_apply_rename_column() {
        let mut map = empty_map();
        let table = make_test_table("events");
        let table_id = table.id(TEST_DB);
        map.tables.insert(table_id.clone(), table);

        let delta = InfraDelta::RenameTableColumn {
            table_id: table_id.clone(),
            before_name: "name".to_string(),
            after_name: "full_name".to_string(),
        };
        delta.apply(&mut map, TEST_DB).unwrap();

        let t = map.tables.get(&table_id).unwrap();
        assert!(t.columns.iter().any(|c| c.name == "full_name"));
        assert!(!t.columns.iter().any(|c| c.name == "name"));
    }

    // ── ModifyTableSettings ─────────────────────────────────────

    #[test]
    fn test_apply_modify_settings() {
        let mut map = empty_map();
        let table = make_test_table("events");
        let table_id = table.id(TEST_DB);
        map.tables.insert(table_id.clone(), table);

        let new_settings = HashMap::from([("index_granularity".to_string(), "4096".to_string())]);
        let delta = InfraDelta::ModifyTableSettings {
            table_id: table_id.clone(),
            before: None,
            after: Some(new_settings.clone()),
        };
        delta.apply(&mut map, TEST_DB).unwrap();

        let t = map.tables.get(&table_id).unwrap();
        assert_eq!(t.table_settings, Some(new_settings));
    }

    // ── ModifyTableTtl ──────────────────────────────────────────

    #[test]
    fn test_apply_modify_ttl() {
        let mut map = empty_map();
        let table = make_test_table("events");
        let table_id = table.id(TEST_DB);
        map.tables.insert(table_id.clone(), table);

        let delta = InfraDelta::ModifyTableTtl {
            table_id: table_id.clone(),
            before: None,
            after: Some("timestamp + INTERVAL 30 DAY".to_string()),
        };
        delta.apply(&mut map, TEST_DB).unwrap();

        let t = map.tables.get(&table_id).unwrap();
        assert_eq!(
            t.table_ttl_setting,
            Some("timestamp + INTERVAL 30 DAY".to_string())
        );
    }

    // ── Index operations ────────────────────────────────────────

    #[test]
    fn test_apply_add_and_drop_index() {
        let mut map = empty_map();
        let table = make_test_table("events");
        let table_id = table.id(TEST_DB);
        map.tables.insert(table_id.clone(), table);

        let index = make_test_index("idx_id");
        let add_delta = InfraDelta::AddTableIndex {
            table_id: table_id.clone(),
            index: index.clone(),
        };
        add_delta.apply(&mut map, TEST_DB).unwrap();
        assert_eq!(map.tables.get(&table_id).unwrap().indexes.len(), 1);

        let drop_delta = InfraDelta::DropTableIndex {
            table_id: table_id.clone(),
            index_name: "idx_id".to_string(),
        };
        drop_delta.apply(&mut map, TEST_DB).unwrap();
        assert_eq!(map.tables.get(&table_id).unwrap().indexes.len(), 0);
    }

    // ── Projection operations ───────────────────────────────────

    #[test]
    fn test_apply_add_and_drop_projection() {
        let mut map = empty_map();
        let table = make_test_table("events");
        let table_id = table.id(TEST_DB);
        map.tables.insert(table_id.clone(), table);

        let proj = make_test_projection("proj_name");
        let add_delta = InfraDelta::AddTableProjection {
            table_id: table_id.clone(),
            projection: proj,
        };
        add_delta.apply(&mut map, TEST_DB).unwrap();
        assert_eq!(map.tables.get(&table_id).unwrap().projections.len(), 1);

        let drop_delta = InfraDelta::DropTableProjection {
            table_id: table_id.clone(),
            projection_name: "proj_name".to_string(),
        };
        drop_delta.apply(&mut map, TEST_DB).unwrap();
        assert_eq!(map.tables.get(&table_id).unwrap().projections.len(), 0);
    }

    // ── SAMPLE BY ───────────────────────────────────────────────

    #[test]
    fn test_apply_modify_and_remove_sample_by() {
        let mut map = empty_map();
        let table = make_test_table("events");
        let table_id = table.id(TEST_DB);
        map.tables.insert(table_id.clone(), table);

        let modify_delta = InfraDelta::ModifySampleBy {
            table_id: table_id.clone(),
            expression: "cityHash64(id)".to_string(),
        };
        modify_delta.apply(&mut map, TEST_DB).unwrap();
        assert_eq!(
            map.tables.get(&table_id).unwrap().sample_by,
            Some("cityHash64(id)".to_string())
        );

        let remove_delta = InfraDelta::RemoveSampleBy {
            table_id: table_id.clone(),
        };
        remove_delta.apply(&mut map, TEST_DB).unwrap();
        assert_eq!(map.tables.get(&table_id).unwrap().sample_by, None);
    }

    // ── Execution-only no-ops ───────────────────────────────────

    #[test]
    fn test_apply_backfill_is_noop() {
        let mut map = empty_map();
        let delta = InfraDelta::BackfillTable {
            source_table: "old".to_string(),
            target_table: "new".to_string(),
            columns: vec!["id".to_string()],
            sql: "INSERT INTO new SELECT * FROM old".to_string(),
        };
        delta.apply(&mut map, TEST_DB).unwrap();
        assert!(map.tables.is_empty());
    }

    #[test]
    fn test_apply_populate_mv_is_noop() {
        let mut map = empty_map();
        let delta = InfraDelta::PopulateMaterializedView {
            view_name: "mv_test".to_string(),
            target_table: "target".to_string(),
            target_database: None,
            select_statement: "SELECT * FROM source".to_string(),
            should_truncate: false,
        };
        delta.apply(&mut map, TEST_DB).unwrap();
        assert!(map.materialized_views.is_empty());
    }

    // ── Fold: full sequence from empty map ──────────────────────

    #[test]
    fn test_fold_builds_complete_map() {
        let mut map = empty_map();
        let table = make_test_table("events");
        let table_id = table.id(TEST_DB);

        let deltas: Vec<InfraDelta> = vec![
            InfraDelta::CreateTable {
                table: table.clone(),
            },
            InfraDelta::AddTableColumn {
                table_id: table_id.clone(),
                column: make_test_column("email"),
                after_column: Some("name".to_string()),
            },
            InfraDelta::AddTableIndex {
                table_id: table_id.clone(),
                index: make_test_index("idx_id"),
            },
            InfraDelta::ModifyTableTtl {
                table_id: table_id.clone(),
                before: None,
                after: Some("id + INTERVAL 7 DAY".to_string()),
            },
        ];

        for delta in &deltas {
            delta.apply(&mut map, TEST_DB).unwrap();
        }

        let result = map.tables.get(&table_id).unwrap();
        assert_eq!(result.columns.len(), 3);
        assert_eq!(result.columns[2].name, "email");
        assert_eq!(result.indexes.len(), 1);
        assert_eq!(
            result.table_ttl_setting,
            Some("id + INTERVAL 7 DAY".to_string())
        );
    }

    // ── Serde round-trip ────────────────────────────────────────

    #[test]
    fn test_serde_roundtrip_create_table() {
        let delta = InfraDelta::CreateTable {
            table: make_test_table("events"),
        };
        let yaml = serde_yaml::to_string(&delta).unwrap();
        let deserialized: InfraDelta = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(delta, deserialized);
    }

    #[test]
    fn test_serde_roundtrip_recreate_table() {
        let before = make_test_table("events");
        let mut after = make_test_table("events");
        after.order_by = OrderBy::Fields(vec!["id".to_string(), "name".to_string()]);

        let delta = InfraDelta::RecreateTable {
            before,
            after,
            policy: make_policy(),
        };
        let yaml = serde_yaml::to_string(&delta).unwrap();
        let deserialized: InfraDelta = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(delta, deserialized);
    }

    #[test]
    fn test_serde_roundtrip_column_ops() {
        let deltas = vec![
            InfraDelta::AddTableColumn {
                table_id: "test_db_events".to_string(),
                column: make_test_column("email"),
                after_column: Some("id".to_string()),
            },
            InfraDelta::DropTableColumn {
                table_id: "test_db_events".to_string(),
                column_name: "name".to_string(),
            },
            InfraDelta::RenameTableColumn {
                table_id: "test_db_events".to_string(),
                before_name: "name".to_string(),
                after_name: "full_name".to_string(),
            },
        ];

        for delta in &deltas {
            let yaml = serde_yaml::to_string(delta).unwrap();
            let deserialized: InfraDelta = serde_yaml::from_str(&yaml).unwrap();
            assert_eq!(*delta, deserialized);
        }
    }
}
