//! Destructive-change detection and confirmation gate for migration plans.
//!
//! Before executing a migration, [`classify_plan_risk`] scans OLAP changes for
//! operations that may cause data loss (table/column drops, recreates, view
//! removals). [`destructive_confirmation_gate`] then enforces user confirmation
//! via an interactive prompt (with a pinned terminal region in TTY mode) or via
//! the `--yes-destructive` / `MOOSE_ACCEPT_DESTRUCTIVE` overrides.

use std::fmt;
use std::io::{stdout, IsTerminal, Write};
use std::time::Duration;

use crossterm::cursor::MoveTo;
use crossterm::execute;
use crossterm::style::Print;
use crossterm::terminal::{self, Clear, ClearType};
use tokio::io::AsyncBufReadExt;

use crate::cli::display::{terminal_lock, Message, MessageType};
use crate::cli::prompt_user_async;
use crate::cli::routines::RoutineFailure;

use crate::infrastructure::olap::clickhouse::SerializableOlapOperation;

use super::infrastructure_map::{Change, ColumnChange, InfraChanges, OlapChange, TableChange};

/// A single destructive operation identified in a migration plan.
#[derive(Debug, Clone)]
pub enum DestructiveChange {
    TableDrop {
        database: Option<String>,
        table_name: String,
    },
    ColumnDrop {
        database: Option<String>,
        table_name: String,
        column_name: String,
    },
    /// A table that must be dropped and recreated (ORDER BY, PARTITION BY, engine, etc.)
    TableRecreate {
        database: Option<String>,
        table_name: String,
        reason: String,
    },
    ViewDrop {
        database: Option<String>,
        view_name: String,
    },
    MaterializedViewDrop {
        database: Option<String>,
        view_name: String,
    },
}

fn fmt_qualified(f: &mut fmt::Formatter<'_>, db: &Option<String>, name: &str) -> fmt::Result {
    match db {
        Some(db) => write!(f, "`{db}`.`{name}`"),
        None => write!(f, "`{name}`"),
    }
}

impl fmt::Display for DestructiveChange {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DestructiveChange::TableDrop {
                database,
                table_name,
            } => {
                write!(f, "DROP TABLE ")?;
                fmt_qualified(f, database, table_name)
            }
            DestructiveChange::ColumnDrop {
                database,
                table_name,
                column_name,
            } => {
                write!(f, "DROP COLUMN `{column_name}` FROM ")?;
                fmt_qualified(f, database, table_name)
            }
            DestructiveChange::TableRecreate {
                database,
                table_name,
                reason,
            } => {
                write!(f, "DROP + RECREATE ")?;
                fmt_qualified(f, database, table_name)?;
                write!(f, " ({reason})")
            }
            DestructiveChange::ViewDrop {
                database,
                view_name,
            } => {
                write!(f, "DROP VIEW ")?;
                fmt_qualified(f, database, view_name)
            }
            DestructiveChange::MaterializedViewDrop {
                database,
                view_name,
            } => {
                write!(f, "DROP MATERIALIZED VIEW ")?;
                fmt_qualified(f, database, view_name)
            }
        }
    }
}

/// Aggregated risk assessment for a migration plan.
///
/// Produced by [`classify_plan_risk`] and consumed by
/// [`destructive_confirmation_gate`] to decide whether the user must confirm.
#[derive(Debug, Clone)]
pub struct PlanRisk {
    /// Every destructive operation found in the plan. Empty when the migration
    /// is purely additive / non-destructive.
    pub destructive_changes: Vec<DestructiveChange>,
}

impl PlanRisk {
    /// Returns `true` when the plan contains at least one destructive operation.
    pub fn is_destructive(&self) -> bool {
        !self.destructive_changes.is_empty()
    }
}

/// Walks the OLAP changes and collects every operation that may cause data loss.
///
/// A `TableChange::Removed` followed by a `TableChange::Added` with the same
/// name is treated as a recreate rather than two independent operations.
/// `ColumnChange::Renamed` is non-destructive and is intentionally skipped.
pub fn classify_plan_risk(changes: &InfraChanges) -> PlanRisk {
    let mut destructive_changes = Vec::new();

    // Collect (database, name) pairs for tables that are both removed and added (recreates).
    let removed_table_keys: std::collections::HashSet<(Option<&str>, &str)> = changes
        .olap_changes
        .iter()
        .filter_map(|c| match c {
            OlapChange::Table(TableChange::Removed(t)) => {
                Some((t.database.as_deref(), t.name.as_str()))
            }
            _ => None,
        })
        .collect();

    let added_table_keys: std::collections::HashSet<(Option<&str>, &str)> = changes
        .olap_changes
        .iter()
        .filter_map(|c| match c {
            OlapChange::Table(TableChange::Added(t)) => {
                Some((t.database.as_deref(), t.name.as_str()))
            }
            _ => None,
        })
        .collect();

    let recreated_table_keys: std::collections::HashSet<(Option<&str>, &str)> = removed_table_keys
        .intersection(&added_table_keys)
        .copied()
        .collect();

    for change in &changes.olap_changes {
        match change {
            OlapChange::Table(TableChange::Removed(table)) => {
                let key = (table.database.as_deref(), table.name.as_str());
                if recreated_table_keys.contains(&key) {
                    destructive_changes.push(DestructiveChange::TableRecreate {
                        database: table.database.clone(),
                        table_name: table.name.clone(),
                        reason: "schema change requires drop + recreate".to_string(),
                    });
                } else {
                    destructive_changes.push(DestructiveChange::TableDrop {
                        database: table.database.clone(),
                        table_name: table.name.clone(),
                    });
                }
            }
            OlapChange::Table(TableChange::Updated {
                column_changes,
                before,
                ..
            }) => {
                for col_change in column_changes {
                    if let ColumnChange::Removed(col) = col_change {
                        destructive_changes.push(DestructiveChange::ColumnDrop {
                            database: before.database.clone(),
                            table_name: before.name.clone(),
                            column_name: col.name.clone(),
                        });
                    }
                }
            }
            OlapChange::MaterializedView(Change::Removed(mv)) => {
                destructive_changes.push(DestructiveChange::MaterializedViewDrop {
                    database: mv.database.clone(),
                    view_name: mv.name.clone(),
                });
            }
            OlapChange::View(Change::Removed(v)) => {
                destructive_changes.push(DestructiveChange::ViewDrop {
                    database: v.database.clone(),
                    view_name: v.name.clone(),
                });
            }
            _ => {}
        }
    }

    PlanRisk {
        destructive_changes,
    }
}

/// Controls whether the destructive confirmation gate auto-approves.
#[derive(Debug, Clone, Copy)]
pub struct ConfirmationPolicy {
    /// Set by `--yes-destructive` or `MOOSE_ACCEPT_DESTRUCTIVE=1`
    pub accept_destructive: bool,
}

/// Gates execution on explicit user acknowledgment when the plan contains
/// destructive operations.
///
/// Returns `Ok(true)` to proceed, `Ok(false)` if the user cancelled (not an
/// error — just skip execution), or `Err` for real failures (non-interactive
/// without override).
pub async fn destructive_confirmation_gate(
    risk: &PlanRisk,
    policy: &ConfirmationPolicy,
) -> Result<bool, RoutineFailure> {
    if !risk.is_destructive() {
        return Ok(true);
    }

    let summary = format_destructive_summary(risk);

    if policy.accept_destructive {
        show_message!(
            MessageType::Warning,
            Message::new(
                "Destructive".to_string(),
                format!(
                    "Auto-approved {} destructive operation(s) via override:\n{}",
                    risk.destructive_changes.len(),
                    summary
                )
            )
        );
        return Ok(true);
    }

    if !std::io::stdin().is_terminal() {
        return Err(RoutineFailure::error(Message::new(
            "Destructive".to_string(),
            format!(
                "Plan contains {} destructive operation(s) but running non-interactively.\n\
                 {}\n\n\
                 To proceed, re-run with --yes-destructive or set MOOSE_ACCEPT_DESTRUCTIVE=1",
                risk.destructive_changes.len(),
                summary
            ),
        )));
    }

    show_message!(
        MessageType::Warning,
        Message::new(
            "Destructive".to_string(),
            format!(
                "Plan contains {} destructive operation(s) that may cause data loss:\n{}",
                risk.destructive_changes.len(),
                summary
            )
        )
    );

    show_message!(
        MessageType::Highlight,
        Message::new(
            "Tip".to_string(),
            "Consider a safer versioned-table migration instead:\n  \
             1. Create a *_v2 table with the new schema\n  \
             2. Cut readers/writers over\n  \
             3. Validate parity\n  \
             4. Retire the old table later"
                .to_string()
        )
    );

    let accepted = if stdout().is_terminal() {
        match pinned_prompt(risk.destructive_changes.len()).await {
            Ok(result) => result,
            Err(_) => plain_prompt().await?,
        }
    } else {
        plain_prompt().await?
    };

    if accepted {
        Ok(true)
    } else {
        show_message!(
            MessageType::Warning,
            Message::new(
                "Cancelled".to_string(),
                "Destructive changes rejected — skipping this change cycle.".to_string()
            )
        );
        Ok(false)
    }
}

async fn plain_prompt() -> Result<bool, RoutineFailure> {
    let input =
        prompt_user_async("\nProceed with destructive changes? [y/N]", Some("N"), None).await?;
    Ok(matches!(input.trim().to_lowercase().as_str(), "y" | "yes"))
}

// ---------------------------------------------------------------------------
// Pinned terminal prompt (scroll-region based, no raw mode)
// ---------------------------------------------------------------------------

const PINNED_PROMPT_LINES: u16 = 3;
const PROMPT_REDRAW_INTERVAL: Duration = Duration::from_millis(500);

/// RAII guard that restores the scroll region on drop.
struct ScrollRegionGuard {
    original_rows: u16,
}

impl Drop for ScrollRegionGuard {
    fn drop(&mut self) {
        let _lock = terminal_lock::acquire();
        terminal_lock::clear_scroll_region_bottom();
        let rows = terminal::size()
            .map(|(_, r)| r)
            .unwrap_or(self.original_rows);
        let start = rows.saturating_sub(PINNED_PROMPT_LINES);
        for row in start..rows {
            let _ = execute!(stdout(), MoveTo(0, row), Clear(ClearType::CurrentLine));
        }
        let _ = write!(stdout(), "\x1b[1;{}r", rows); // reset scroll region to whole screen
        let _ = execute!(stdout(), MoveTo(0, start));
        let _ = stdout().flush();
    }
}

/// Displays a pinned prompt at the bottom of the terminal while log output
/// scrolls above it, and waits for line-based input (y/yes + Enter).
///
/// Uses an ANSI scroll region to confine normal output to the upper portion
/// of the terminal. The bottom [`PINNED_PROMPT_LINES`] rows are reserved for
/// the prompt and redrawn periodically to stay visible.
async fn pinned_prompt(change_count: usize) -> std::io::Result<bool> {
    let (_cols, mut current_rows) = terminal::size()?;

    let _guard = ScrollRegionGuard {
        original_rows: current_rows,
    };

    {
        let _lock = terminal_lock::acquire();
        for _ in 0..PINNED_PROMPT_LINES + 1 {
            execute!(stdout(), Print("\n"))?;
        }
        apply_scroll_region(current_rows)?;
        let scroll_bottom = current_rows.saturating_sub(PINNED_PROMPT_LINES + 1);
        terminal_lock::set_scroll_region_bottom(scroll_bottom);
    }

    draw_pinned_prompt_full(current_rows, change_count)?;
    park_cursor(current_rows)?;

    let stdin = tokio::io::BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();

    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line {
                    Ok(Some(input)) => {
                        return Ok(matches!(input.trim().to_lowercase().as_str(), "y" | "yes"));
                    }
                    Ok(None) | Err(_) => return Ok(false),
                }
            }
            _ = tokio::time::sleep(PROMPT_REDRAW_INTERVAL) => {
                let actual_rows = terminal::size().map(|(_, r)| r).unwrap_or(current_rows);
                if actual_rows != current_rows {
                    reconcile_resize(&mut current_rows, actual_rows, change_count)?;
                } else {
                    draw_pinned_prompt(current_rows, change_count)?;
                }
            }
        }
    }
}

fn apply_scroll_region(rows: u16) -> std::io::Result<()> {
    let scroll_bottom = rows.saturating_sub(PINNED_PROMPT_LINES + 1);
    write!(stdout(), "\x1b[1;{}r", scroll_bottom + 1)?;
    stdout().flush()
}

/// Parks the cursor at the ` > ` input line so the user's typed text
/// echoes there. Log output is redirected into the scroll region by
/// `write_styled_line` via the global scroll-region marker.
fn park_cursor(rows: u16) -> std::io::Result<()> {
    let _lock = terminal_lock::acquire();
    let prompt_row = rows.saturating_sub(1);
    execute!(stdout(), MoveTo(3, prompt_row))?;
    stdout().flush()
}

fn reconcile_resize(
    current_rows: &mut u16,
    new_rows: u16,
    change_count: usize,
) -> std::io::Result<()> {
    let old_rows = *current_rows;
    *current_rows = new_rows;

    let _lock = terminal_lock::acquire();
    let old_start = old_rows.saturating_sub(PINNED_PROMPT_LINES);
    for row in old_start..old_rows {
        let _ = execute!(stdout(), MoveTo(0, row), Clear(ClearType::CurrentLine));
    }
    apply_scroll_region(new_rows)?;
    let scroll_bottom = new_rows.saturating_sub(PINNED_PROMPT_LINES + 1);
    terminal_lock::set_scroll_region_bottom(scroll_bottom);
    drop(_lock);

    draw_pinned_prompt_full(new_rows, change_count)?;
    park_cursor(new_rows)
}

/// Redraws the separator and prompt text but NOT the ` > ` input line,
/// so the user's in-progress typing is preserved.
fn draw_pinned_prompt(rows: u16, change_count: usize) -> std::io::Result<()> {
    let start = rows.saturating_sub(PINNED_PROMPT_LINES);
    let cols = terminal::size().map(|(c, _)| c).unwrap_or(50) as usize;
    let separator = "─".repeat(cols);
    let prompt_text = format!(
        " \x1b[1;33m⚠\x1b[0m  {} destructive change(s) — type \x1b[1my\x1b[0m to accept, \x1b[1mn\x1b[0m to reject",
        change_count
    );

    let _lock = terminal_lock::acquire();
    execute!(
        stdout(),
        crossterm::terminal::BeginSynchronizedUpdate,
        crossterm::cursor::SavePosition,
        MoveTo(0, start),
        Clear(ClearType::CurrentLine),
        Print(format!("\x1b[90m{separator}\x1b[0m")),
        MoveTo(0, start + 1),
        Clear(ClearType::CurrentLine),
        Print(&prompt_text),
        crossterm::cursor::RestorePosition,
        crossterm::terminal::EndSynchronizedUpdate,
    )?;
    stdout().flush()
}

/// Draws the full prompt area including the ` > ` input line.
/// Used only on initial setup and after terminal resize.
fn draw_pinned_prompt_full(rows: u16, change_count: usize) -> std::io::Result<()> {
    draw_pinned_prompt(rows, change_count)?;
    let input_row = rows.saturating_sub(1);
    let _lock = terminal_lock::acquire();
    execute!(
        stdout(),
        MoveTo(0, input_row),
        Clear(ClearType::CurrentLine),
        Print(" > "),
    )?;
    stdout().flush()
}

/// Classifies risk from serialized migration operations (used by `moose migrate`).
///
/// Detects `DropTable`, `DropTableColumn`, and `DropView`/`DropMaterializedView`
/// operations. A `DropTable` followed by a `CreateTable` with the same
/// (database, name) pair is classified as a recreate.
pub fn classify_operations_risk(operations: &[SerializableOlapOperation]) -> PlanRisk {
    let mut destructive_changes = Vec::new();

    let dropped_tables: std::collections::HashSet<(Option<&str>, &str)> = operations
        .iter()
        .filter_map(|op| match op {
            SerializableOlapOperation::DropTable {
                table, database, ..
            } => Some((database.as_deref(), table.as_str())),
            _ => None,
        })
        .collect();

    let created_tables: std::collections::HashSet<(Option<&str>, &str)> = operations
        .iter()
        .filter_map(|op| match op {
            SerializableOlapOperation::CreateTable { table } => {
                Some((table.database.as_deref(), table.name.as_str()))
            }
            _ => None,
        })
        .collect();

    let recreated: std::collections::HashSet<(Option<&str>, &str)> = dropped_tables
        .intersection(&created_tables)
        .copied()
        .collect();

    for op in operations {
        match op {
            SerializableOlapOperation::DropTable {
                table, database, ..
            } => {
                let key = (database.as_deref(), table.as_str());
                if recreated.contains(&key) {
                    destructive_changes.push(DestructiveChange::TableRecreate {
                        database: database.clone(),
                        table_name: table.clone(),
                        reason: "schema change requires drop + recreate".to_string(),
                    });
                } else {
                    destructive_changes.push(DestructiveChange::TableDrop {
                        database: database.clone(),
                        table_name: table.clone(),
                    });
                }
            }
            SerializableOlapOperation::DropTableColumn {
                table,
                column_name,
                database,
                ..
            } => {
                destructive_changes.push(DestructiveChange::ColumnDrop {
                    database: database.clone(),
                    table_name: table.clone(),
                    column_name: column_name.clone(),
                });
            }
            SerializableOlapOperation::DropView { name, database } => {
                destructive_changes.push(DestructiveChange::ViewDrop {
                    database: database.clone(),
                    view_name: name.clone(),
                });
            }
            SerializableOlapOperation::DropMaterializedView { name, database, .. } => {
                destructive_changes.push(DestructiveChange::MaterializedViewDrop {
                    database: database.clone(),
                    view_name: name.clone(),
                });
            }
            _ => {}
        }
    }

    PlanRisk {
        destructive_changes,
    }
}

fn format_destructive_summary(risk: &PlanRisk) -> String {
    risk.destructive_changes
        .iter()
        .map(|c| format!("  - {c}"))
        .collect::<Vec<_>>()
        .join("\n")
}

// ---------------------------------------------------------------------------
// Migration-generation specific destructive gate
// ---------------------------------------------------------------------------

/// Information about a table that was destructively changed, with the
/// computed next safe version name.
#[derive(Debug, Clone)]
pub struct DestructiveTableInfo {
    pub table_name: String,
    pub database: Option<String>,
    pub next_version_name: String,
}

/// Computes the next versioned name for a table.
///
/// `Events`    -> `Events_v2`
/// `Events_v3` -> `Events_v4`
pub fn derive_next_version(table_name: &str) -> String {
    let re = regex::Regex::new(r"^(.+)_v(\d+)$").expect("valid regex");
    if let Some(caps) = re.captures(table_name) {
        let base = &caps[1];
        let current: u32 = caps[2].parse().unwrap_or(1);
        format!("{base}_v{}", current + 1)
    } else {
        format!("{table_name}_v2")
    }
}

/// Collects [`DestructiveTableInfo`] for every table recreate / drop in the
/// risk assessment.  Used by the rejection path to generate safe snippets.
fn collect_destructive_table_info(risk: &PlanRisk) -> Vec<DestructiveTableInfo> {
    risk.destructive_changes
        .iter()
        .filter_map(|c| match c {
            DestructiveChange::TableRecreate {
                database,
                table_name,
                ..
            }
            | DestructiveChange::TableDrop {
                database,
                table_name,
            } => Some(DestructiveTableInfo {
                table_name: table_name.clone(),
                database: database.clone(),
                next_version_name: derive_next_version(table_name),
            }),
            _ => None,
        })
        .collect()
}

/// Migration-generation specific destructive gate.
///
/// Differs from [`destructive_confirmation_gate`] (used by `moose dev`):
///
/// * DANGER-prefixed prompt with default **No** (`[y/N]`).
/// * On rejection returns `Ok(MigrationGateOutcome::Rejected { .. })` with
///   the table info needed to print safe-snippet guidance.
/// * Non-interactive without override returns `Err` with actionable text.
pub async fn migration_destructive_gate(
    risk: &PlanRisk,
    policy: &ConfirmationPolicy,
) -> Result<MigrationGateOutcome, RoutineFailure> {
    if !risk.is_destructive() {
        return Ok(MigrationGateOutcome::NoDestructiveChanges);
    }

    let summary = format_destructive_summary(risk);

    if policy.accept_destructive {
        show_message!(
            MessageType::Warning,
            Message::new(
                "Destructive".to_string(),
                format!(
                    "Auto-approved {} destructive operation(s) via override:\n{}",
                    risk.destructive_changes.len(),
                    summary
                )
            )
        );
        return Ok(MigrationGateOutcome::Accepted);
    }

    if !std::io::stdin().is_terminal() {
        return Err(RoutineFailure::error(Message::new(
            "Destructive".to_string(),
            format!(
                "Plan contains {} destructive operation(s) but running non-interactively.\n\
                 {}\n\n\
                 To proceed, re-run with --yes-destructive or set MOOSE_ACCEPT_DESTRUCTIVE=1",
                risk.destructive_changes.len(),
                summary
            ),
        )));
    }

    // DANGER banner
    show_message!(
        MessageType::Error,
        Message::new(
            "DANGER".to_string(),
            format!(
                "The operation that you just committed is going to create destructive changes:\n{}",
                summary
            )
        )
    );
    show_message!(
        MessageType::Highlight,
        Message::new(
            "Safer option".to_string(),
            "Generate the next versioned table and migrate gradually.".to_string()
        )
    );

    let input =
        prompt_user_async("Are you sure you want to continue? [y/N]", Some("N"), None).await?;
    let accepted = matches!(input.trim().to_lowercase().as_str(), "y" | "yes");

    if accepted {
        Ok(MigrationGateOutcome::Accepted)
    } else {
        Ok(MigrationGateOutcome::Rejected {
            tables: collect_destructive_table_info(risk),
        })
    }
}

/// Outcome of [`migration_destructive_gate`].
#[derive(Debug)]
pub enum MigrationGateOutcome {
    /// Plan has no destructive changes — proceed.
    NoDestructiveChanges,
    /// User (or override) accepted destructive changes.
    Accepted,
    /// User rejected; includes info for the safe-snippet guidance.
    Rejected { tables: Vec<DestructiveTableInfo> },
}

/// Prints the safe-path guidance shown when the user rejects destructive
/// migration generation.
pub fn print_migration_rejected_guidance(
    tables: &[DestructiveTableInfo],
    language: &crate::framework::languages::SupportedLanguages,
) {
    use crate::framework::languages::SupportedLanguages;

    println!("\nMigration generation aborted.");
    println!(
        "Safer next step: create a versioned table in your model code, \
         export it from your root module, then regenerate migration.\n"
    );

    for info in tables {
        println!("  {0} → {1}", info.table_name, info.next_version_name);
    }

    let (root_file, export_hint) = match language {
        SupportedLanguages::Typescript => (
            "index.ts",
            "export { <Model>_vN } from './your-model-file';",
        ),
        SupportedLanguages::Python => (
            "__init__.py or models directory",
            "from .your_model_file import <Model>_vN",
        ),
    };

    println!("\nNext Steps");
    println!("  1. Rename your updated model to the versioned name shown above");
    println!("  2. Export the new symbol from root `{root_file}`");
    println!("     {export_hint}");
    println!("  3. Run `moose generate migration` again");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, OrderBy, Table};
    use crate::framework::core::infrastructure_map::{
        ColumnChange, OlapChange, OrderByChange, PartitionByChange, PrimitiveSignature,
        PrimitiveTypes, TableChange,
    };
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

    fn make_table(name: &str) -> Table {
        Table {
            name: name.to_string(),
            columns: vec![],
            order_by: OrderBy::Fields(vec![]),
            partition_by: None,
            sample_by: None,
            engine: ClickhouseEngine::MergeTree,
            version: None,
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

    fn make_column(name: &str) -> Column {
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

    fn empty_changes() -> InfraChanges {
        InfraChanges::default()
    }

    #[test]
    fn empty_plan_is_not_destructive() {
        let risk = classify_plan_risk(&empty_changes());
        assert!(!risk.is_destructive());
    }

    #[test]
    fn table_drop_is_destructive() {
        let mut changes = empty_changes();
        changes
            .olap_changes
            .push(OlapChange::Table(TableChange::Removed(make_table(
                "events",
            ))));

        let risk = classify_plan_risk(&changes);
        assert!(risk.is_destructive());
        assert_eq!(risk.destructive_changes.len(), 1);
        assert!(matches!(
            &risk.destructive_changes[0],
            DestructiveChange::TableDrop { database: None, table_name } if table_name == "events"
        ));
    }

    #[test]
    fn column_drop_is_destructive() {
        let mut changes = empty_changes();
        changes
            .olap_changes
            .push(OlapChange::Table(TableChange::Updated {
                name: "events".to_string(),
                column_changes: vec![ColumnChange::Removed(make_column("old_col"))],
                order_by_change: OrderByChange {
                    before: OrderBy::Fields(vec![]),
                    after: OrderBy::Fields(vec![]),
                },
                partition_by_change: PartitionByChange {
                    before: None,
                    after: None,
                },
                before: make_table("events"),
                after: make_table("events"),
            }));

        let risk = classify_plan_risk(&changes);
        assert!(risk.is_destructive());
        assert!(matches!(
            &risk.destructive_changes[0],
            DestructiveChange::ColumnDrop { database: None, table_name, column_name }
                if table_name == "events" && column_name == "old_col"
        ));
    }

    #[test]
    fn drop_plus_add_same_name_is_recreate() {
        let mut changes = empty_changes();
        changes
            .olap_changes
            .push(OlapChange::Table(TableChange::Removed(make_table(
                "events",
            ))));
        changes
            .olap_changes
            .push(OlapChange::Table(TableChange::Added(make_table("events"))));

        let risk = classify_plan_risk(&changes);
        assert!(risk.is_destructive());
        assert_eq!(risk.destructive_changes.len(), 1);
        assert!(matches!(
            &risk.destructive_changes[0],
            DestructiveChange::TableRecreate { database: None, table_name, .. } if table_name == "events"
        ));
    }

    #[test]
    fn added_column_is_not_destructive() {
        let mut changes = empty_changes();
        changes
            .olap_changes
            .push(OlapChange::Table(TableChange::Updated {
                name: "events".to_string(),
                column_changes: vec![ColumnChange::Added {
                    column: make_column("new_col"),
                    position_after: None,
                }],
                order_by_change: OrderByChange {
                    before: OrderBy::Fields(vec![]),
                    after: OrderBy::Fields(vec![]),
                },
                partition_by_change: PartitionByChange {
                    before: None,
                    after: None,
                },
                before: make_table("events"),
                after: make_table("events"),
            }));

        let risk = classify_plan_risk(&changes);
        assert!(!risk.is_destructive());
    }

    #[test]
    fn table_add_only_is_not_destructive() {
        let mut changes = empty_changes();
        changes
            .olap_changes
            .push(OlapChange::Table(TableChange::Added(make_table(
                "new_table",
            ))));

        let risk = classify_plan_risk(&changes);
        assert!(!risk.is_destructive());
    }

    // ---------------------------------------------------------------
    // classify_operations_risk tests
    // ---------------------------------------------------------------

    #[test]
    fn ops_empty_is_not_destructive() {
        let risk = classify_operations_risk(&[]);
        assert!(!risk.is_destructive());
    }

    #[test]
    fn ops_drop_table_is_destructive() {
        let ops = vec![SerializableOlapOperation::DropTable {
            table: "events".to_string(),
            database: None,
            cluster_name: None,
        }];
        let risk = classify_operations_risk(&ops);
        assert!(risk.is_destructive());
        assert!(matches!(
            &risk.destructive_changes[0],
            DestructiveChange::TableDrop { table_name, .. } if table_name == "events"
        ));
    }

    #[test]
    fn ops_drop_plus_create_same_name_is_recreate() {
        let ops = vec![
            SerializableOlapOperation::DropTable {
                table: "events".to_string(),
                database: None,
                cluster_name: None,
            },
            SerializableOlapOperation::CreateTable {
                table: make_table("events"),
            },
        ];
        let risk = classify_operations_risk(&ops);
        assert!(risk.is_destructive());
        assert_eq!(risk.destructive_changes.len(), 1);
        assert!(matches!(
            &risk.destructive_changes[0],
            DestructiveChange::TableRecreate { table_name, .. } if table_name == "events"
        ));
    }

    #[test]
    fn ops_drop_column_is_destructive() {
        let ops = vec![SerializableOlapOperation::DropTableColumn {
            table: "events".to_string(),
            column_name: "old_col".to_string(),
            database: None,
            cluster_name: None,
        }];
        let risk = classify_operations_risk(&ops);
        assert!(risk.is_destructive());
        assert!(matches!(
            &risk.destructive_changes[0],
            DestructiveChange::ColumnDrop { table_name, column_name, .. }
                if table_name == "events" && column_name == "old_col"
        ));
    }

    #[test]
    fn ops_drop_view_is_destructive() {
        let ops = vec![SerializableOlapOperation::DropView {
            name: "my_view".to_string(),
            database: None,
        }];
        let risk = classify_operations_risk(&ops);
        assert!(risk.is_destructive());
        assert!(matches!(
            &risk.destructive_changes[0],
            DestructiveChange::ViewDrop { view_name, .. } if view_name == "my_view"
        ));
    }

    #[test]
    fn ops_drop_mv_is_destructive() {
        let ops = vec![SerializableOlapOperation::DropMaterializedView {
            name: "my_mv".to_string(),
            database: None,
        }];
        let risk = classify_operations_risk(&ops);
        assert!(risk.is_destructive());
        assert!(matches!(
            &risk.destructive_changes[0],
            DestructiveChange::MaterializedViewDrop { view_name, .. } if view_name == "my_mv"
        ));
    }

    #[test]
    fn ops_create_only_is_not_destructive() {
        let ops = vec![SerializableOlapOperation::CreateTable {
            table: make_table("new_table"),
        }];
        let risk = classify_operations_risk(&ops);
        assert!(!risk.is_destructive());
    }

    #[test]
    fn ops_add_column_is_not_destructive() {
        let ops = vec![SerializableOlapOperation::AddTableColumn {
            table: "events".to_string(),
            column: make_column("new_col"),
            after_column: None,
            database: None,
            cluster_name: None,
        }];
        let risk = classify_operations_risk(&ops);
        assert!(!risk.is_destructive());
    }

    // ---------------------------------------------------------------
    // derive_next_version tests
    // ---------------------------------------------------------------

    #[test]
    fn next_version_from_unversioned_table() {
        assert_eq!(derive_next_version("Events"), "Events_v2");
    }

    #[test]
    fn next_version_from_v3() {
        assert_eq!(derive_next_version("Events_v3"), "Events_v4");
    }

    #[test]
    fn next_version_from_v1() {
        assert_eq!(derive_next_version("Events_v1"), "Events_v2");
    }

    #[test]
    fn collect_destructive_info_for_recreate() {
        let risk = PlanRisk {
            destructive_changes: vec![DestructiveChange::TableRecreate {
                database: None,
                table_name: "Events_v3".to_string(),
                reason: "order by changed".to_string(),
            }],
        };
        let info = collect_destructive_table_info(&risk);
        assert_eq!(info.len(), 1);
        assert_eq!(info[0].table_name, "Events_v3");
        assert_eq!(info[0].next_version_name, "Events_v4");
    }

    #[test]
    fn collect_destructive_info_for_drop() {
        let risk = PlanRisk {
            destructive_changes: vec![DestructiveChange::TableDrop {
                database: Some("analytics".to_string()),
                table_name: "Users".to_string(),
            }],
        };
        let info = collect_destructive_table_info(&risk);
        assert_eq!(info.len(), 1);
        assert_eq!(info[0].table_name, "Users");
        assert_eq!(info[0].next_version_name, "Users_v2");
        assert_eq!(info[0].database, Some("analytics".to_string()));
    }

    #[test]
    fn collect_skips_non_table_destructive_changes() {
        let risk = PlanRisk {
            destructive_changes: vec![
                DestructiveChange::ViewDrop {
                    database: None,
                    view_name: "my_view".to_string(),
                },
                DestructiveChange::ColumnDrop {
                    database: None,
                    table_name: "events".to_string(),
                    column_name: "old_col".to_string(),
                },
            ],
        };
        let info = collect_destructive_table_info(&risk);
        assert!(info.is_empty());
    }
}
