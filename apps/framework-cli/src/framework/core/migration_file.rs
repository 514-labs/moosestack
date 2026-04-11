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
        let slug = description
            .to_lowercase()
            .split_whitespace()
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
}
