//! Version-bump detection, prompting, and code generation.
//!
//! When a user changes the `version` field on an `OlapTable` (e.g. `"1.0"` → `"2.0"`),
//! the infrastructure diff sees the old versioned table as `Removed` and the new one as
//! `Added`. This module detects those pairs, asks the user whether to backfill data and
//! whether to keep the old table, and produces the correct operation/delta ordering:
//!
//! 1. Create new table
//! 2. Backfill from old → new (optional)
//! 3. Drop old table (optional — if kept, a file is generated marking it `EXTERNALLY_MANAGED`)

use std::collections::{HashMap, HashSet};
use std::io::{stdout, IsTerminal, Write};

use tracing::{debug, info};

use crate::cli::display::{self, Message, MessageType};
use crate::cli::prompt_user_async;
use crate::cli::routines::RoutineFailure;
use crate::framework::core::infrastructure::table::{Column, Table};
use crate::framework::core::infrastructure_map::{InfrastructureMap, OlapChange, TableChange};
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::framework::core::plan_risk::{DestructiveChange, PinnedSession, PlanRisk};
use crate::framework::core::prompt_bridge::{PendingPrompt, PromptBridge, PromptKind};
use crate::framework::languages::SupportedLanguages;

/// How the version bump was detected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VersionBumpKind {
    /// Old table removed + new table added in the same diff (in-place version change).
    InPlace,
    /// New versioned table added while an older version already exists in the
    /// current infrastructure. The old table is not part of the diff.
    NewAlongside,
}

/// A detected version bump: same logical primitive, old version removed, new version added.
#[derive(Debug, Clone)]
pub struct VersionBump {
    pub old_table: Table,
    pub new_table: Table,
    pub kind: VersionBumpKind,
}

/// What happens to the old table after migration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OldTableDisposition {
    /// Drop the old table after migration.
    Drop,
    /// Keep the old table and generate an `EXTERNALLY_MANAGED` definition file.
    Retain,
    /// Old table is not in the diff — leave it completely untouched.
    Untouched,
}

/// The user's decision for a single version bump.
#[derive(Debug, Clone)]
pub struct VersionBumpDecision {
    pub bump: VersionBump,
    /// If `Some`, INSERT…SELECT data from old table into new table.
    pub backfill_sql: Option<String>,
    /// What to do with the old table.
    pub old_table_disposition: OldTableDisposition,
}

/// Result of backfill eligibility check for a version bump.
#[derive(Debug)]
pub enum BackfillEligibility {
    /// Insertable columns are equivalent — backfill SQL is ready.
    Eligible { sql: String },
    /// Schemas differ — cannot auto-backfill.
    NotEligible { reason: String },
}

/// Scan `OlapChange`s for version bumps.
///
/// A version bump is a `Removed(old)` + `Added(new)` pair where both tables share
/// the same `source_primitive.name`, both have `version.is_some()`, and the new
/// version is strictly greater than the old version.
///
/// Returns `(version_bumps, remaining_changes)` — the remaining changes have the
/// version-bump entries stripped out so downstream processing doesn't see them as
/// independent drops/adds.
pub fn extract_version_bumps(changes: &[OlapChange]) -> (Vec<VersionBump>, Vec<OlapChange>) {
    /// Key that uniquely identifies a table across databases: `(database, name)`.
    fn table_key(t: &Table) -> (Option<String>, String) {
        (t.database.clone(), t.name.clone())
    }

    /// Composite key for grouping by primitive + database, so tables from
    /// different databases with the same primitive name are never paired.
    type GroupKey<'a> = (&'a str, Option<&'a str>);
    fn group_key(t: &Table) -> GroupKey<'_> {
        (&t.source_primitive.name, t.database.as_deref())
    }

    let mut removed_by_group: HashMap<GroupKey<'_>, Vec<&Table>> = HashMap::new();
    let mut added_by_group: HashMap<GroupKey<'_>, Vec<&Table>> = HashMap::new();

    for change in changes {
        match change {
            OlapChange::Table(TableChange::Removed(t)) => {
                removed_by_group.entry(group_key(t)).or_default().push(t);
            }
            OlapChange::Table(TableChange::Added(t)) if t.version.is_some() => {
                added_by_group.entry(group_key(t)).or_default().push(t);
            }
            _ => {}
        }
    }

    let mut bumps = Vec::new();
    let mut consumed_removed: HashSet<(Option<String>, String)> = HashSet::new();
    let mut consumed_added: HashSet<(Option<String>, String)> = HashSet::new();

    for (key, removed_tables) in &removed_by_group {
        if let Some(added_tables) = added_by_group.get(key) {
            // Sort removed tables by version descending so the highest old version
            // pairs with the new table first, backfilling the most recent data.
            let mut sorted_removed: Vec<&&Table> = removed_tables.iter().collect();
            sorted_removed.sort_by(|a, b| b.version.cmp(&a.version));

            for old in sorted_removed {
                let old_key = table_key(old);
                if consumed_removed.contains(&old_key) {
                    continue;
                }
                for new in added_tables {
                    let new_ver = new.version.as_ref().unwrap();
                    let new_key = table_key(new);
                    let is_bump = match old.version.as_ref() {
                        Some(old_ver) => new_ver > old_ver,
                        None => true,
                    };
                    if is_bump && !consumed_added.contains(&new_key) {
                        bumps.push(VersionBump {
                            old_table: (*old).clone(),
                            new_table: (*new).clone(),
                            kind: VersionBumpKind::InPlace,
                        });
                        consumed_removed.insert(old_key);
                        consumed_added.insert(new_key);
                        break;
                    }
                }
            }
        }
    }

    debug!(
        bumps = bumps.len(),
        remaining = changes.len() - bumps.len() * 2,
        "Extracted version bump pairs from OLAP changes"
    );
    for bump in &bumps {
        debug!(
            old = %bump.old_table.name,
            new = %bump.new_table.name,
            primitive = %bump.old_table.source_primitive.name,
            "Detected version bump pair"
        );
    }

    let remaining: Vec<OlapChange> = changes
        .iter()
        .filter(|c| match c {
            OlapChange::Table(TableChange::Removed(t)) => !consumed_removed.contains(&table_key(t)),
            OlapChange::Table(TableChange::Added(t)) => !consumed_added.contains(&table_key(t)),
            _ => true,
        })
        .cloned()
        .collect();

    (bumps, remaining)
}

/// Find versioned tables being added whose older version already exists
/// in the current infrastructure (not being removed). These are "backfill-only"
/// bumps — the old table stays, but we can offer to copy its data.
///
/// Returns additional `VersionBump`s that were NOT caught by `extract_version_bumps`
/// because the old table is not in the diff (it's not being removed).
pub fn find_backfill_only_bumps(
    remaining_changes: &[OlapChange],
    current_infra: &InfrastructureMap,
) -> Vec<VersionBump> {
    let mut bumps = Vec::new();

    for change in remaining_changes {
        let new_table = match change {
            OlapChange::Table(TableChange::Added(t)) if t.version.is_some() => t,
            _ => continue,
        };

        let new_ver = new_table.version.as_ref().unwrap();
        let primitive = &new_table.source_primitive.name;
        let new_db = new_table.database.as_deref();

        let best_old = current_infra
            .tables
            .values()
            .filter(|t| t.source_primitive.name == *primitive && t.database.as_deref() == new_db)
            .filter(|t| match &t.version {
                Some(v) => v < new_ver,
                None => true,
            })
            .max_by(|a, b| match (&a.version, &b.version) {
                (None, None) => std::cmp::Ordering::Equal,
                (None, Some(_)) => std::cmp::Ordering::Less,
                (Some(_), None) => std::cmp::Ordering::Greater,
                (Some(va), Some(vb)) => va.cmp(vb),
            });

        if let Some(old_table) = best_old {
            bumps.push(VersionBump {
                old_table: old_table.clone(),
                new_table: new_table.clone(),
                kind: VersionBumpKind::NewAlongside,
            });
        }
    }

    bumps
}

/// Check if backfill is possible between old and new tables.
pub fn check_backfill_eligibility(
    bump: &VersionBump,
    default_database: &str,
) -> BackfillEligibility {
    let old_insertable: Vec<&Column> = bump
        .old_table
        .columns
        .iter()
        .filter(|c| is_insertable(c))
        .collect();
    let new_insertable: Vec<&Column> = bump
        .new_table
        .columns
        .iter()
        .filter(|c| is_insertable(c))
        .collect();

    if !columns_equivalent(&old_insertable, &new_insertable) {
        let reason = schema_diff_reason(&old_insertable, &new_insertable);
        info!(
            old = %bump.old_table.name,
            new = %bump.new_table.name,
            reason = %reason,
            "Backfill not eligible: schema mismatch"
        );
        return BackfillEligibility::NotEligible { reason };
    }

    let src_db = bump
        .old_table
        .database
        .as_deref()
        .unwrap_or(default_database);
    let dst_db = bump
        .new_table
        .database
        .as_deref()
        .unwrap_or(default_database);

    let col_names: Vec<String> = old_insertable
        .iter()
        .map(|c| format!("`{}`", c.name))
        .collect();
    let cols_csv = col_names.join(", ");

    let sql = format!(
        "INSERT INTO `{dst_db}`.`{}` ({cols_csv}) SELECT {cols_csv} FROM `{src_db}`.`{}`",
        bump.new_table.name, bump.old_table.name
    );

    info!(
        old = %bump.old_table.name,
        new = %bump.new_table.name,
        "Backfill eligible: insertable columns match"
    );

    BackfillEligibility::Eligible { sql }
}

/// Obtain a single response from the user, racing stdin (with optional pinned
/// session) and the MCP prompt bridge when available.
async fn vb_get_response(
    is_interactive: bool,
    bridge: Option<&PromptBridge>,
    session: &mut Option<PinnedSession>,
    pinned_text: &str,
    plain_text: &str,
    prompt_info: PendingPrompt,
) -> Result<String, RoutineFailure> {
    let default_for_stdin = prompt_info.default_response.clone();
    let plain_default = default_for_stdin.as_deref();
    match (is_interactive, bridge) {
        (true, Some(bridge)) => {
            let stdin_fut = async {
                if let Some(ref mut s) = session {
                    Ok(s.prompt(pinned_text).await.unwrap_or_default())
                } else {
                    prompt_user_async(plain_text, plain_default, None).await
                }
            };
            let bridge_fut = bridge.prompt(prompt_info);
            tokio::select! {
                biased;
                line = stdin_fut => line,
                resp = bridge_fut => resp.ok_or_else(|| {
                    RoutineFailure::error(Message::new(
                        "Prompt".to_string(),
                        "Prompt bridge closed unexpectedly".to_string(),
                    ))
                }),
            }
        }
        (true, None) => {
            if let Some(ref mut s) = session {
                Ok(s.prompt(pinned_text).await.unwrap_or_default())
            } else {
                prompt_user_async(plain_text, plain_default, None).await
            }
        }
        (false, Some(bridge)) => {
            display::show_message_wrapper(
                MessageType::Info,
                Message::new(
                    "Waiting".to_string(),
                    format!(
                        "Use MCP tool `respond_to_prompt` at {} to accept or reject",
                        bridge.mcp_url(),
                    ),
                ),
            );
            bridge.prompt(prompt_info).await.ok_or_else(|| {
                RoutineFailure::error(Message::new(
                    "Prompt".to_string(),
                    "Prompt bridge closed unexpectedly".to_string(),
                ))
            })
        }
        (false, None) => Err(RoutineFailure::error(Message::new(
            "Version bump".to_string(),
            "No interactive stdin and no MCP prompt bridge available.\n\
             Re-run with --yes-all or set MOOSE_ACCEPT_ALL=1 to auto-accept."
                .to_string(),
        ))),
    }
}

/// Interactive prompt for version bump decisions.
///
/// For each detected version bump, asks whether to backfill and whether to
/// keep the old table. Returns `None` if the user cancels.
pub async fn version_bump_gate(
    bumps: Vec<VersionBump>,
    default_database: &str,
    auto_accept: bool,
    bridge: Option<&PromptBridge>,
) -> Result<Option<Vec<VersionBumpDecision>>, RoutineFailure> {
    if bumps.is_empty() {
        return Ok(Some(vec![]));
    }

    let is_interactive = std::io::stdin().is_terminal() && stdout().is_terminal();

    display::show_message_wrapper(
        MessageType::Info,
        Message::new(
            "Version bump".to_string(),
            format!(
                "Detected {} version bump(s). The old table(s) can be kept or dropped.",
                bumps.len()
            ),
        ),
    );

    let use_pinned = stdout().is_terminal();
    let mut session = if use_pinned && !auto_accept {
        PinnedSession::start().ok()
    } else {
        None
    };

    let mut decisions = Vec::with_capacity(bumps.len());
    let total = bumps.len();

    for (idx, bump) in bumps.into_iter().enumerate() {
        let prompt_idx = idx + 1;
        let eligibility = check_backfill_eligibility(&bump, default_database);
        let can_backfill = matches!(eligibility, BackfillEligibility::Eligible { .. });

        display::show_message_wrapper(
            MessageType::Highlight,
            Message::new(
                "Version bump".to_string(),
                format!(
                    "`{}` (v{}) → `{}` (v{})",
                    bump.old_table.name,
                    bump.old_table
                        .version
                        .as_ref()
                        .map(|v| v.to_string())
                        .unwrap_or_default(),
                    bump.new_table.name,
                    bump.new_table
                        .version
                        .as_ref()
                        .map(|v| v.to_string())
                        .unwrap_or_default(),
                ),
            ),
        );

        if !can_backfill {
            if let BackfillEligibility::NotEligible { ref reason } = eligibility {
                display::show_message_wrapper(
                    MessageType::Warning,
                    Message::new(
                        "Backfill".to_string(),
                        format!("Not eligible (schema mismatch): {reason}"),
                    ),
                );
            }
        }

        let (do_backfill, disposition) = if auto_accept {
            let disposition = match bump.kind {
                VersionBumpKind::NewAlongside => OldTableDisposition::Untouched,
                VersionBumpKind::InPlace => OldTableDisposition::Drop,
            };
            if can_backfill {
                display::show_message_wrapper(
                    MessageType::Info,
                    Message::new(
                        "Auto".to_string(),
                        format!("backfill=yes, old_table={disposition:?} (auto-accepted)"),
                    ),
                );
            }
            (can_backfill, disposition)
        } else {
            let bf = if can_backfill {
                let pinned_text = format!(
                    " Bump ({prompt_idx}/{total}): backfill `{}` → `{}`?  \x1b[1my\x1b[0m=yes  \x1b[1mn\x1b[0m=no",
                    bump.old_table.name, bump.new_table.name
                );
                let plain_text = format!(
                    "Backfill data from `{}` into `{}`? [Y/n]",
                    bump.old_table.name, bump.new_table.name
                );
                let info = PendingPrompt {
                    kind: PromptKind::VersionBump {
                        current: prompt_idx,
                        total,
                        description: format!(
                            "backfill `{}` → `{}`?",
                            bump.old_table.name, bump.new_table.name
                        ),
                    },
                    valid_responses: vec!["y".into(), "n".into()],
                    default_response: Some("y".into()),
                };
                let input = vb_get_response(
                    is_interactive,
                    bridge,
                    &mut session,
                    &pinned_text,
                    &plain_text,
                    info,
                )
                .await?;
                !matches!(input.trim().to_lowercase().as_str(), "n" | "no")
            } else {
                false
            };

            let disposition = match bump.kind {
                VersionBumpKind::NewAlongside => OldTableDisposition::Untouched,
                VersionBumpKind::InPlace => {
                    let pinned_text = format!(
                        " Bump ({prompt_idx}/{total}): keep old `{}`?  \x1b[1my\x1b[0m=keep (EXTERNALLY_MANAGED)  \x1b[1mn\x1b[0m=drop",
                        bump.old_table.name
                    );
                    let plain_text = format!(
                        "Keep old table `{}`? (will be marked EXTERNALLY_MANAGED) [y/N]",
                        bump.old_table.name
                    );
                    let info = PendingPrompt {
                        kind: PromptKind::VersionBump {
                            current: prompt_idx,
                            total,
                            description: format!(
                                "keep old `{}`? y=keep (EXTERNALLY_MANAGED) n=drop",
                                bump.old_table.name
                            ),
                        },
                        valid_responses: vec!["y".into(), "n".into()],
                        default_response: Some("n".into()),
                    };
                    let input = vb_get_response(
                        is_interactive,
                        bridge,
                        &mut session,
                        &pinned_text,
                        &plain_text,
                        info,
                    )
                    .await?;
                    if matches!(input.trim().to_lowercase().as_str(), "y" | "yes") {
                        OldTableDisposition::Retain
                    } else {
                        OldTableDisposition::Drop
                    }
                }
            };

            (bf, disposition)
        };

        let backfill_sql = if do_backfill {
            if let BackfillEligibility::Eligible { sql } = &eligibility {
                Some(sql.clone())
            } else {
                None
            }
        } else {
            None
        };

        if backfill_sql.is_some() {
            display::show_message_wrapper(
                MessageType::Success,
                Message::new(
                    "Backfill".to_string(),
                    format!("`{}` → `{}`", bump.old_table.name, bump.new_table.name),
                ),
            );
        }

        match &disposition {
            OldTableDisposition::Retain => {
                display::show_message_wrapper(
                    MessageType::Info,
                    Message::new(
                        "Retained".to_string(),
                        format!(
                            "`{}` will be kept as EXTERNALLY_MANAGED",
                            bump.old_table.name
                        ),
                    ),
                );
            }
            OldTableDisposition::Drop => {
                display::show_message_wrapper(
                    MessageType::Warning,
                    Message::new(
                        "Drop".to_string(),
                        format!("`{}` will be dropped after migration", bump.old_table.name),
                    ),
                );
            }
            OldTableDisposition::Untouched => {}
        }

        info!(
            old = %bump.old_table.name,
            new = %bump.new_table.name,
            backfill = backfill_sql.is_some(),
            disposition = ?disposition,
            "Version bump decision recorded"
        );

        decisions.push(VersionBumpDecision {
            bump,
            backfill_sql,
            old_table_disposition: disposition,
        });
    }

    // Session drops here, restoring scroll region.
    drop(session);

    Ok(Some(decisions))
}

use crate::framework::core::migration_plan::{
    columns_equivalent, is_insertable, schema_diff_reason,
};

// ── Code generation for retained (EXTERNALLY_MANAGED) tables ─────────

/// Generate a TypeScript file defining the retained table as EXTERNALLY_MANAGED.
pub fn generate_retained_typescript(table: &Table) -> String {
    crate::framework::typescript::generate::tables_to_typescript(
        std::slice::from_ref(table),
        Some(LifeCycle::ExternallyManaged),
    )
}

/// Generate a Python file defining the retained table as EXTERNALLY_MANAGED.
pub fn generate_retained_python(table: &Table) -> String {
    crate::framework::python::generate::tables_to_python(
        std::slice::from_ref(table),
        Some(LifeCycle::ExternallyManaged),
    )
}

/// Write one file per retained table and add imports to the root module.
///
/// For each `keep_old=true` decision, writes a dedicated file (e.g.
/// `retained_Events_1_0.ts`) containing the table definition with
/// `EXTERNALLY_MANAGED` lifecycle, then ensures the root module
/// (`index.ts` / `main.py`) imports it.
pub fn write_retained_table_files(
    decisions: &[VersionBumpDecision],
    source_dir: &std::path::Path,
    language: &SupportedLanguages,
) -> Result<(), std::io::Error> {
    let tables_to_retain: Vec<&Table> = decisions
        .iter()
        .filter(|d| d.old_table_disposition == OldTableDisposition::Retain)
        .map(|d| &d.bump.old_table)
        .collect();

    if tables_to_retain.is_empty() {
        return Ok(());
    }

    for table in &tables_to_retain {
        let db_prefix = table
            .database
            .as_ref()
            .map(|db| format!("{db}_"))
            .unwrap_or_default();
        let (file_name, root_name, content, import_line) = match language {
            SupportedLanguages::Typescript => {
                let name = format!("retained_{}{}.ts", db_prefix, table.name);
                let import = format!("import \"./{}\";", name.trim_end_matches(".ts"));
                (
                    name,
                    "index.ts",
                    generate_retained_typescript(table),
                    import,
                )
            }
            SupportedLanguages::Python => {
                let name = format!("retained_{}{}.py", db_prefix, table.name);
                let import = format!("from .{} import *", name.trim_end_matches(".py"));
                (name, "main.py", generate_retained_python(table), import)
            }
        };

        let file_path = source_dir.join(&file_name);
        if file_path.exists() {
            continue;
        }

        std::fs::write(&file_path, content)?;
        ensure_import(&source_dir.join(root_name), &import_line)?;
    }

    Ok(())
}

fn ensure_import(root_path: &std::path::Path, import_line: &str) -> Result<(), std::io::Error> {
    if !root_path.exists() {
        return Ok(());
    }

    let existing = std::fs::read_to_string(root_path)?;
    if existing.contains(import_line) {
        return Ok(());
    }

    let mut file = std::fs::OpenOptions::new().append(true).open(root_path)?;
    writeln!(file)?;
    writeln!(file, "{import_line}")?;
    Ok(())
}

// ── Convert version bump decisions to InfraDelta or SerializableOlapOperation ──

use crate::framework::core::infra_delta::{DestructivePolicy, InfraDelta};
use chrono::Utc;

/// Convert version bump decisions to correctly-phased `InfraDelta`s.
///
/// Phase order: all CreateTable → all BackfillTable → all DropTable.
/// This mirrors [`version_bump_decisions_to_phased_operations`] and avoids
/// interleaving drops before later backfills when multiple decisions exist.
///
/// CreateTable is emitted for all bump kinds (InPlace and NewAlongside) so that
/// the new table is guaranteed to exist before the backfill runs. Callers that
/// also generate deltas from the full diff should strip duplicate CreateTable
/// entries for NewAlongside tables using [`alongside_new_table_names`].
pub fn version_bump_decisions_to_deltas(decisions: &[VersionBumpDecision]) -> Vec<InfraDelta> {
    let mut creates = Vec::new();
    let mut backfills = Vec::new();
    let mut drops = Vec::new();

    for decision in decisions {
        creates.push(InfraDelta::CreateTable {
            table: decision.bump.new_table.clone(),
        });

        if let Some(sql) = &decision.backfill_sql {
            backfills.push(InfraDelta::BackfillTable {
                source_table: decision.bump.old_table.name.clone(),
                target_table: decision.bump.new_table.name.clone(),
                columns: vec![],
                sql: sql.clone(),
            });
        }

        if decision.old_table_disposition == OldTableDisposition::Drop {
            drops.push(InfraDelta::DropTable {
                table: decision.bump.old_table.clone(),
                policy: DestructivePolicy {
                    description: format!(
                        "User confirmed: drop old version `{}` after version bump to `{}`",
                        decision.bump.old_table.name, decision.bump.new_table.name
                    ),
                    approved_at: Utc::now(),
                },
            });
        }
    }

    creates.extend(backfills);
    creates.extend(drops);
    creates
}

/// Split version bump decisions into three ordered phases of `SerializableOlapOperation`s:
/// `(creates, backfills, drops)`.
///
/// Callers interleave these with normal teardown/setup ops to ensure correct ordering:
/// bump creates land before dependent setup ops, and bump drops land after backfills.
/// Returns (creates, backfills) operations for version bump decisions.
///
/// Creates are emitted for all bump kinds so the new table exists before backfill.
/// Callers that also derive operations from the full diff should strip duplicate
/// creates for NewAlongside tables using [`alongside_new_table_names`].
///
/// Bump drops are not returned here — callers should re-inject the old table's
/// `Removed` change into the regular change list so it participates in
/// dependency-ordered teardown alongside non-bump drops.
pub fn version_bump_decisions_to_phased_operations(
    decisions: &[VersionBumpDecision],
) -> (
    Vec<crate::infrastructure::olap::clickhouse::SerializableOlapOperation>,
    Vec<crate::infrastructure::olap::clickhouse::SerializableOlapOperation>,
) {
    use crate::infrastructure::olap::clickhouse::SerializableOlapOperation;

    let mut creates = Vec::new();
    let mut backfills = Vec::new();

    for decision in decisions {
        creates.push(SerializableOlapOperation::CreateTable {
            table: decision.bump.new_table.clone(),
        });

        if let Some(sql) = &decision.backfill_sql {
            backfills.push(SerializableOlapOperation::RawSql {
                sql: vec![sql.clone()],
                description: format!(
                    "Backfill `{}` from `{}`",
                    decision.bump.new_table.name, decision.bump.old_table.name
                ),
            });
        }
    }

    (creates, backfills)
}

/// Collect the `OlapChange::Removed` entries for bump decisions that chose `Drop`.
/// These should be appended to the regular change list so they participate in
/// dependency-ordered teardown.
pub fn bump_drop_changes(decisions: &[VersionBumpDecision]) -> Vec<OlapChange> {
    decisions
        .iter()
        .filter(|d| d.old_table_disposition == OldTableDisposition::Drop)
        .map(|d| OlapChange::Table(TableChange::Removed(d.bump.old_table.clone())))
        .collect()
}

/// Returns table names of NewAlongside bump decisions.
///
/// When bump functions emit CreateTable for all bump kinds, the NewAlongside
/// table's `Added` change (or `CreateTable` delta) is duplicated in the regular
/// change list. Callers use this set to strip the duplicate.
pub fn alongside_new_table_names(decisions: &[VersionBumpDecision]) -> HashSet<String> {
    decisions
        .iter()
        .filter(|d| d.bump.kind == VersionBumpKind::NewAlongside)
        .map(|d| d.bump.new_table.name.clone())
        .collect()
}

/// Shared helper: detect version bumps, prompt the user, and exclude confirmed
/// bump drops from `risk.destructive_changes` so they aren't double-prompted.
///
/// Returns the decisions (empty if no bumps detected). On user rejection returns
/// `Ok(None)` so the caller can abort.
pub async fn detect_prompt_and_exclude(
    olap_changes: &[OlapChange],
    current_infra: &InfrastructureMap,
    default_database: &str,
    accept_all: bool,
    risk: &mut PlanRisk,
    bridge: Option<&PromptBridge>,
) -> Result<Option<Vec<VersionBumpDecision>>, RoutineFailure> {
    let (mut version_bumps, remaining) = extract_version_bumps(olap_changes);
    let backfill_only = find_backfill_only_bumps(&remaining, current_infra);
    version_bumps.extend(backfill_only);

    let decisions = if !version_bumps.is_empty() {
        match version_bump_gate(version_bumps, default_database, accept_all, bridge).await? {
            Some(d) => d,
            None => return Ok(None),
        }
    } else {
        vec![]
    };

    exclude_bump_drops_from_risk(&decisions, risk);
    Ok(Some(decisions))
}

/// Remove `TableDrop` and `TableRecreate` entries from `risk.destructive_changes`
/// for old tables whose drop was already confirmed via the version-bump gate.
pub fn exclude_bump_drops_from_risk(decisions: &[VersionBumpDecision], risk: &mut PlanRisk) {
    if decisions.is_empty() {
        return;
    }
    let vb_drop_names: HashSet<String> = decisions
        .iter()
        .filter(|d| d.old_table_disposition == OldTableDisposition::Drop)
        .map(|d| d.bump.old_table.name.clone())
        .collect();
    if vb_drop_names.is_empty() {
        return;
    }
    risk.destructive_changes.retain(|dc| match dc {
        DestructiveChange::TableDrop {
            table_name_with_suffix,
            ..
        }
        | DestructiveChange::TableRecreate {
            table_name_with_suffix,
            ..
        } => !vb_drop_names.contains(table_name_with_suffix),
        _ => true,
    });
    debug!(
        excluded_tables = ?vb_drop_names,
        "Excluded version-bump drops from destructive risk assessment"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, OrderBy, SeedFilter};
    use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
    use crate::framework::versions::Version;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

    fn make_table(name: &str, version: &str, primitive: &str) -> Table {
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
            version: Some(Version::from_string(version.to_string())),
            database: None,
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
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
                name: primitive.to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            constraints: vec![],
        }
    }

    #[test]
    fn detect_simple_version_bump() {
        let old = make_table("Events_1_0", "1.0", "Events");
        let new = make_table("Events_2_0", "2.0", "Events");

        let changes = vec![
            OlapChange::Table(TableChange::Removed(old.clone())),
            OlapChange::Table(TableChange::Added(new.clone())),
        ];

        let (bumps, remaining) = extract_version_bumps(&changes);
        assert_eq!(bumps.len(), 1);
        assert_eq!(bumps[0].old_table.name, "Events_1_0");
        assert_eq!(bumps[0].new_table.name, "Events_2_0");
        assert!(remaining.is_empty());
    }

    #[test]
    fn no_bump_when_both_unversioned() {
        let old = Table {
            version: None,
            ..make_table("Events", "1.0", "Events")
        };
        let new = Table {
            version: None,
            ..make_table("EventsNew", "1.0", "Events")
        };

        let changes = vec![
            OlapChange::Table(TableChange::Removed(old)),
            OlapChange::Table(TableChange::Added(new)),
        ];

        let (bumps, remaining) = extract_version_bumps(&changes);
        assert!(bumps.is_empty());
        assert_eq!(remaining.len(), 2);
    }

    #[test]
    fn no_bump_when_different_primitives() {
        let old = make_table("Events_1_0", "1.0", "Events");
        let new = make_table("Users_2_0", "2.0", "Users");

        let changes = vec![
            OlapChange::Table(TableChange::Removed(old)),
            OlapChange::Table(TableChange::Added(new)),
        ];

        let (bumps, remaining) = extract_version_bumps(&changes);
        assert!(bumps.is_empty());
        assert_eq!(remaining.len(), 2);
    }

    #[test]
    fn non_bump_changes_preserved() {
        let old = make_table("Events_1_0", "1.0", "Events");
        let new = make_table("Events_2_0", "2.0", "Events");
        let unrelated = make_table("Users_1_0", "1.0", "Users");

        let changes = vec![
            OlapChange::Table(TableChange::Removed(old)),
            OlapChange::Table(TableChange::Added(new)),
            OlapChange::Table(TableChange::Added(unrelated)),
        ];

        let (bumps, remaining) = extract_version_bumps(&changes);
        assert_eq!(bumps.len(), 1);
        assert_eq!(remaining.len(), 1);
    }

    fn in_place(old: Table, new: Table) -> VersionBump {
        VersionBump {
            old_table: old,
            new_table: new,
            kind: VersionBumpKind::InPlace,
        }
    }

    #[test]
    fn backfill_eligible_when_same_columns() {
        let bump = in_place(
            make_table("Events_1_0", "1.0", "Events"),
            make_table("Events_2_0", "2.0", "Events"),
        );
        let result = check_backfill_eligibility(&bump, "default");
        assert!(matches!(result, BackfillEligibility::Eligible { .. }));
    }

    #[test]
    fn backfill_not_eligible_when_columns_differ() {
        let mut new = make_table("Events_2_0", "2.0", "Events");
        new.columns.push(Column {
            name: "extra".to_string(),
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
        });
        let bump = in_place(make_table("Events_1_0", "1.0", "Events"), new);
        let result = check_backfill_eligibility(&bump, "default");
        assert!(matches!(result, BackfillEligibility::NotEligible { .. }));
    }

    #[test]
    fn decisions_to_deltas_with_backfill_and_drop() {
        let decisions = vec![VersionBumpDecision {
            bump: in_place(
                make_table("Events_1_0", "1.0", "Events"),
                make_table("Events_2_0", "2.0", "Events"),
            ),
            backfill_sql: Some("INSERT INTO ...".to_string()),
            old_table_disposition: OldTableDisposition::Drop,
        }];

        let deltas = version_bump_decisions_to_deltas(&decisions);
        assert_eq!(deltas.len(), 3);
        assert!(matches!(&deltas[0], InfraDelta::CreateTable { .. }));
        assert!(matches!(&deltas[1], InfraDelta::BackfillTable { .. }));
        assert!(matches!(&deltas[2], InfraDelta::DropTable { .. }));
    }

    #[test]
    fn decisions_to_deltas_with_retain() {
        let decisions = vec![VersionBumpDecision {
            bump: in_place(
                make_table("Events_1_0", "1.0", "Events"),
                make_table("Events_2_0", "2.0", "Events"),
            ),
            backfill_sql: Some("INSERT INTO ...".to_string()),
            old_table_disposition: OldTableDisposition::Retain,
        }];

        let deltas = version_bump_decisions_to_deltas(&decisions);
        assert_eq!(deltas.len(), 2);
        assert!(matches!(&deltas[0], InfraDelta::CreateTable { .. }));
        assert!(matches!(&deltas[1], InfraDelta::BackfillTable { .. }));
    }

    #[test]
    fn decisions_to_deltas_no_backfill_drop() {
        let decisions = vec![VersionBumpDecision {
            bump: in_place(
                make_table("Events_1_0", "1.0", "Events"),
                make_table("Events_2_0", "2.0", "Events"),
            ),
            backfill_sql: None,
            old_table_disposition: OldTableDisposition::Drop,
        }];

        let deltas = version_bump_decisions_to_deltas(&decisions);
        assert_eq!(deltas.len(), 2);
        assert!(matches!(&deltas[0], InfraDelta::CreateTable { .. }));
        assert!(matches!(&deltas[1], InfraDelta::DropTable { .. }));
    }

    #[test]
    fn decisions_to_deltas_phases_creates_before_backfills_before_drops() {
        let decisions = vec![
            VersionBumpDecision {
                bump: in_place(
                    make_table("A_1_0", "1.0", "A"),
                    make_table("A_2_0", "2.0", "A"),
                ),
                backfill_sql: Some("INSERT A".to_string()),
                old_table_disposition: OldTableDisposition::Drop,
            },
            VersionBumpDecision {
                bump: in_place(
                    make_table("B_1_0", "1.0", "B"),
                    make_table("B_2_0", "2.0", "B"),
                ),
                backfill_sql: Some("INSERT B".to_string()),
                old_table_disposition: OldTableDisposition::Drop,
            },
        ];

        let deltas = version_bump_decisions_to_deltas(&decisions);
        assert_eq!(deltas.len(), 6);
        // Phase 1: all creates
        assert!(matches!(&deltas[0], InfraDelta::CreateTable { table } if table.name == "A_2_0"));
        assert!(matches!(&deltas[1], InfraDelta::CreateTable { table } if table.name == "B_2_0"));
        // Phase 2: all backfills
        assert!(
            matches!(&deltas[2], InfraDelta::BackfillTable { target_table, .. } if target_table == "A_2_0")
        );
        assert!(
            matches!(&deltas[3], InfraDelta::BackfillTable { target_table, .. } if target_table == "B_2_0")
        );
        // Phase 3: all drops
        assert!(matches!(&deltas[4], InfraDelta::DropTable { table, .. } if table.name == "A_1_0"));
        assert!(matches!(&deltas[5], InfraDelta::DropTable { table, .. } if table.name == "B_1_0"));
    }

    #[test]
    fn multi_version_pairing_picks_highest_added() {
        let old_v1 = make_table("Events_1_0", "1.0", "Events");
        let old_v2 = make_table("Events_2_0", "2.0", "Events");
        let new_v3 = make_table("Events_3_0", "3.0", "Events");

        let changes = vec![
            OlapChange::Table(TableChange::Removed(old_v1.clone())),
            OlapChange::Table(TableChange::Removed(old_v2.clone())),
            OlapChange::Table(TableChange::Added(new_v3.clone())),
        ];

        let (bumps, remaining) = extract_version_bumps(&changes);
        // Only one bump possible: new_v3 can only be consumed once.
        assert_eq!(bumps.len(), 1);
        // Highest removed version (v2) pairs with the new version (v3),
        // ensuring backfill copies the most recent data.
        assert_eq!(bumps[0].old_table.name, "Events_2_0");
        assert_eq!(bumps[0].new_table.name, "Events_3_0");
        // v1 removal is left as a remaining change (orphaned drop).
        assert_eq!(remaining.len(), 1);
        assert!(
            matches!(&remaining[0], OlapChange::Table(TableChange::Removed(t)) if t.name == "Events_1_0")
        );
    }

    #[test]
    fn unversioned_to_versioned_is_bump() {
        let mut old = make_table("Events", "1.0", "Events");
        old.version = None;
        let new = make_table("Events_0_0", "0.0", "Events");

        let changes = vec![
            OlapChange::Table(TableChange::Removed(old)),
            OlapChange::Table(TableChange::Added(new)),
        ];

        let (bumps, remaining) = extract_version_bumps(&changes);
        assert_eq!(bumps.len(), 1);
        assert_eq!(bumps[0].old_table.name, "Events");
        assert_eq!(bumps[0].new_table.name, "Events_0_0");
        assert!(remaining.is_empty());
    }

    #[test]
    fn cross_database_tables_not_paired() {
        let mut old = make_table("Events_1_0", "1.0", "Events");
        old.database = Some("db_a".to_string());
        let mut new = make_table("Events_2_0", "2.0", "Events");
        new.database = Some("db_b".to_string());

        let changes = vec![
            OlapChange::Table(TableChange::Removed(old)),
            OlapChange::Table(TableChange::Added(new)),
        ];

        let (bumps, remaining) = extract_version_bumps(&changes);
        assert!(
            bumps.is_empty(),
            "tables from different databases should not pair"
        );
        assert_eq!(remaining.len(), 2);
    }

    #[test]
    fn phased_operations_backfill_and_drop() {
        let decisions = vec![VersionBumpDecision {
            bump: in_place(
                make_table("Events_1_0", "1.0", "Events"),
                make_table("Events_2_0", "2.0", "Events"),
            ),
            backfill_sql: Some(
                "INSERT INTO `default`.`Events_2_0` (`id`) SELECT `id` FROM `default`.`Events_1_0`"
                    .to_string(),
            ),
            old_table_disposition: OldTableDisposition::Drop,
        }];

        let (creates, backfills) = version_bump_decisions_to_phased_operations(&decisions);
        assert_eq!(creates.len(), 1);
        assert!(
            matches!(&creates[0], crate::infrastructure::olap::clickhouse::SerializableOlapOperation::CreateTable { table } if table.name == "Events_2_0")
        );
        assert_eq!(backfills.len(), 1);
        assert!(matches!(
            &backfills[0],
            crate::infrastructure::olap::clickhouse::SerializableOlapOperation::RawSql { .. }
        ));

        // bump_drop_changes should produce the Removed change for dependency-ordered teardown
        let drops = bump_drop_changes(&decisions);
        assert_eq!(drops.len(), 1);
        assert!(
            matches!(&drops[0], OlapChange::Table(TableChange::Removed(t)) if t.name == "Events_1_0")
        );
    }

    #[test]
    fn phased_operations_retain_keeps_old() {
        let decisions = vec![VersionBumpDecision {
            bump: in_place(
                make_table("Events_1_0", "1.0", "Events"),
                make_table("Events_2_0", "2.0", "Events"),
            ),
            backfill_sql: Some("INSERT INTO ...".to_string()),
            old_table_disposition: OldTableDisposition::Retain,
        }];

        let (creates, backfills) = version_bump_decisions_to_phased_operations(&decisions);
        assert_eq!(creates.len(), 1);
        assert_eq!(backfills.len(), 1);

        // No drop changes when retaining
        let drops = bump_drop_changes(&decisions);
        assert!(drops.is_empty());
    }

    #[test]
    fn phased_operations_no_backfill_drop() {
        let decisions = vec![VersionBumpDecision {
            bump: in_place(
                make_table("Events_1_0", "1.0", "Events"),
                make_table("Events_2_0", "2.0", "Events"),
            ),
            backfill_sql: None,
            old_table_disposition: OldTableDisposition::Drop,
        }];

        let (creates, backfills) = version_bump_decisions_to_phased_operations(&decisions);
        assert_eq!(creates.len(), 1);
        assert!(backfills.is_empty());

        let drops = bump_drop_changes(&decisions);
        assert_eq!(drops.len(), 1);
    }

    #[test]
    fn exclude_bump_drops_from_risk_filters_confirmed_drops() {
        use crate::framework::core::plan_risk::{DestructiveChange, PlanRisk};

        let decisions = vec![VersionBumpDecision {
            bump: in_place(
                make_table("Events_1_0", "1.0", "Events"),
                make_table("Events_2_0", "2.0", "Events"),
            ),
            backfill_sql: Some("INSERT INTO ...".to_string()),
            old_table_disposition: OldTableDisposition::Drop,
        }];

        let mut risk = PlanRisk {
            destructive_changes: vec![
                DestructiveChange::TableDrop {
                    database: None,
                    table_name_with_suffix: "Events_1_0".to_string(),
                    version: Some(Version::from_string("1.0".to_string())),
                },
                DestructiveChange::TableDrop {
                    database: None,
                    table_name_with_suffix: "Users_1_0".to_string(),
                    version: Some(Version::from_string("1.0".to_string())),
                },
            ],
            operational_risks: vec![],
        };

        exclude_bump_drops_from_risk(&decisions, &mut risk);

        // Events_1_0 drop was confirmed via version bump — should be excluded
        assert_eq!(risk.destructive_changes.len(), 1);
        assert!(matches!(
            &risk.destructive_changes[0],
            DestructiveChange::TableDrop { table_name_with_suffix, .. } if table_name_with_suffix == "Users_1_0"
        ));
    }

    #[test]
    fn exclude_bump_drops_also_filters_recreates() {
        use crate::framework::core::plan_risk::{DestructiveChange, PlanRisk};

        let decisions = vec![VersionBumpDecision {
            bump: in_place(
                make_table("Events_1_0", "1.0", "Events"),
                make_table("Events_2_0", "2.0", "Events"),
            ),
            backfill_sql: None,
            old_table_disposition: OldTableDisposition::Drop,
        }];

        let mut risk = PlanRisk {
            destructive_changes: vec![DestructiveChange::TableRecreate {
                database: None,
                table_name_with_suffix: "Events_1_0".to_string(),
                reason: "schema change".to_string(),
                version: Some(Version::from_string("1.0".to_string())),
            }],
            operational_risks: vec![],
        };

        exclude_bump_drops_from_risk(&decisions, &mut risk);
        assert!(risk.destructive_changes.is_empty());
    }
}
