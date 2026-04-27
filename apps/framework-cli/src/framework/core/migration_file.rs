use crate::framework::core::infra_delta::{DeltaApplyErrorKind, InfraDelta};
use crate::framework::core::infrastructure::consumption_webserver::ConsumptionApiWebServer;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// A single migration file containing an ordered sequence of deltas.
///
/// This is the unit of atomicity: all deltas in a file are applied together.
/// Migration files are committed to the repo and named with a timestamp-based ID
/// for ordering (e.g., `20260406_153022_change_events_order_by.yaml`).
///
/// The `parent_state_hash` records the OLAP hash of the infrastructure map at the
/// time this migration was generated. This enables conflict detection when merging
/// branches: if two migrations share the same parent hash, they were generated
/// against the same base state and can be checked for semantic conflicts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MigrationFile {
    /// Unique ID for ordering: "YYYYMMDD_HHMMSS_description"
    pub id: String,
    /// Human-readable description of what this migration does
    pub description: String,
    /// SHA-256 hash of the OLAP portion of the InfrastructureMap this was generated against
    pub parent_state_hash: String,
    /// Ordered deltas — applied sequentially within this file
    pub deltas: Vec<InfraDelta>,
    /// Timestamp when this migration was generated
    pub created_at: DateTime<Utc>,
}

/// An ordered sequence of migration files representing the full migration history.
///
/// The fold `reconstruct_olap_map` applies all deltas from all files in order
/// to produce the current OLAP infrastructure map.
#[derive(Debug, Clone)]
pub struct MigrationHistory {
    /// Migration files sorted by ID (chronological order)
    pub files: Vec<MigrationFile>,
}

/// Error loading migration files from disk
#[derive(Debug, thiserror::Error)]
#[error("failed to load migration from '{path}'")]
pub struct MigrationLoadError {
    pub path: String,
    #[source]
    pub kind: MigrationLoadErrorKind,
}

/// Specific reasons a migration file load can fail
#[derive(Debug, thiserror::Error)]
pub enum MigrationLoadErrorKind {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("YAML parse error: {0}")]
    Yaml(#[from] serde_yaml::Error),
}

/// Error applying a migration history
#[derive(Debug, thiserror::Error)]
pub enum MigrationHistoryError {
    #[error("failed to apply delta in migration '{migration_id}': {kind}")]
    DeltaApplyFailed {
        migration_id: String,
        #[source]
        kind: DeltaApplyErrorKind,
    },

    #[error(
        "parent state hash mismatch in migration '{migration_id}': expected '{expected}', got '{actual}'"
    )]
    HashMismatch {
        migration_id: String,
        expected: String,
        actual: String,
    },
}

/// Differences in a single category of OLAP resources (tables, views, etc.)
/// between an expected state and the actual database state.
///
/// "Extra" = in actual but not expected (drifted in — someone added it outside the migration log).
/// "Missing" = in expected but not actual (drifted out — someone removed it outside the migration log).
/// "Changed" = in both but with schema differences.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DriftCategory {
    pub extra: Vec<String>,
    pub missing: Vec<String>,
    pub changed: Vec<String>,
}

impl DriftCategory {
    pub fn is_empty(&self) -> bool {
        self.extra.is_empty() && self.missing.is_empty() && self.changed.is_empty()
    }
}

/// Forensic report of the divergence between an expected infrastructure map
/// (typically the fold of applied migrations) and the actual live map.
///
/// Produced when `validate_parent_hash` fails, so the user can see exactly
/// which tables/views/etc. drifted rather than just a hash mismatch.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DriftReport {
    pub tables: DriftCategory,
    pub views: DriftCategory,
    pub materialized_views: DriftCategory,
    pub dmv1_views: DriftCategory,
    pub select_row_policies: DriftCategory,
    pub sql_resources: DriftCategory,
}

impl DriftReport {
    pub fn is_empty(&self) -> bool {
        self.tables.is_empty()
            && self.views.is_empty()
            && self.materialized_views.is_empty()
            && self.dmv1_views.is_empty()
            && self.select_row_policies.is_empty()
            && self.sql_resources.is_empty()
    }
}

impl std::fmt::Display for DriftReport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write_drift_category(f, "Tables", &self.tables)?;
        write_drift_category(f, "Views", &self.views)?;
        write_drift_category(f, "Materialized views", &self.materialized_views)?;
        write_drift_category(f, "DMv1 views", &self.dmv1_views)?;
        write_drift_category(f, "Row policies", &self.select_row_policies)?;
        write_drift_category(f, "SQL resources", &self.sql_resources)?;
        Ok(())
    }
}

fn write_drift_category(
    f: &mut std::fmt::Formatter<'_>,
    label: &str,
    cat: &DriftCategory,
) -> std::fmt::Result {
    if cat.is_empty() {
        return Ok(());
    }
    writeln!(f, "{}:", label)?;
    for item in &cat.extra {
        writeln!(
            f,
            "  + {} (present in database but not in migration log)",
            item
        )?;
    }
    for item in &cat.missing {
        writeln!(
            f,
            "  - {} (in migration log but missing from database)",
            item
        )?;
    }
    for item in &cat.changed {
        writeln!(f, "  ~ {} (schema differs from migration log)", item)?;
    }
    Ok(())
}

/// Compute a drift report between an expected infrastructure map (typically
/// the fold of applied migrations) and the actual live map.
pub fn compute_drift(expected: &InfrastructureMap, actual: &InfrastructureMap) -> DriftReport {
    DriftReport {
        tables: diff_map(&expected.tables, &actual.tables),
        views: diff_map(&expected.views, &actual.views),
        materialized_views: diff_map(&expected.materialized_views, &actual.materialized_views),
        dmv1_views: diff_map(&expected.dmv1_views, &actual.dmv1_views),
        select_row_policies: diff_map(&expected.select_row_policies, &actual.select_row_policies),
        sql_resources: diff_map(&expected.sql_resources, &actual.sql_resources),
    }
}

/// Key-by-key diff of two HashMaps: categorize keys as extra (only in actual),
/// missing (only in expected), or changed (in both but values differ).
fn diff_map<T: PartialEq>(
    expected: &HashMap<String, T>,
    actual: &HashMap<String, T>,
) -> DriftCategory {
    let mut extra = Vec::new();
    let mut missing = Vec::new();
    let mut changed = Vec::new();

    for (key, actual_val) in actual {
        match expected.get(key) {
            None => extra.push(key.clone()),
            Some(expected_val) => {
                if expected_val != actual_val {
                    changed.push(key.clone());
                }
            }
        }
    }
    for key in expected.keys() {
        if !actual.contains_key(key) {
            missing.push(key.clone());
        }
    }

    extra.sort();
    missing.sort();
    changed.sort();

    DriftCategory {
        extra,
        missing,
        changed,
    }
}

/// A semantic conflict detected between two branches' migration files.
#[derive(Debug, Clone, PartialEq)]
pub enum MigrationConflict {
    /// Both branches modify the same table
    SameTableModified {
        table_id: String,
        branch_a_migration: String,
        branch_b_migration: String,
    },
    /// One branch drops a table that the other modifies
    TableDroppedAndModified {
        table_id: String,
        dropper: String,
        modifier: String,
    },
}

impl MigrationFile {
    /// Create a new migration file with a timestamp-based ID.
    pub fn new(description: String, parent_state_hash: String, deltas: Vec<InfraDelta>) -> Self {
        let now = Utc::now();
        let timestamp = now.format("%Y%m%d_%H%M%S_%3f");
        // Sanitize description into a filesystem-safe slug: lowercase ASCII
        // alphanumerics survive verbatim; everything else (whitespace, path
        // separators, punctuation, non-ASCII) collapses to a single `_`. This
        // prevents user-provided descriptions like `backfill users/orders`
        // from producing nested `id` paths that fail on file write.
        let slug: String = description
            .to_lowercase()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect::<String>()
            .split('_')
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("_");
        let id = format!("{}_{}", timestamp, slug);

        Self {
            id,
            description,
            parent_state_hash,
            deltas,
            created_at: now,
        }
    }

    /// Serialize this migration file to YAML.
    pub fn to_yaml(&self) -> Result<String, serde_yaml::Error> {
        serde_yaml::to_string(self)
    }

    /// Deserialize a migration file from YAML.
    pub fn from_yaml(yaml: &str) -> Result<Self, serde_yaml::Error> {
        serde_yaml::from_str(yaml)
    }

    /// Validate that this migration file's `parent_state_hash` matches the given actual hash.
    ///
    /// Used by `moose migrate` to ensure a migration is applied only against the same
    /// base state it was generated against. A mismatch indicates the live database has
    /// diverged (e.g., migrations from another branch were applied, manual DDL was run,
    /// or this migration is stale) and applying this file anyway could silently corrupt
    /// state — so callers must treat a mismatch as a hard error.
    pub fn validate_parent_hash(&self, actual_hash: &str) -> Result<(), MigrationHistoryError> {
        if self.parent_state_hash != actual_hash {
            return Err(MigrationHistoryError::HashMismatch {
                migration_id: self.id.clone(),
                expected: self.parent_state_hash.clone(),
                actual: actual_hash.to_string(),
            });
        }
        Ok(())
    }

    /// Returns a list of all table IDs touched by deltas in this file.
    pub fn touched_table_ids(&self, default_database: &str) -> Vec<String> {
        let mut ids = Vec::new();
        for delta in &self.deltas {
            if let Some(id) = delta_table_id(delta, default_database) {
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
        ids
    }
}

impl MigrationHistory {
    /// Load all migration files from a directory, sorted by ID.
    ///
    /// Reads all `.yaml` files in the directory (excluding `plan.yaml` for
    /// backward compatibility), parses them as MigrationFiles, and sorts
    /// by ID for deterministic ordering.
    pub fn load_from_dir(dir: &Path) -> Result<Self, MigrationLoadError> {
        let mut files = Vec::new();

        let entries = std::fs::read_dir(dir).map_err(|e| MigrationLoadError {
            path: dir.display().to_string(),
            kind: MigrationLoadErrorKind::Io(e),
        })?;

        for entry in entries {
            let entry = entry.map_err(|e| MigrationLoadError {
                path: dir.display().to_string(),
                kind: MigrationLoadErrorKind::Io(e),
            })?;

            let path = entry.path();

            // Skip non-YAML files and legacy plan.yaml
            if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
                continue;
            }
            if path.file_name().and_then(|n| n.to_str()) == Some("plan.yaml") {
                continue;
            }
            if path.file_name().and_then(|n| n.to_str()) == Some("pending.yaml") {
                continue;
            }

            let content = std::fs::read_to_string(&path).map_err(|e| MigrationLoadError {
                path: path.display().to_string(),
                kind: MigrationLoadErrorKind::Io(e),
            })?;

            let migration = MigrationFile::from_yaml(&content).map_err(|e| MigrationLoadError {
                path: path.display().to_string(),
                kind: MigrationLoadErrorKind::Yaml(e),
            })?;

            files.push(migration);
        }

        files.sort_by(|a, b| a.id.cmp(&b.id));

        Ok(Self { files })
    }

    /// Reconstruct the OLAP portion of the infrastructure map by folding all deltas.
    ///
    /// Starts from an empty map and applies every delta from every migration file
    /// in order. Non-OLAP fields (topics, APIs, processes) are left at defaults.
    ///
    /// # Errors
    /// Returns `MigrationHistoryError` if any delta fails to apply.
    pub fn reconstruct_olap_map(
        &self,
        default_database: &str,
    ) -> Result<InfrastructureMap, MigrationHistoryError> {
        let mut map = InfrastructureMap {
            default_database: default_database.to_string(),
            topics: HashMap::new(),
            api_endpoints: HashMap::new(),
            tables: HashMap::new(),
            dmv1_views: HashMap::new(),
            topic_to_table_sync_processes: HashMap::new(),
            topic_to_topic_sync_processes: HashMap::new(),
            function_processes: HashMap::new(),
            consumption_api_web_server: ConsumptionApiWebServer {},
            orchestration_workers: HashMap::new(),
            sql_resources: HashMap::new(),
            workflows: HashMap::new(),
            web_apps: HashMap::new(),
            materialized_views: HashMap::new(),
            views: HashMap::new(),
            select_row_policies: HashMap::new(),
            olap_dictionaries: HashMap::new(),
            moose_version: None,
        };

        for file in &self.files {
            for delta in &file.deltas {
                delta.apply(&mut map, default_database).map_err(|kind| {
                    MigrationHistoryError::DeltaApplyFailed {
                        migration_id: file.id.clone(),
                        kind,
                    }
                })?;
            }
        }

        Ok(map)
    }

    /// Fold only the migration files whose IDs appear in `applied_ids`, preserving file order.
    ///
    /// Used when a hash mismatch is detected during `moose migrate` to reconstruct
    /// what the database *should* look like according to the applied migration log,
    /// so the caller can diff it against the live database and show forensics.
    pub fn reconstruct_olap_map_for_applied(
        &self,
        default_database: &str,
        applied_ids: &[String],
    ) -> Result<InfrastructureMap, MigrationHistoryError> {
        let subset = Self {
            files: self
                .files
                .iter()
                .filter(|f| applied_ids.iter().any(|id| id == &f.id))
                .cloned()
                .collect(),
        };
        subset.reconstruct_olap_map(default_database)
    }

    /// Detect semantic conflicts between two sets of migration files.
    ///
    /// Given migrations from two branches (both forking from the same base state),
    /// checks whether they touch the same resources in incompatible ways.
    pub fn detect_conflicts(
        branch_a: &[MigrationFile],
        branch_b: &[MigrationFile],
        default_database: &str,
    ) -> Vec<MigrationConflict> {
        let mut conflicts = Vec::new();

        // Build table_id → migration_id maps for each branch
        let a_tables = collect_table_ops(branch_a, default_database);
        let b_tables = collect_table_ops(branch_b, default_database);

        for (table_id, a_ops) in &a_tables {
            if let Some(b_ops) = b_tables.get(table_id) {
                let a_drops = a_ops.iter().any(|(_, is_drop)| *is_drop);
                let b_drops = b_ops.iter().any(|(_, is_drop)| *is_drop);

                let a_migration = &a_ops[0].0;
                let b_migration = &b_ops[0].0;

                if a_drops || b_drops {
                    let (dropper, modifier) = if a_drops {
                        (a_migration.clone(), b_migration.clone())
                    } else {
                        (b_migration.clone(), a_migration.clone())
                    };
                    conflicts.push(MigrationConflict::TableDroppedAndModified {
                        table_id: table_id.clone(),
                        dropper,
                        modifier,
                    });
                } else {
                    conflicts.push(MigrationConflict::SameTableModified {
                        table_id: table_id.clone(),
                        branch_a_migration: a_migration.clone(),
                        branch_b_migration: b_migration.clone(),
                    });
                }
            }
        }

        conflicts
    }

    /// Returns true if the history has no migration files.
    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Extract the table ID affected by a delta, if any.
///
/// Uses `Table::id(default_database)` for lifecycle variants (Create/Drop/Recreate)
/// to produce the same qualified format as the `table_id` field in column mutations.
fn delta_table_id(delta: &InfraDelta, default_database: &str) -> Option<String> {
    match delta {
        InfraDelta::CreateTable { table } => Some(table.id(default_database)),
        InfraDelta::DropTable { table, .. } => Some(table.id(default_database)),
        InfraDelta::RecreateTable { before, .. } => Some(before.id(default_database)),
        InfraDelta::AddTableColumn { table_id, .. }
        | InfraDelta::DropTableColumn { table_id, .. }
        | InfraDelta::ModifyTableColumn { table_id, .. }
        | InfraDelta::RenameTableColumn { table_id, .. }
        | InfraDelta::ModifyTableSettings { table_id, .. }
        | InfraDelta::ModifyTableTtl { table_id, .. }
        | InfraDelta::AddTableIndex { table_id, .. }
        | InfraDelta::DropTableIndex { table_id, .. }
        | InfraDelta::AddTableProjection { table_id, .. }
        | InfraDelta::DropTableProjection { table_id, .. }
        | InfraDelta::ModifySampleBy { table_id, .. }
        | InfraDelta::RemoveSampleBy { table_id } => Some(table_id.clone()),
        // Non-table deltas
        _ => None,
    }
}

/// Collect table operations from migration files: table_id → [(migration_id, is_drop)]
fn collect_table_ops(
    files: &[MigrationFile],
    default_database: &str,
) -> std::collections::HashMap<String, Vec<(String, bool)>> {
    let mut result: std::collections::HashMap<String, Vec<(String, bool)>> =
        std::collections::HashMap::new();

    for file in files {
        for delta in &file.deltas {
            if let Some(table_id) = delta_table_id(delta, default_database) {
                let is_drop = matches!(
                    delta,
                    InfraDelta::DropTable { .. } | InfraDelta::RecreateTable { .. }
                );
                result
                    .entry(table_id)
                    .or_default()
                    .push((file.id.clone(), is_drop));
            }
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infra_delta::DestructivePolicy;
    use crate::framework::core::infrastructure::table::{
        Column, ColumnType, OrderBy, SeedFilter, Table,
    };
    use crate::framework::core::infrastructure_map::PrimitiveSignature;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

    const TEST_DB: &str = "test_db";

    fn make_test_table(name: &str) -> Table {
        Table {
            name: name.to_string(),
            columns: vec![Column {
                name: "id".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: true,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
                codec: None,
                materialized: None,
                alias: None,
            }],
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

    fn make_policy() -> DestructivePolicy {
        DestructivePolicy {
            description: "test".to_string(),
            approved_at: Utc::now(),
        }
    }

    #[test]
    fn test_reconstruct_olap_map_from_fold() {
        let table_a = make_test_table("events");
        let table_b = make_test_table("users");

        let migration = MigrationFile {
            id: "20260406_150000_init".to_string(),
            description: "Initial tables".to_string(),
            parent_state_hash: "0".repeat(64),
            deltas: vec![
                InfraDelta::CreateTable {
                    table: table_a.clone(),
                },
                InfraDelta::CreateTable {
                    table: table_b.clone(),
                },
            ],
            created_at: Utc::now(),
        };

        let history = MigrationHistory {
            files: vec![migration],
        };

        let map = history.reconstruct_olap_map(TEST_DB).unwrap();
        assert_eq!(map.tables.len(), 2);
        assert!(map.tables.contains_key(&table_a.id(TEST_DB)));
        assert!(map.tables.contains_key(&table_b.id(TEST_DB)));
    }

    #[test]
    fn test_reconstruct_across_multiple_migrations() {
        let table = make_test_table("events");
        let table_id = table.id(TEST_DB);

        let m1 = MigrationFile {
            id: "20260406_150000_create".to_string(),
            description: "Create events".to_string(),
            parent_state_hash: "a".repeat(64),
            deltas: vec![InfraDelta::CreateTable {
                table: table.clone(),
            }],
            created_at: Utc::now(),
        };

        let m2 = MigrationFile {
            id: "20260407_100000_add_col".to_string(),
            description: "Add email column".to_string(),
            parent_state_hash: "b".repeat(64),
            deltas: vec![InfraDelta::AddTableColumn {
                table_id: table_id.clone(),
                column: Column {
                    name: "email".to_string(),
                    data_type: ColumnType::String,
                    required: false,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                    codec: None,
                    materialized: None,
                    alias: None,
                },
                after_column: Some("id".to_string()),
            }],
            created_at: Utc::now(),
        };

        let history = MigrationHistory {
            files: vec![m1, m2],
        };

        let map = history.reconstruct_olap_map(TEST_DB).unwrap();
        let result = map.tables.get(&table_id).unwrap();
        assert_eq!(result.columns.len(), 2);
        assert_eq!(result.columns[1].name, "email");
    }

    #[test]
    fn test_reconstruct_fails_on_bad_delta() {
        let m = MigrationFile {
            id: "20260406_150000_bad".to_string(),
            description: "Bad delta".to_string(),
            parent_state_hash: "0".repeat(64),
            deltas: vec![InfraDelta::AddTableColumn {
                table_id: "nonexistent".to_string(),
                column: Column {
                    name: "x".to_string(),
                    data_type: ColumnType::String,
                    required: false,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                    codec: None,
                    materialized: None,
                    alias: None,
                },
                after_column: None,
            }],
            created_at: Utc::now(),
        };

        let history = MigrationHistory { files: vec![m] };

        let result = history.reconstruct_olap_map(TEST_DB);
        assert!(matches!(
            result,
            Err(MigrationHistoryError::DeltaApplyFailed { .. })
        ));
    }

    #[test]
    fn test_detect_conflicts_same_table() {
        let a = vec![MigrationFile {
            id: "a_001".to_string(),
            description: "Branch A".to_string(),
            parent_state_hash: "0".repeat(64),
            deltas: vec![InfraDelta::AddTableColumn {
                table_id: "test_db_events".to_string(),
                column: Column {
                    name: "email".to_string(),
                    data_type: ColumnType::String,
                    required: false,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                    codec: None,
                    materialized: None,
                    alias: None,
                },
                after_column: None,
            }],
            created_at: Utc::now(),
        }];

        let b = vec![MigrationFile {
            id: "b_001".to_string(),
            description: "Branch B".to_string(),
            parent_state_hash: "0".repeat(64),
            deltas: vec![InfraDelta::AddTableColumn {
                table_id: "test_db_events".to_string(),
                column: Column {
                    name: "phone".to_string(),
                    data_type: ColumnType::String,
                    required: false,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                    codec: None,
                    materialized: None,
                    alias: None,
                },
                after_column: None,
            }],
            created_at: Utc::now(),
        }];

        let conflicts = MigrationHistory::detect_conflicts(&a, &b, TEST_DB);
        assert_eq!(conflicts.len(), 1);
        assert!(matches!(
            &conflicts[0],
            MigrationConflict::SameTableModified {
                table_id,
                ..
            } if table_id == "test_db_events"
        ));
    }

    #[test]
    fn test_detect_conflicts_drop_and_modify() {
        let a = vec![MigrationFile {
            id: "a_001".to_string(),
            description: "Branch A drops".to_string(),
            parent_state_hash: "0".repeat(64),
            deltas: vec![InfraDelta::DropTable {
                table: make_test_table("events"),
                policy: make_policy(),
            }],
            created_at: Utc::now(),
        }];

        let b = vec![MigrationFile {
            id: "b_001".to_string(),
            description: "Branch B modifies".to_string(),
            parent_state_hash: "0".repeat(64),
            deltas: vec![InfraDelta::AddTableColumn {
                table_id: "test_db_events".to_string(),
                column: Column {
                    name: "email".to_string(),
                    data_type: ColumnType::String,
                    required: false,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                    codec: None,
                    materialized: None,
                    alias: None,
                },
                after_column: None,
            }],
            created_at: Utc::now(),
        }];

        let conflicts = MigrationHistory::detect_conflicts(&a, &b, TEST_DB);
        assert_eq!(conflicts.len(), 1);
        assert!(matches!(
            &conflicts[0],
            MigrationConflict::TableDroppedAndModified { .. }
        ));
    }

    #[test]
    fn test_no_conflicts_different_tables() {
        let a = vec![MigrationFile {
            id: "a_001".to_string(),
            description: "Branch A".to_string(),
            parent_state_hash: "0".repeat(64),
            deltas: vec![InfraDelta::CreateTable {
                table: make_test_table("events"),
            }],
            created_at: Utc::now(),
        }];

        let b = vec![MigrationFile {
            id: "b_001".to_string(),
            description: "Branch B".to_string(),
            parent_state_hash: "0".repeat(64),
            deltas: vec![InfraDelta::CreateTable {
                table: make_test_table("users"),
            }],
            created_at: Utc::now(),
        }];

        let conflicts = MigrationHistory::detect_conflicts(&a, &b, TEST_DB);
        assert!(conflicts.is_empty());
    }

    #[test]
    fn test_migration_file_yaml_roundtrip() {
        let migration = MigrationFile {
            id: "20260406_150000_test".to_string(),
            description: "Test migration".to_string(),
            parent_state_hash: "abc123".to_string(),
            deltas: vec![InfraDelta::CreateTable {
                table: make_test_table("events"),
            }],
            created_at: Utc::now(),
        };

        let yaml = migration.to_yaml().unwrap();
        let parsed = MigrationFile::from_yaml(&yaml).unwrap();
        assert_eq!(migration.id, parsed.id);
        assert_eq!(migration.deltas.len(), parsed.deltas.len());
    }

    #[test]
    fn test_touched_table_ids() {
        let migration = MigrationFile {
            id: "test".to_string(),
            description: "test".to_string(),
            parent_state_hash: "0".repeat(64),
            deltas: vec![
                InfraDelta::CreateTable {
                    table: make_test_table("events"),
                },
                InfraDelta::AddTableColumn {
                    table_id: "test_db_events".to_string(),
                    column: Column {
                        name: "x".to_string(),
                        data_type: ColumnType::String,
                        required: false,
                        unique: false,
                        primary_key: false,
                        default: None,
                        annotations: vec![],
                        comment: None,
                        ttl: None,
                        codec: None,
                        materialized: None,
                        alias: None,
                    },
                    after_column: None,
                },
                InfraDelta::CreateTable {
                    table: make_test_table("users"),
                },
            ],
            created_at: Utc::now(),
        };

        let ids = migration.touched_table_ids(TEST_DB);
        // CreateTable("events") → "test_db_events", AddTableColumn("test_db_events"), CreateTable("users") → "test_db_users"
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"test_db_events".to_string()));
        assert!(ids.contains(&"test_db_users".to_string()));
    }

    #[test]
    fn test_validate_parent_hash_matches_returns_ok() {
        let file = MigrationFile {
            id: "20260406_150000_test".to_string(),
            description: "test".to_string(),
            parent_state_hash: "abc123".to_string(),
            deltas: vec![],
            created_at: Utc::now(),
        };

        assert!(file.validate_parent_hash("abc123").is_ok());
    }

    #[test]
    fn test_compute_drift_identical_maps_is_empty() {
        let table = make_test_table("events");
        let mut map = InfrastructureMap {
            default_database: TEST_DB.to_string(),
            topics: HashMap::new(),
            api_endpoints: HashMap::new(),
            tables: HashMap::new(),
            dmv1_views: HashMap::new(),
            topic_to_table_sync_processes: HashMap::new(),
            topic_to_topic_sync_processes: HashMap::new(),
            function_processes: HashMap::new(),
            consumption_api_web_server: ConsumptionApiWebServer {},
            orchestration_workers: HashMap::new(),
            sql_resources: HashMap::new(),
            workflows: HashMap::new(),
            web_apps: HashMap::new(),
            materialized_views: HashMap::new(),
            views: HashMap::new(),
            select_row_policies: HashMap::new(),
            olap_dictionaries: HashMap::new(),
            moose_version: None,
        };
        map.tables.insert(table.id(TEST_DB), table);

        let drift = compute_drift(&map, &map);

        assert!(drift.is_empty());
    }

    #[test]
    fn test_compute_drift_detects_extra_table_in_actual() {
        let events = make_test_table("events");
        let users = make_test_table("users");

        let mut expected = empty_infra_map();
        expected.tables.insert(events.id(TEST_DB), events.clone());

        let mut actual = empty_infra_map();
        actual.tables.insert(events.id(TEST_DB), events);
        actual.tables.insert(users.id(TEST_DB), users);

        let drift = compute_drift(&expected, &actual);

        assert_eq!(drift.tables.extra, vec![format!("{}_users", TEST_DB)]);
        assert!(drift.tables.missing.is_empty());
        assert!(drift.tables.changed.is_empty());
        assert!(!drift.is_empty());
    }

    #[test]
    fn test_compute_drift_detects_missing_table_in_actual() {
        let events = make_test_table("events");
        let users = make_test_table("users");

        let mut expected = empty_infra_map();
        expected.tables.insert(events.id(TEST_DB), events.clone());
        expected.tables.insert(users.id(TEST_DB), users);

        let mut actual = empty_infra_map();
        actual.tables.insert(events.id(TEST_DB), events);

        let drift = compute_drift(&expected, &actual);

        assert!(drift.tables.extra.is_empty());
        assert_eq!(drift.tables.missing, vec![format!("{}_users", TEST_DB)]);
        assert!(drift.tables.changed.is_empty());
    }

    #[test]
    fn test_compute_drift_detects_changed_table() {
        let events = make_test_table("events");
        let mut events_modified = events.clone();
        events_modified.columns.push(Column {
            name: "new_col".to_string(),
            data_type: ColumnType::String,
            required: false,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
            alias: None,
        });

        let mut expected = empty_infra_map();
        expected.tables.insert(events.id(TEST_DB), events);

        let mut actual = empty_infra_map();
        actual
            .tables
            .insert(events_modified.id(TEST_DB), events_modified);

        let drift = compute_drift(&expected, &actual);

        assert!(drift.tables.extra.is_empty());
        assert!(drift.tables.missing.is_empty());
        assert_eq!(drift.tables.changed, vec![format!("{}_events", TEST_DB)]);
    }

    #[test]
    fn test_reconstruct_olap_map_for_applied_folds_only_listed_ids() {
        let events = make_test_table("events");
        let users = make_test_table("users");

        let m1 = MigrationFile {
            id: "20260406_100000_create_events".to_string(),
            description: "events".to_string(),
            parent_state_hash: "a".repeat(64),
            deltas: vec![InfraDelta::CreateTable {
                table: events.clone(),
            }],
            created_at: Utc::now(),
        };
        let m2 = MigrationFile {
            id: "20260407_100000_create_users".to_string(),
            description: "users".to_string(),
            parent_state_hash: "b".repeat(64),
            deltas: vec![InfraDelta::CreateTable {
                table: users.clone(),
            }],
            created_at: Utc::now(),
        };

        let history = MigrationHistory {
            files: vec![m1.clone(), m2],
        };

        // Only m1 is applied → resulting map should have events but NOT users
        let applied_ids = vec![m1.id.clone()];
        let map = history
            .reconstruct_olap_map_for_applied(TEST_DB, &applied_ids)
            .unwrap();

        assert!(map.tables.contains_key(&events.id(TEST_DB)));
        assert!(!map.tables.contains_key(&users.id(TEST_DB)));
    }

    fn empty_infra_map() -> InfrastructureMap {
        InfrastructureMap {
            default_database: TEST_DB.to_string(),
            topics: HashMap::new(),
            api_endpoints: HashMap::new(),
            tables: HashMap::new(),
            dmv1_views: HashMap::new(),
            topic_to_table_sync_processes: HashMap::new(),
            topic_to_topic_sync_processes: HashMap::new(),
            function_processes: HashMap::new(),
            consumption_api_web_server: ConsumptionApiWebServer {},
            orchestration_workers: HashMap::new(),
            sql_resources: HashMap::new(),
            workflows: HashMap::new(),
            web_apps: HashMap::new(),
            materialized_views: HashMap::new(),
            views: HashMap::new(),
            select_row_policies: HashMap::new(),
            olap_dictionaries: HashMap::new(),
            moose_version: None,
        }
    }

    #[test]
    fn test_validate_parent_hash_mismatch_returns_hash_mismatch_error() {
        let file = MigrationFile {
            id: "20260406_150000_test".to_string(),
            description: "test".to_string(),
            parent_state_hash: "expected_hash".to_string(),
            deltas: vec![],
            created_at: Utc::now(),
        };

        let result = file.validate_parent_hash("actual_different_hash");

        match result {
            Err(MigrationHistoryError::HashMismatch {
                migration_id,
                expected,
                actual,
            }) => {
                assert_eq!(migration_id, "20260406_150000_test");
                assert_eq!(expected, "expected_hash");
                assert_eq!(actual, "actual_different_hash");
            }
            other => panic!("expected HashMismatch error, got {:?}", other),
        }
    }
}
