//! Auto-generates a pending migration file during dev mode.
//!
//! After each dev mode change cycle, diffs the session baseline (captured at boot)
//! against the current target state and writes the result to `./migrations/pending.yaml`.
//! If the net diff is empty, the file is deleted.
//!
//! Version-bump changes are detected from the diff and ordered correctly
//! (create new → backfill → drop old) rather than being split into independent
//! drop/create deltas.

use crate::framework::core::infra_delta::olap_changes_to_deltas;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::framework::core::migration_file::MigrationFile;
use crate::framework::core::version_bump;
use crate::infrastructure::olap::clickhouse::diff_strategy::ClickHouseTableDiffStrategy;
use crate::project::Project;
use std::path::Path;

const PENDING_MIGRATION_PATH: &str = "./migrations/pending.yaml";

/// Error writing a pending migration file
#[derive(Debug, thiserror::Error)]
pub enum PendingMigrationError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("YAML serialization error: {0}")]
    Yaml(#[from] serde_yaml::Error),
}

/// Diff baseline vs target and write/delete `./migrations/pending.yaml`.
///
/// - If deltas are non-empty, writes them as a `MigrationFile`
/// - If deltas are empty, deletes `pending.yaml` if it exists
///
/// Both maps come from the same local ClickHouse instance during dev,
/// so SQL formatting is consistent and no normalization round-trip is needed.
///
/// Version bumps are detected from the diff and emitted with correct ordering.
/// Backfill is included when the schemas are compatible; old tables that are
/// absent from the target are assumed to have been dropped.
pub fn write_pending_migration(
    baseline: &InfrastructureMap,
    target: &InfrastructureMap,
    project: &Project,
) -> Result<(), PendingMigrationError> {
    let default_database = &project.clickhouse_config.db_name;

    let strategy = ClickHouseTableDiffStrategy;
    let changes = baseline.diff_with_table_strategy(
        target,
        &strategy,
        false, // don't respect lifecycle in dev
        false, // not production
        &[],   // no ignored operations
    );

    let (bumps, remaining_changes) = version_bump::extract_version_bumps(&changes.olap_changes);

    let mut deltas = olap_changes_to_deltas(&remaining_changes, default_database);

    // Infer decisions from what the diff tells us:
    // - backfill if schemas are compatible
    // - keep_old if the old table is still in the target state
    if !bumps.is_empty() {
        let decisions: Vec<version_bump::VersionBumpDecision> = bumps
            .into_iter()
            .map(|bump| {
                let backfill = matches!(
                    version_bump::check_backfill_eligibility(&bump, default_database),
                    version_bump::BackfillEligibility::Eligible { .. }
                );
                let keep_old = target
                    .tables
                    .contains_key(&bump.old_table.id(default_database));
                version_bump::VersionBumpDecision {
                    bump,
                    backfill,
                    keep_old,
                }
            })
            .collect();

        let bump_deltas =
            version_bump::version_bump_decisions_to_deltas(&decisions, default_database);
        if !bump_deltas.is_empty() {
            let mut combined = bump_deltas;
            combined.append(&mut deltas);
            deltas = combined;
        }
    }

    let pending_path = Path::new(PENDING_MIGRATION_PATH);

    if deltas.is_empty() {
        if pending_path.exists() {
            std::fs::remove_file(pending_path)?;
        }
        return Ok(());
    }

    if let Some(parent) = pending_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let parent_hash = baseline.olap_hash();
    let migration = MigrationFile {
        id: "pending".to_string(),
        description: "Auto-generated during dev mode".to_string(),
        parent_state_hash: parent_hash,
        deltas,
        created_at: chrono::Utc::now(),
    };

    let yaml = migration.to_yaml()?;
    std::fs::write(pending_path, yaml)?;

    Ok(())
}
