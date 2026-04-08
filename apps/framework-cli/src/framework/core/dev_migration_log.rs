//! Dev migration log — records deltas during dev mode.
//!
//! During `moose dev`, every OLAP change is recorded as a sequence of
//! `InfraDelta` entries in `.moose/dev_migrations/`. Destructive deltas
//! preserve their `DestructivePolicy` from the dev session, which is
//! shown as context when generating production migrations.
//! This log is used by `moose generate migration` to compact the dev
//! history into a minimal production migration.

use crate::framework::core::infra_delta::InfraDelta;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// A single entry in the dev migration log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevLogEntry {
    /// When this change was applied
    pub timestamp: DateTime<Utc>,
    /// The deltas applied in this change, including any `DestructivePolicy` decisions
    pub deltas: Vec<InfraDelta>,
}

/// The full dev migration log for a session.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DevMigrationLog {
    pub entries: Vec<DevLogEntry>,
}

impl DevMigrationLog {
    /// Path to the dev migration log file.
    pub fn log_path(project_internal_dir: &Path) -> PathBuf {
        project_internal_dir.join("dev_migrations").join("log.yaml")
    }

    /// Load an existing log from disk, or return an empty one.
    pub fn load(project_internal_dir: &Path) -> Self {
        let path = Self::log_path(project_internal_dir);
        if !path.exists() {
            return Self::default();
        }
        match std::fs::read_to_string(&path) {
            Ok(content) => serde_yaml::from_str(&content).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    /// Append deltas to the log and persist to disk.
    pub fn append_and_save(
        &mut self,
        deltas: &[InfraDelta],
        project_internal_dir: &Path,
    ) -> Result<(), std::io::Error> {
        if deltas.is_empty() {
            return Ok(());
        }

        self.entries.push(DevLogEntry {
            timestamp: Utc::now(),
            deltas: deltas.to_vec(),
        });

        let path = Self::log_path(project_internal_dir);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let yaml = serde_yaml::to_string(self)
            .map_err(|e| std::io::Error::other(format!("YAML error: {}", e)))?;
        std::fs::write(&path, yaml)
    }

    /// Clear the log (after a production migration is generated).
    pub fn clear(project_internal_dir: &Path) -> Result<(), std::io::Error> {
        let path = Self::log_path(project_internal_dir);
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        Ok(())
    }

    /// Flatten all entries into a single ordered sequence of deltas.
    pub fn all_deltas(&self) -> Vec<InfraDelta> {
        self.entries.iter().flat_map(|e| e.deltas.clone()).collect()
    }

    /// Returns true if the log has no entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// Compact a dev migration log into minimal deltas against a remote state.
///
/// The approach:
/// 1. Replay the dev log's deltas against the remote map to build the final state
/// 2. Diff the remote state against the final state using the standard diff pipeline
/// 3. Convert the diff to InfraDeltas
///
/// This automatically cancels out inverse operations (create+drop, add+remove column)
/// because the diff only sees the net difference. Destructive deltas in the result
/// have placeholder policies from `olap_changes_to_deltas` — the caller should
/// re-prompt the user for production confirmation, using the dev log's original
/// policies as context ("you confirmed this in dev at <time>").
pub fn compact_dev_log(
    log: &DevMigrationLog,
    remote_map: &crate::framework::core::infrastructure_map::InfrastructureMap,
    default_database: &str,
) -> Vec<InfraDelta> {
    use crate::framework::core::infra_delta::olap_changes_to_deltas;
    use crate::infrastructure::olap::clickhouse::diff_strategy::ClickHouseTableDiffStrategy;

    if log.is_empty() {
        return vec![];
    }

    // Replay dev deltas against the remote map to get the final dev state
    let mut final_map = remote_map.clone();
    for delta in log.all_deltas() {
        if let Err(e) = delta.apply(&mut final_map, default_database) {
            tracing::warn!("Skipping delta during compaction fold: {}", e);
        }
    }

    // Diff remote → final to get the minimal change set
    let strategy = ClickHouseTableDiffStrategy;
    let changes = remote_map.diff_with_table_strategy(
        &final_map,
        &strategy,
        false, // don't respect lifecycle during compaction
        false, // not production
        &[],   // no ignored operations
    );

    // Convert to deltas
    olap_changes_to_deltas(&changes.olap_changes, default_database)
}

/// Extract dev policy context for destructive operations from the log.
///
/// Returns a map of table name → policy description from the most recent
/// destructive operation on that table in the dev log. Used to provide
/// context when re-prompting for production confirmation.
pub fn extract_dev_policy_context(
    log: &DevMigrationLog,
) -> std::collections::HashMap<String, String> {
    let mut context = std::collections::HashMap::new();

    for entry in &log.entries {
        for delta in &entry.deltas {
            match delta {
                InfraDelta::RecreateTable { before, policy, .. } => {
                    context.insert(
                        before.name.clone(),
                        format!(
                            "Confirmed in dev at {}: {}",
                            entry.timestamp.format("%Y-%m-%d %H:%M"),
                            policy.description
                        ),
                    );
                }
                InfraDelta::DropTable { table, policy } => {
                    context.insert(
                        table.name.clone(),
                        format!(
                            "Confirmed in dev at {}: {}",
                            entry.timestamp.format("%Y-%m-%d %H:%M"),
                            policy.description
                        ),
                    );
                }
                _ => {}
            }
        }
    }

    context
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
        }
    }

    #[test]
    fn test_append_and_load() {
        let dir = tempfile::tempdir().unwrap();
        let mut log = DevMigrationLog::default();

        let deltas = vec![
            InfraDelta::CreateTable {
                table: make_test_table("events"),
            },
            InfraDelta::AddTableColumn {
                table_id: "test_events".to_string(),
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
            },
        ];

        log.append_and_save(&deltas, dir.path()).unwrap();
        assert_eq!(log.entries.len(), 1);
        assert_eq!(log.all_deltas().len(), 2);

        // Load from disk
        let loaded = DevMigrationLog::load(dir.path());
        assert_eq!(loaded.entries.len(), 1);
        assert_eq!(loaded.all_deltas().len(), 2);
    }

    #[test]
    fn test_clear() {
        let dir = tempfile::tempdir().unwrap();
        let mut log = DevMigrationLog::default();

        log.append_and_save(
            &[InfraDelta::CreateTable {
                table: make_test_table("events"),
            }],
            dir.path(),
        )
        .unwrap();

        assert!(DevMigrationLog::log_path(dir.path()).exists());
        DevMigrationLog::clear(dir.path()).unwrap();
        assert!(!DevMigrationLog::log_path(dir.path()).exists());

        let loaded = DevMigrationLog::load(dir.path());
        assert!(loaded.is_empty());
    }

    #[test]
    fn test_compaction_cancels_create_then_drop() {
        use crate::framework::core::infra_delta::DestructivePolicy;

        let mut log = DevMigrationLog::default();
        // Create a table then drop it — should compact to nothing
        log.entries.push(DevLogEntry {
            timestamp: Utc::now(),
            deltas: vec![InfraDelta::CreateTable {
                table: make_test_table("temp_table"),
            }],
        });
        log.entries.push(DevLogEntry {
            timestamp: Utc::now(),
            deltas: vec![InfraDelta::DropTable {
                table: make_test_table("temp_table"),
                policy: DestructivePolicy {
                    description: "dev mode".to_string(),
                    approved_at: Utc::now(),
                },
            }],
        });

        let remote = crate::framework::core::infrastructure_map::InfrastructureMap::default();
        let compacted = super::compact_dev_log(&log, &remote, "local");
        // Net effect: nothing changed relative to remote (which also has no tables)
        assert!(
            compacted.is_empty(),
            "Expected empty, got {:?}",
            compacted.iter().map(|d| d.summary()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn test_compaction_collapses_create_plus_mutations() {
        let mut log = DevMigrationLog::default();
        let table = make_test_table("events");
        let table_id = table.id("local");

        // Create table, then add a column
        log.entries.push(DevLogEntry {
            timestamp: Utc::now(),
            deltas: vec![InfraDelta::CreateTable {
                table: table.clone(),
            }],
        });
        log.entries.push(DevLogEntry {
            timestamp: Utc::now(),
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
        });

        let remote = crate::framework::core::infrastructure_map::InfrastructureMap::default();
        let compacted = super::compact_dev_log(&log, &remote, "local");

        // Should be a single CreateTable with both columns (id + email)
        assert_eq!(
            compacted.len(),
            1,
            "Expected 1 delta, got {}: {:?}",
            compacted.len(),
            compacted.iter().map(|d| d.summary()).collect::<Vec<_>>()
        );
        match &compacted[0] {
            InfraDelta::CreateTable { table } => {
                assert_eq!(table.columns.len(), 2);
                assert_eq!(table.columns[0].name, "id");
                assert_eq!(table.columns[1].name, "email");
            }
            other => panic!("Expected CreateTable, got: {}", other.summary()),
        }
    }
}
