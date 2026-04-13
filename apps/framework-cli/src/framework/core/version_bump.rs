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
use std::io::{stdout, IsTerminal};

use crate::cli::display::{self, Message, MessageType};
use crate::cli::prompt_user_async;
use crate::cli::routines::RoutineFailure;
use crate::framework::core::infrastructure::table::{Column, ColumnType, Table};
use crate::framework::core::infrastructure_map::{OlapChange, TableChange};
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::framework::languages::SupportedLanguages;

/// A detected version bump: same logical primitive, old version removed, new version added.
#[derive(Debug, Clone)]
pub struct VersionBump {
    pub old_table: Table,
    pub new_table: Table,
}

/// The user's decision for a single version bump.
#[derive(Debug, Clone)]
pub struct VersionBumpDecision {
    pub bump: VersionBump,
    /// Whether to INSERT…SELECT data from old table into new table.
    pub backfill: bool,
    /// Whether to keep the old table (as EXTERNALLY_MANAGED). If false, the old table is dropped.
    pub keep_old: bool,
    /// Cached backfill SQL (set when `backfill=true` and schemas are compatible).
    pub backfill_sql: Option<String>,
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
            OlapChange::Table(TableChange::Removed(t)) if t.version.is_some() => {
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
            for old in removed_tables {
                let old_ver = old.version.as_ref().unwrap();
                let old_key = table_key(old);
                if consumed_removed.contains(&old_key) {
                    continue;
                }
                for new in added_tables {
                    let new_ver = new.version.as_ref().unwrap();
                    let new_key = table_key(new);
                    if new_ver > old_ver && !consumed_added.contains(&new_key) {
                        bumps.push(VersionBump {
                            old_table: (*old).clone(),
                            new_table: (*new).clone(),
                        });
                        consumed_removed.insert(old_key);
                        consumed_added.insert(new_key);
                        break;
                    }
                }
            }
        }
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
        return BackfillEligibility::NotEligible {
            reason: schema_diff_reason(&old_insertable, &new_insertable),
        };
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

    BackfillEligibility::Eligible { sql }
}

/// Interactive prompt for version bump decisions.
///
/// For each detected version bump, asks whether to backfill and whether to
/// keep the old table. Returns `None` if the user cancels.
pub async fn version_bump_gate(
    bumps: Vec<VersionBump>,
    default_database: &str,
    auto_accept: bool,
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

    let mut decisions = Vec::with_capacity(bumps.len());

    for bump in bumps {
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

        let (backfill, keep_old) = if auto_accept {
            let bf = can_backfill;
            if bf {
                display::show_message_wrapper(
                    MessageType::Info,
                    Message::new(
                        "Auto".to_string(),
                        "backfill=yes, keep_old=no (auto-accepted)".to_string(),
                    ),
                );
            }
            (bf, false)
        } else if !is_interactive {
            return Err(RoutineFailure::error(Message::new(
                "Version bump".to_string(),
                format!(
                    "Version bump detected for `{}` but running non-interactively.\n\
                     Re-run with --yes-all or set MOOSE_ACCEPT_ALL=1 to auto-accept.",
                    bump.old_table.name
                ),
            )));
        } else {
            let bf = if can_backfill {
                let answer = prompt_user_async(
                    &format!(
                        "Backfill data from `{}` into `{}`? [Y/n]",
                        bump.old_table.name, bump.new_table.name
                    ),
                    Some("Y"),
                    None,
                )
                .await?;
                !matches!(answer.trim().to_lowercase().as_str(), "n" | "no")
            } else {
                false
            };

            let keep = {
                let answer = prompt_user_async(
                    &format!(
                        "Keep old table `{}`? (will be marked EXTERNALLY_MANAGED) [y/N]",
                        bump.old_table.name
                    ),
                    Some("N"),
                    None,
                )
                .await?;
                matches!(answer.trim().to_lowercase().as_str(), "y" | "yes")
            };

            (bf, keep)
        };

        let backfill_sql = if backfill {
            if let BackfillEligibility::Eligible { sql } = &eligibility {
                Some(sql.clone())
            } else {
                None
            }
        } else {
            None
        };

        if backfill && backfill_sql.is_some() {
            display::show_message_wrapper(
                MessageType::Success,
                Message::new(
                    "Backfill".to_string(),
                    format!("`{}` → `{}`", bump.old_table.name, bump.new_table.name),
                ),
            );
        }

        if keep_old {
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
        } else {
            display::show_message_wrapper(
                MessageType::Warning,
                Message::new(
                    "Drop".to_string(),
                    format!("`{}` will be dropped after migration", bump.old_table.name),
                ),
            );
        }

        decisions.push(VersionBumpDecision {
            bump,
            backfill,
            keep_old,
            backfill_sql,
        });
    }

    Ok(Some(decisions))
}

// ── Backfill column helpers (reused from migration_plan.rs) ──────────

fn is_insertable(col: &Column) -> bool {
    col.materialized.is_none() && col.alias.is_none()
}

fn columns_equivalent(a: &[&Column], b: &[&Column]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    type ColKey<'c> = (&'c str, &'c ColumnType, bool);
    let set_a: HashSet<ColKey> = a
        .iter()
        .map(|c| (c.name.as_str(), &c.data_type, c.required))
        .collect();
    let set_b: HashSet<ColKey> = b
        .iter()
        .map(|c| (c.name.as_str(), &c.data_type, c.required))
        .collect();
    set_a == set_b
}

fn schema_diff_reason(source: &[&Column], target: &[&Column]) -> String {
    let src_names: HashSet<&str> = source.iter().map(|c| c.name.as_str()).collect();
    let tgt_names: HashSet<&str> = target.iter().map(|c| c.name.as_str()).collect();

    let extra_in_target: Vec<&&str> = tgt_names.difference(&src_names).collect();
    let extra_in_source: Vec<&&str> = src_names.difference(&tgt_names).collect();

    let mut parts = Vec::new();
    if !extra_in_target.is_empty() {
        parts.push(format!(
            "new table has columns not present in old: {}",
            extra_in_target
                .iter()
                .map(|s| format!("`{s}`"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if !extra_in_source.is_empty() {
        parts.push(format!(
            "old table has columns not present in new: {}",
            extra_in_source
                .iter()
                .map(|s| format!("`{s}`"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if parts.is_empty() {
        parts.push("column type or nullability mismatch".to_string());
    }
    parts.join("; ")
}

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
        .filter(|d| d.keep_old)
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

    use std::io::Write;
    let mut file = std::fs::OpenOptions::new().append(true).open(root_path)?;
    writeln!(file)?;
    writeln!(file, "{import_line}")?;
    Ok(())
}

// ── Convert version bump decisions to InfraDelta or SerializableOlapOperation ──

use crate::framework::core::infra_delta::{DestructivePolicy, InfraDelta};
use chrono::Utc;

/// Convert version bump decisions to correctly-ordered `InfraDelta`s.
///
/// Order: CreateTable(new) → BackfillTable(old→new) → DropTable(old)
pub fn version_bump_decisions_to_deltas(decisions: &[VersionBumpDecision]) -> Vec<InfraDelta> {
    let mut deltas = Vec::new();

    for decision in decisions {
        deltas.push(InfraDelta::CreateTable {
            table: decision.bump.new_table.clone(),
        });

        if decision.backfill {
            if let Some(sql) = &decision.backfill_sql {
                deltas.push(InfraDelta::BackfillTable {
                    source_table: decision.bump.old_table.name.clone(),
                    target_table: decision.bump.new_table.name.clone(),
                    columns: vec![],
                    sql: sql.clone(),
                });
            }
        }

        if !decision.keep_old {
            deltas.push(InfraDelta::DropTable {
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

    deltas
}

/// Split version bump decisions into three ordered phases of `SerializableOlapOperation`s:
/// `(creates, backfills, drops)`.
///
/// Callers interleave these with normal teardown/setup ops to ensure correct ordering:
/// bump creates land before dependent setup ops, and bump drops land after backfills.
pub fn version_bump_decisions_to_phased_operations(
    decisions: &[VersionBumpDecision],
) -> (
    Vec<crate::infrastructure::olap::clickhouse::SerializableOlapOperation>,
    Vec<crate::infrastructure::olap::clickhouse::SerializableOlapOperation>,
    Vec<crate::infrastructure::olap::clickhouse::SerializableOlapOperation>,
) {
    use crate::infrastructure::olap::clickhouse::SerializableOlapOperation;

    let mut creates = Vec::new();
    let mut backfills = Vec::new();
    let mut drops = Vec::new();

    for decision in decisions {
        creates.push(SerializableOlapOperation::CreateTable {
            table: decision.bump.new_table.clone(),
        });

        if decision.backfill {
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

        if !decision.keep_old {
            drops.push(SerializableOlapOperation::DropTable {
                table: decision.bump.old_table.name.clone(),
                database: decision.bump.old_table.database.clone(),
                cluster_name: decision.bump.old_table.cluster_name.clone(),
            });
        }
    }

    (creates, backfills, drops)
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
    fn no_bump_when_unversioned() {
        let old = Table {
            version: None,
            ..make_table("Events", "1.0", "Events")
        };
        let new = make_table("Events_2_0", "2.0", "Events");

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

    #[test]
    fn backfill_eligible_when_same_columns() {
        let old = make_table("Events_1_0", "1.0", "Events");
        let new = make_table("Events_2_0", "2.0", "Events");
        let bump = VersionBump {
            old_table: old,
            new_table: new,
        };
        let result = check_backfill_eligibility(&bump, "default");
        assert!(matches!(result, BackfillEligibility::Eligible { .. }));
    }

    #[test]
    fn backfill_not_eligible_when_columns_differ() {
        let old = make_table("Events_1_0", "1.0", "Events");
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
        let bump = VersionBump {
            old_table: old,
            new_table: new,
        };
        let result = check_backfill_eligibility(&bump, "default");
        assert!(matches!(result, BackfillEligibility::NotEligible { .. }));
    }

    #[test]
    fn decisions_to_deltas_with_backfill_and_drop() {
        let old = make_table("Events_1_0", "1.0", "Events");
        let new = make_table("Events_2_0", "2.0", "Events");

        let decisions = vec![VersionBumpDecision {
            bump: VersionBump {
                old_table: old,
                new_table: new,
            },
            backfill: true,
            keep_old: false,
            backfill_sql: Some("INSERT INTO ...".to_string()),
        }];

        let deltas = version_bump_decisions_to_deltas(&decisions);
        assert_eq!(deltas.len(), 3);
        assert!(matches!(&deltas[0], InfraDelta::CreateTable { .. }));
        assert!(matches!(&deltas[1], InfraDelta::BackfillTable { .. }));
        assert!(matches!(&deltas[2], InfraDelta::DropTable { .. }));
    }

    #[test]
    fn decisions_to_deltas_with_keep_old() {
        let old = make_table("Events_1_0", "1.0", "Events");
        let new = make_table("Events_2_0", "2.0", "Events");

        let decisions = vec![VersionBumpDecision {
            bump: VersionBump {
                old_table: old,
                new_table: new,
            },
            backfill: true,
            keep_old: true,
            backfill_sql: Some("INSERT INTO ...".to_string()),
        }];

        let deltas = version_bump_decisions_to_deltas(&decisions);
        assert_eq!(deltas.len(), 2);
        assert!(matches!(&deltas[0], InfraDelta::CreateTable { .. }));
        assert!(matches!(&deltas[1], InfraDelta::BackfillTable { .. }));
    }

    #[test]
    fn decisions_to_deltas_no_backfill_no_keep() {
        let old = make_table("Events_1_0", "1.0", "Events");
        let new = make_table("Events_2_0", "2.0", "Events");

        let decisions = vec![VersionBumpDecision {
            bump: VersionBump {
                old_table: old,
                new_table: new,
            },
            backfill: false,
            keep_old: false,
            backfill_sql: None,
        }];

        let deltas = version_bump_decisions_to_deltas(&decisions);
        assert_eq!(deltas.len(), 2);
        assert!(matches!(&deltas[0], InfraDelta::CreateTable { .. }));
        assert!(matches!(&deltas[1], InfraDelta::DropTable { .. }));
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
        // The first old version (v1) pairs with the only new version (v3).
        assert_eq!(bumps[0].old_table.name, "Events_1_0");
        assert_eq!(bumps[0].new_table.name, "Events_3_0");
        // v2 removal is left as a remaining change.
        assert_eq!(remaining.len(), 1);
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
}
