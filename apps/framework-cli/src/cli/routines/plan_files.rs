//! Timestamped plan file I/O for hybrid static+dynamic migrations.
//!
//! Provides functions to format, parse, discover, read, and write timestamped
//! migration plan files in the `migrations/` directory.

// These functions are not yet called from the main binary — they will be wired
// in by subsequent tasks (Tasks 4-7).  Allow dead code until then.
#![allow(dead_code)]

use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::framework::core::migration_plan::{MigrationPlan, MIGRATION_SCHEMA};
use crate::infrastructure::olap::clickhouse::SerializableOlapOperation;
use crate::utilities::constants::CLI_PROJECT_INTERNAL_DIR;
use chrono::{DateTime, NaiveDateTime, Utc};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tracing::debug;

/// Timestamp format used in plan file names: `YYYYMMDDTHHMMSSz`
const TIMESTAMP_FORMAT: &str = "%Y%m%dT%H%M%SZ";

/// Formats a UTC datetime as a compact ISO-8601-ish timestamp string.
///
/// Example: `2026-04-06T15:30:22Z` becomes `"20260406T153022Z"`
pub fn format_plan_timestamp(ts: &DateTime<Utc>) -> String {
    ts.format(TIMESTAMP_FORMAT).to_string()
}

/// Returns the plan YAML filename for the given timestamp.
///
/// Example: `"20260406T153022Z.yaml"`
pub fn plan_filename(ts: &DateTime<Utc>) -> String {
    format!("{}.yaml", format_plan_timestamp(ts))
}

/// Returns the state JSON filename for the given timestamp.
///
/// Example: `"20260406T153022Z_state.json"`
pub fn state_filename(ts: &DateTime<Utc>) -> String {
    format!("{}_state.json", format_plan_timestamp(ts))
}

/// Parses a plan timestamp string back into a `DateTime<Utc>`.
///
/// Accepts the compact format produced by [`format_plan_timestamp`],
/// e.g. `"20260406T153022Z"`.
///
/// Returns `None` if the string does not match the expected format.
pub fn parse_plan_timestamp(s: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(s, TIMESTAMP_FORMAT)
        .ok()
        .map(|naive| naive.and_utc())
}

/// Discovers all `.yaml` plan files in the given directory, sorted
/// chronologically (oldest first) by the timestamp encoded in the filename.
///
/// Non-YAML files and files whose stems cannot be parsed as timestamps are
/// silently ignored.
pub fn discover_plan_files(dir: &Path) -> Vec<PathBuf> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            debug!("Could not read plan directory {}: {}", dir.display(), e);
            return Vec::new();
        }
    };

    let mut plan_files: Vec<(DateTime<Utc>, PathBuf)> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
                return None;
            }
            let stem = path.file_stem()?.to_str()?;
            let ts = parse_plan_timestamp(stem)?;
            Some((ts, path))
        })
        .collect();

    plan_files.sort_by_key(|(ts, _)| *ts);
    plan_files.into_iter().map(|(_, path)| path).collect()
}

/// Loads a [`MigrationPlan`] from a YAML file.
///
/// Strips the optional `# yaml-language-server` header comment before parsing.
pub fn load_plan(path: &Path) -> anyhow::Result<MigrationPlan> {
    let content = std::fs::read_to_string(path)?;
    let content = strip_yaml_language_server_header(&content);
    // Parse YAML to JSON Value first (same pattern as migrate.rs)
    let yaml_value: serde_json::Value = serde_yaml::from_str(&content)?;
    let plan: MigrationPlan = serde_json::from_value(yaml_value)?;
    Ok(plan)
}

/// Loads an [`InfrastructureMap`] from a JSON state file.
pub fn load_state(path: &Path) -> anyhow::Result<InfrastructureMap> {
    let content = std::fs::read_to_string(path)?;
    let state: InfrastructureMap = serde_json::from_str(&content)?;
    Ok(state)
}

/// Writes plan YAML and state JSON files into the migrations directory.
///
/// The plan YAML is written with a `# yaml-language-server` schema header,
/// and the JSON migration schema is written to `<internal_dir>/migration_schema.json`.
///
/// Returns the paths of the plan and state files.
pub fn write_plan_files(
    migrations_dir: &Path,
    plan: &MigrationPlan,
    remote_state: &InfrastructureMap,
    internal_dir: &Path,
) -> anyhow::Result<(PathBuf, PathBuf)> {
    // Ensure directories exist
    std::fs::create_dir_all(migrations_dir)?;
    std::fs::create_dir_all(internal_dir)?;

    let ts = &plan.created_at;
    let plan_path = migrations_dir.join(plan_filename(ts));
    let state_path = migrations_dir.join(state_filename(ts));

    // Write plan YAML with schema header
    let plan_yaml = plan.to_yaml()?;
    let schema_relative = format!("../{}/migration_schema.json", CLI_PROJECT_INTERNAL_DIR);
    let plan_yaml_with_header =
        format!("# yaml-language-server: $schema={schema_relative}\n\n{plan_yaml}");
    std::fs::write(&plan_path, plan_yaml_with_header)?;

    // Write state JSON
    let state_json = serde_json::to_string_pretty(remote_state)?;
    std::fs::write(&state_path, state_json)?;

    // Write JSON schema for IDE support
    let schema_path = internal_dir.join("migration_schema.json");
    std::fs::write(&schema_path, MIGRATION_SCHEMA)?;

    debug!(
        "Wrote plan files: plan={}, state={}",
        plan_path.display(),
        state_path.display()
    );

    Ok((plan_path, state_path))
}

/// Strips lines starting with `# yaml-language-server` from the beginning
/// of a YAML string, so that the YAML parser does not choke on them.
fn strip_yaml_language_server_header(content: &str) -> String {
    content
        .lines()
        .filter(|line| !line.starts_with("# yaml-language-server"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Result of comparing the current database state against a plan's expected
/// state, scoped to only the objects referenced by the plan's operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScopedDriftStatus {
    /// The referenced objects match the expected state; the plan can be applied.
    Applicable,
    /// The referenced objects are already gone from current state (e.g. a
    /// `DropTable` plan where the table no longer exists). Safe to skip.
    AlreadyApplied,
    /// Some referenced objects differ between current and expected state.
    /// The plan should be blocked until the drift is resolved.
    Drifted { changed_tables: Vec<String> },
}

/// Extracts the set of table/view names referenced by a slice of operations.
///
/// For most variants the name is in the `table` or `name` field. `RawSql` is
/// skipped because we cannot reliably extract object names from arbitrary SQL.
/// `CreateRowPolicy`/`DropRowPolicy` contribute every table in the policy's
/// `tables` list.
///
/// Names are qualified as `database.name` when the operation specifies a
/// database, otherwise `default_database.name`.
pub fn referenced_tables(
    ops: &[SerializableOlapOperation],
    default_database: &str,
) -> HashSet<String> {
    let mut names = HashSet::new();

    let qualify = |name: &str, db: &Option<String>| -> String {
        let db = db.as_deref().unwrap_or(default_database);
        format!("{}.{}", db, name)
    };

    for op in ops {
        match op {
            SerializableOlapOperation::CreateTable { table } => {
                names.insert(qualify(&table.name, &table.database));
            }
            SerializableOlapOperation::DropTable {
                table, database, ..
            } => {
                names.insert(qualify(table, database));
            }
            SerializableOlapOperation::AddTableColumn {
                table, database, ..
            }
            | SerializableOlapOperation::DropTableColumn {
                table, database, ..
            }
            | SerializableOlapOperation::ModifyTableColumn {
                table, database, ..
            }
            | SerializableOlapOperation::RenameTableColumn {
                table, database, ..
            }
            | SerializableOlapOperation::ModifyTableSettings {
                table, database, ..
            }
            | SerializableOlapOperation::ModifyTableTtl {
                table, database, ..
            }
            | SerializableOlapOperation::AddTableIndex {
                table, database, ..
            }
            | SerializableOlapOperation::DropTableIndex {
                table, database, ..
            }
            | SerializableOlapOperation::AddTableProjection {
                table, database, ..
            }
            | SerializableOlapOperation::DropTableProjection {
                table, database, ..
            }
            | SerializableOlapOperation::ModifySampleBy {
                table, database, ..
            }
            | SerializableOlapOperation::RemoveSampleBy {
                table, database, ..
            } => {
                names.insert(qualify(table, database));
            }
            SerializableOlapOperation::CreateMaterializedView { name, database, .. }
            | SerializableOlapOperation::DropMaterializedView { name, database } => {
                names.insert(qualify(name, database));
            }
            SerializableOlapOperation::CreateView { name, database, .. }
            | SerializableOlapOperation::DropView { name, database } => {
                names.insert(qualify(name, database));
            }
            SerializableOlapOperation::RawSql { .. } => {
                // Cannot extract table names from arbitrary SQL — skip.
            }
            SerializableOlapOperation::CreateRowPolicy { policy }
            | SerializableOlapOperation::DropRowPolicy { policy } => {
                for table_ref in &policy.tables {
                    names.insert(qualify(&table_ref.name, &table_ref.database));
                }
            }
        }
    }

    names
}

/// Compares the current database state against the expected state from a
/// plan's `_state.json`, scoped only to the objects referenced by the plan's
/// operations.
///
/// # Arguments
///
/// * `current` — tables currently in the live database, keyed by
///   `database.table_name`.
/// * `expected` — tables captured in the plan's state snapshot, keyed the same
///   way.
/// * `ops` — the operations from the plan file.
/// * `default_database` — the project's default ClickHouse database name.
///
/// # Returns
///
/// * [`ScopedDriftStatus::Applicable`] — all referenced objects match; safe to
///   apply the plan.
/// * [`ScopedDriftStatus::AlreadyApplied`] — all referenced objects that
///   existed in the expected state are now absent from the current state,
///   indicating the plan was already executed.
/// * [`ScopedDriftStatus::Drifted`] — at least one referenced object differs
///   between current and expected state.
pub fn detect_scoped_drift(
    current: &HashMap<String, Table>,
    expected: &HashMap<String, Table>,
    ops: &[SerializableOlapOperation],
    default_database: &str,
) -> ScopedDriftStatus {
    let refs = referenced_tables(ops, default_database);

    if refs.is_empty() {
        return ScopedDriftStatus::Applicable;
    }

    let mut changed = Vec::new();
    let mut all_gone = true; // track whether every expected-present ref is gone

    for name in &refs {
        let in_expected = expected.get(name);
        let in_current = current.get(name);

        match (in_expected, in_current) {
            // Expected and current both have it — compare.
            (Some(exp), Some(cur)) => {
                all_gone = false;
                if exp != cur {
                    changed.push(name.clone());
                }
            }
            // Expected had it, current does not — possibly already applied.
            (Some(_), None) => {
                // remains all_gone = true for this ref
            }
            // Expected didn't have it, current does — new object appeared,
            // but since expected didn't track it, it's not drift for this plan.
            (None, Some(_)) => {
                all_gone = false;
            }
            // Neither has it — no drift for this ref.
            (None, None) => {
                // Not in expected, not in current — doesn't affect drift.
            }
        }
    }

    if !changed.is_empty() {
        changed.sort();
        return ScopedDriftStatus::Drifted {
            changed_tables: changed,
        };
    }

    // If every referenced object that was in expected is now gone from current,
    // and there were no mismatches, it's already applied.
    // Edge case: if no ref was in expected at all (e.g. all CreateTable ops for
    // new tables that weren't in the snapshot), `all_gone` is still true but the
    // plan hasn't been "applied" — it's applicable. We distinguish by checking
    // whether any ref was actually present in expected.
    let any_was_expected = refs.iter().any(|name| expected.contains_key(name));

    if any_was_expected && all_gone {
        ScopedDriftStatus::AlreadyApplied
    } else {
        ScopedDriftStatus::Applicable
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, OrderBy};
    use crate::framework::core::infrastructure_map::PrimitiveSignature;
    use crate::framework::core::infrastructure_map::PrimitiveTypes;
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::framework::versions::Version;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
    use chrono::TimeZone;
    use tempfile::TempDir;

    /// Helper: build a fixed timestamp for deterministic tests.
    fn test_timestamp() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 4, 6, 15, 30, 22).unwrap()
    }

    /// Helper: build a minimal Table for drift detection tests.
    fn test_table(name: &str) -> Table {
        Table {
            name: name.to_string(),
            engine: ClickhouseEngine::MergeTree,
            columns: vec![],
            order_by: OrderBy::Fields(vec![]),
            partition_by: None,
            sample_by: None,
            version: Some(Version::from_string("1.0".to_string())),
            source_primitive: PrimitiveSignature {
                name: "test".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings_hash: None,
            table_settings: None,
            indexes: vec![],
            projections: vec![],
            database: None,
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
            seed_filter: Default::default(),
        }
    }

    /// Helper: build a minimal Column for drift detection tests.
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

    #[test]
    fn timestamp_format_is_correct() {
        let ts = test_timestamp();
        assert_eq!(format_plan_timestamp(&ts), "20260406T153022Z");
    }

    #[test]
    fn plan_filename_roundtrips() {
        let ts = test_timestamp();
        let filename = plan_filename(&ts);
        assert_eq!(filename, "20260406T153022Z.yaml");

        // Strip extension to get stem, then parse back
        let stem = filename.strip_suffix(".yaml").unwrap();
        let parsed = parse_plan_timestamp(stem).expect("should parse back");
        assert_eq!(parsed, ts);
    }

    #[test]
    fn state_filename_matches_plan() {
        let ts = test_timestamp();
        let p = plan_filename(&ts);
        let s = state_filename(&ts);

        // The plan stem should be the prefix of the state stem
        let plan_stem = p.strip_suffix(".yaml").unwrap();
        let state_stem = s.strip_suffix("_state.json").unwrap();
        assert_eq!(plan_stem, state_stem);
    }

    #[test]
    fn discover_finds_yaml_files_sorted_chronologically() {
        let dir = TempDir::new().unwrap();
        let dir_path = dir.path();

        // Write files out of chronological order
        let ts_late = Utc.with_ymd_and_hms(2026, 6, 1, 0, 0, 0).unwrap();
        let ts_early = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let ts_mid = Utc.with_ymd_and_hms(2026, 3, 15, 12, 0, 0).unwrap();

        // Write in reverse order to ensure sorting by timestamp, not FS order
        std::fs::write(dir_path.join(plan_filename(&ts_late)), "late").unwrap();
        std::fs::write(dir_path.join(plan_filename(&ts_early)), "early").unwrap();
        std::fs::write(dir_path.join(plan_filename(&ts_mid)), "mid").unwrap();

        let files = discover_plan_files(dir_path);
        assert_eq!(files.len(), 3);

        // Should be sorted oldest-first
        let stems: Vec<String> = files
            .iter()
            .map(|p| p.file_stem().unwrap().to_str().unwrap().to_string())
            .collect();
        assert_eq!(
            stems,
            vec![
                format_plan_timestamp(&ts_early),
                format_plan_timestamp(&ts_mid),
                format_plan_timestamp(&ts_late),
            ]
        );
    }

    #[test]
    fn discover_ignores_non_yaml_files() {
        let dir = TempDir::new().unwrap();
        let dir_path = dir.path();

        let ts = test_timestamp();

        // Write a valid plan file
        std::fs::write(dir_path.join(plan_filename(&ts)), "plan content").unwrap();

        // Write non-YAML files that should be ignored
        std::fs::write(dir_path.join(state_filename(&ts)), "state json").unwrap();
        std::fs::write(dir_path.join("README.md"), "# readme").unwrap();
        std::fs::write(dir_path.join("notes.txt"), "some notes").unwrap();

        let files = discover_plan_files(dir_path);
        assert_eq!(files.len(), 1);
        assert_eq!(
            files[0].file_name().unwrap().to_str().unwrap(),
            plan_filename(&ts)
        );
    }

    // -----------------------------------------------------------------------
    // referenced_tables tests
    // -----------------------------------------------------------------------

    #[test]
    fn referenced_tables_extracts_drop_table_name() {
        let ops = vec![SerializableOlapOperation::DropTable {
            table: "events".to_string(),
            database: None,
            cluster_name: None,
        }];
        let refs = referenced_tables(&ops, "mydb");
        assert_eq!(refs, HashSet::from(["mydb.events".to_string()]));
    }

    #[test]
    fn referenced_tables_uses_explicit_database() {
        let ops = vec![SerializableOlapOperation::DropTable {
            table: "events".to_string(),
            database: Some("other_db".to_string()),
            cluster_name: None,
        }];
        let refs = referenced_tables(&ops, "mydb");
        assert_eq!(refs, HashSet::from(["other_db.events".to_string()]));
    }

    #[test]
    fn referenced_tables_skips_raw_sql() {
        let ops = vec![SerializableOlapOperation::RawSql {
            sql: vec!["DROP TABLE foo".to_string()],
            description: "manual".to_string(),
        }];
        let refs = referenced_tables(&ops, "mydb");
        assert!(refs.is_empty());
    }

    #[test]
    fn referenced_tables_extracts_create_table_name() {
        let mut table = test_table("users");
        table.database = Some("custom".to_string());
        let ops = vec![SerializableOlapOperation::CreateTable { table }];
        let refs = referenced_tables(&ops, "mydb");
        assert_eq!(refs, HashSet::from(["custom.users".to_string()]));
    }

    #[test]
    fn referenced_tables_extracts_view_names() {
        let ops = vec![
            SerializableOlapOperation::CreateView {
                name: "v1".to_string(),
                database: None,
                select_sql: "SELECT 1".to_string(),
            },
            SerializableOlapOperation::DropMaterializedView {
                name: "mv1".to_string(),
                database: Some("analytics".to_string()),
            },
        ];
        let refs = referenced_tables(&ops, "mydb");
        assert!(refs.contains("mydb.v1"));
        assert!(refs.contains("analytics.mv1"));
        assert_eq!(refs.len(), 2);
    }

    #[test]
    fn referenced_tables_empty_ops() {
        let refs = referenced_tables(&[], "mydb");
        assert!(refs.is_empty());
    }

    // -----------------------------------------------------------------------
    // detect_scoped_drift tests
    // -----------------------------------------------------------------------

    #[test]
    fn no_drift_when_referenced_tables_match() {
        let table_a = test_table("events");
        let unrelated = test_table("users");

        // expected and current both have "events" identically
        let expected: HashMap<String, Table> = [
            ("mydb.events".to_string(), table_a.clone()),
            ("mydb.users".to_string(), unrelated.clone()),
        ]
        .into_iter()
        .collect();

        // current has "events" identical, "users" changed (extra column)
        let mut changed_users = unrelated;
        changed_users.columns.push(test_column("extra"));

        let current: HashMap<String, Table> = [
            ("mydb.events".to_string(), table_a),
            ("mydb.users".to_string(), changed_users),
        ]
        .into_iter()
        .collect();

        // Plan only touches "events", so "users" drift should be ignored
        let ops = vec![SerializableOlapOperation::AddTableColumn {
            table: "events".to_string(),
            column: test_column("new_col"),
            after_column: None,
            database: None,
            cluster_name: None,
        }];

        let status = detect_scoped_drift(&current, &expected, &ops, "mydb");
        assert_eq!(status, ScopedDriftStatus::Applicable);
    }

    #[test]
    fn drift_when_referenced_table_changed() {
        let table_a = test_table("events");

        let expected: HashMap<String, Table> = [("mydb.events".to_string(), table_a.clone())]
            .into_iter()
            .collect();

        // current has "events" with an extra column — drift!
        let mut changed_events = table_a;
        changed_events.columns.push(test_column("surprise_col"));

        let current: HashMap<String, Table> = [("mydb.events".to_string(), changed_events)]
            .into_iter()
            .collect();

        let ops = vec![SerializableOlapOperation::DropTableColumn {
            table: "events".to_string(),
            column_name: "old_col".to_string(),
            database: None,
            cluster_name: None,
        }];

        let status = detect_scoped_drift(&current, &expected, &ops, "mydb");
        assert_eq!(
            status,
            ScopedDriftStatus::Drifted {
                changed_tables: vec!["mydb.events".to_string()],
            }
        );
    }

    #[test]
    fn already_applied_when_referenced_table_gone() {
        let table_a = test_table("events");

        // expected has "events"
        let expected: HashMap<String, Table> =
            [("mydb.events".to_string(), table_a)].into_iter().collect();

        // current does NOT have "events" — the drop already happened
        let current: HashMap<String, Table> = HashMap::new();

        let ops = vec![SerializableOlapOperation::DropTable {
            table: "events".to_string(),
            database: None,
            cluster_name: None,
        }];

        let status = detect_scoped_drift(&current, &expected, &ops, "mydb");
        assert_eq!(status, ScopedDriftStatus::AlreadyApplied);
    }

    #[test]
    fn applicable_when_empty_ops() {
        let current: HashMap<String, Table> = HashMap::new();
        let expected: HashMap<String, Table> = HashMap::new();

        let status = detect_scoped_drift(&current, &expected, &[], "mydb");
        assert_eq!(status, ScopedDriftStatus::Applicable);
    }

    #[test]
    fn applicable_when_create_table_not_in_expected() {
        // A CreateTable op referencing a table that didn't exist in expected
        // state (because it's being created). Current also doesn't have it.
        let current: HashMap<String, Table> = HashMap::new();
        let expected: HashMap<String, Table> = HashMap::new();

        let ops = vec![SerializableOlapOperation::CreateTable {
            table: test_table("new_table"),
        }];

        let status = detect_scoped_drift(&current, &expected, &ops, "mydb");
        assert_eq!(status, ScopedDriftStatus::Applicable);
    }

    #[test]
    fn already_applied_mixed_gone_and_absent() {
        // Two ops: one for a table that was in expected and is now gone,
        // another for a table that was never in expected (e.g. CreateTable).
        let table_a = test_table("old_table");

        let expected: HashMap<String, Table> = [("mydb.old_table".to_string(), table_a)]
            .into_iter()
            .collect();

        let current: HashMap<String, Table> = HashMap::new();

        let ops = vec![
            SerializableOlapOperation::DropTable {
                table: "old_table".to_string(),
                database: None,
                cluster_name: None,
            },
            SerializableOlapOperation::CreateTable {
                table: test_table("new_table"),
            },
        ];

        let status = detect_scoped_drift(&current, &expected, &ops, "mydb");
        // old_table was expected and is gone → already applied signal
        // new_table was not in expected and not in current → neutral
        // Result: AlreadyApplied because the expected-present ref is gone
        assert_eq!(status, ScopedDriftStatus::AlreadyApplied);
    }
}
