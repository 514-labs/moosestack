//! Timestamped plan file I/O for hybrid static+dynamic migrations.
//!
//! Provides functions to format, parse, discover, read, and write timestamped
//! migration plan files in the `migrations/` directory.

// These functions are not yet called from the main binary — they will be wired
// in by subsequent tasks (Tasks 4-7).  Allow dead code until then.
#![allow(dead_code)]

use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::framework::core::migration_plan::{MigrationPlan, MIGRATION_SCHEMA};
use crate::utilities::constants::CLI_PROJECT_INTERNAL_DIR;
use chrono::{DateTime, NaiveDateTime, Utc};
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use tempfile::TempDir;

    /// Helper: build a fixed timestamp for deterministic tests.
    fn test_timestamp() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 4, 6, 15, 30, 22).unwrap()
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
}
