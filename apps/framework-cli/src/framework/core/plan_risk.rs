//! Destructive-change detection and confirmation gate for migration plans.
//!
//! Before executing a migration, [`classify_plan_risk`] scans OLAP changes for
//! operations that may cause data loss (table/column drops, recreates, view
//! removals). [`destructive_confirmation_gate`] then enforces user confirmation
//! via an interactive prompt (with a pinned terminal region in TTY mode) or via
//! the `--yes-destructive` / `MOOSE_ACCEPT_DESTRUCTIVE` overrides.

use std::collections::{HashMap, HashSet};
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

use super::infrastructure_map::{
    apply_detected_renames, Change, ColumnChange, DetectedColumnRename, InfraChanges, OlapChange,
    PendingTableRenames, TableChange,
};

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

    /// Removes column drops that the user already approved during the rename
    /// confirmation step (by choosing "drop + recreate instead"), so the
    /// destructive gate doesn't ask twice about the same column.
    pub fn exclude_approved_drops(&mut self, approved: &HashSet<ApprovedColumnDrop>) {
        if approved.is_empty() {
            return;
        }
        self.destructive_changes.retain(|dc| {
            if let DestructiveChange::ColumnDrop {
                database,
                table_name,
                column_name,
            } = dc
            {
                !approved.contains(&ApprovedColumnDrop {
                    database: database.clone(),
                    table_name: table_name.clone(),
                    column_name: column_name.clone(),
                })
            } else {
                true
            }
        });
    }
}

/// A column drop that the user already approved during rename confirmation
/// (by choosing "drop + recreate instead").
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ApprovedColumnDrop {
    pub database: Option<String>,
    pub table_name: String,
    pub column_name: String,
}

/// Walks the OLAP changes and collects every operation that may cause data loss.
///
/// A `TableChange::Removed` followed by a `TableChange::Added` with the same
/// name is treated as a recreate rather than two independent operations.
/// `ColumnChange::Renamed` is non-destructive and is intentionally skipped.
pub fn classify_plan_risk(changes: &InfraChanges) -> PlanRisk {
    let mut destructive_changes = Vec::new();

    // Collect (database, name) pairs for tables that are both removed and added (recreates).
    let removed_table_keys: HashSet<(Option<&str>, &str)> = changes
        .olap_changes
        .iter()
        .filter_map(|c| match c {
            OlapChange::Table(TableChange::Removed(t)) => {
                Some((t.database.as_deref(), t.name.as_str()))
            }
            _ => None,
        })
        .collect();

    let added_table_keys: HashSet<(Option<&str>, &str)> = changes
        .olap_changes
        .iter()
        .filter_map(|c| match c {
            OlapChange::Table(TableChange::Added(t)) => {
                Some((t.database.as_deref(), t.name.as_str()))
            }
            _ => None,
        })
        .collect();

    let recreated_table_keys: HashSet<(Option<&str>, &str)> = removed_table_keys
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
    /// Whether we are running in dev mode (affects messaging)
    pub is_dev: bool,
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

    if policy.is_dev {
        show_message!(
            MessageType::Highlight,
            Message::new(
                "Tip".to_string(),
                "For production, consider a versioned-table migration instead:\n  \
                 1. Create a *_v2 table with the new schema\n  \
                 2. Cut readers/writers over\n  \
                 3. Validate parity\n  \
                 4. Retire the old table later"
                    .to_string()
            )
        );
    }

    let accepted = if stdout().is_terminal() {
        let text = format!(
            " \x1b[1;33m⚠\x1b[0m  {} destructive change(s) — type \x1b[1my\x1b[0m to accept, \x1b[1mn\x1b[0m to reject",
            risk.destructive_changes.len()
        );
        match PinnedSession::start() {
            Ok(mut session) => {
                let input = session.prompt(&text).await.unwrap_or_default();
                matches!(input.as_str(), "y" | "yes")
            }
            Err(_) => plain_prompt().await?,
        }
    } else {
        plain_prompt().await?
    };

    if accepted {
        show_message!(
            MessageType::Success,
            Message::new(
                "Accepted".to_string(),
                format!(
                    "Proceeding with {} destructive change(s).",
                    risk.destructive_changes.len()
                )
            )
        );
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
//
// `PinnedSession` reserves the bottom 3 rows of the terminal for an
// interactive prompt while log output scrolls above in a confined scroll
// region. The session can issue multiple sequential prompts (e.g. one per
// detected rename) without tearing down / rebuilding the scroll region.

const PINNED_PROMPT_LINES: u16 = 3;
const PROMPT_REDRAW_INTERVAL: Duration = Duration::from_millis(500);

/// Manages a scroll-region-based pinned prompt area at the terminal bottom.
///
/// Create via [`PinnedSession::start`], then call [`prompt`](PinnedSession::prompt)
/// one or more times. The scroll region is restored when the session is dropped.
struct PinnedSession {
    current_rows: u16,
    current_text: String,
    lines: tokio::io::Lines<tokio::io::BufReader<tokio::io::Stdin>>,
}

impl PinnedSession {
    /// Sets up the scroll region and returns a ready session.
    fn start() -> std::io::Result<Self> {
        let (_cols, current_rows) = terminal::size()?;

        {
            let _lock = terminal_lock::acquire();
            for _ in 0..PINNED_PROMPT_LINES + 1 {
                execute!(stdout(), Print("\n"))?;
            }
            apply_scroll_region(current_rows)?;
            let scroll_bottom = current_rows.saturating_sub(PINNED_PROMPT_LINES + 1);
            terminal_lock::set_scroll_region_bottom(scroll_bottom);
        }

        let stdin = tokio::io::BufReader::new(tokio::io::stdin());
        Ok(Self {
            current_rows,
            current_text: String::new(),
            lines: stdin.lines(),
        })
    }

    /// Displays `text` in the pinned area and waits for one line of input.
    ///
    /// The text should be a single line (long lines will be truncated by the
    /// terminal). Returns the trimmed, lowercased user input, or an empty
    /// string on EOF.
    async fn prompt(&mut self, text: &str) -> std::io::Result<String> {
        self.current_text = text.to_string();
        self.draw_full()?;
        self.park_cursor()?;

        loop {
            tokio::select! {
                line = self.lines.next_line() => {
                    return Ok(line
                        .ok()
                        .flatten()
                        .map(|s| s.trim().to_lowercase())
                        .unwrap_or_default());
                }
                _ = tokio::time::sleep(PROMPT_REDRAW_INTERVAL) => {
                    let actual = terminal::size().map(|(_, r)| r).unwrap_or(self.current_rows);
                    if actual != self.current_rows {
                        self.reconcile_resize(actual)?;
                    } else {
                        self.draw_text()?;
                    }
                }
            }
        }
    }

    fn draw_text(&self) -> std::io::Result<()> {
        let start = self.current_rows.saturating_sub(PINNED_PROMPT_LINES);
        let cols = terminal::size().map(|(c, _)| c).unwrap_or(50) as usize;
        let separator = "─".repeat(cols);

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
            Print(&self.current_text),
            crossterm::cursor::RestorePosition,
            crossterm::terminal::EndSynchronizedUpdate,
        )?;
        stdout().flush()
    }

    fn draw_full(&self) -> std::io::Result<()> {
        self.draw_text()?;
        let input_row = self.current_rows.saturating_sub(1);
        let _lock = terminal_lock::acquire();
        execute!(
            stdout(),
            MoveTo(0, input_row),
            Clear(ClearType::CurrentLine),
            Print(" > "),
        )?;
        stdout().flush()
    }

    fn park_cursor(&self) -> std::io::Result<()> {
        let _lock = terminal_lock::acquire();
        let prompt_row = self.current_rows.saturating_sub(1);
        execute!(stdout(), MoveTo(3, prompt_row))?;
        stdout().flush()
    }

    fn reconcile_resize(&mut self, new_rows: u16) -> std::io::Result<()> {
        let old_rows = self.current_rows;
        self.current_rows = new_rows;

        let _lock = terminal_lock::acquire();
        let old_start = old_rows.saturating_sub(PINNED_PROMPT_LINES);
        for row in old_start..old_rows {
            let _ = execute!(stdout(), MoveTo(0, row), Clear(ClearType::CurrentLine));
        }
        apply_scroll_region(new_rows)?;
        let scroll_bottom = new_rows.saturating_sub(PINNED_PROMPT_LINES + 1);
        terminal_lock::set_scroll_region_bottom(scroll_bottom);
        drop(_lock);

        self.draw_full()?;
        self.park_cursor()
    }
}

impl Drop for PinnedSession {
    fn drop(&mut self) {
        let _lock = terminal_lock::acquire();
        terminal_lock::clear_scroll_region_bottom();
        let rows = terminal::size()
            .map(|(_, r)| r)
            .unwrap_or(self.current_rows);
        let start = rows.saturating_sub(PINNED_PROMPT_LINES);
        for row in start..rows {
            let _ = execute!(stdout(), MoveTo(0, row), Clear(ClearType::CurrentLine));
        }
        let _ = write!(stdout(), "\x1b[1;{}r", rows);
        let _ = execute!(stdout(), MoveTo(0, start));
        let _ = stdout().flush();
    }
}

fn apply_scroll_region(rows: u16) -> std::io::Result<()> {
    let scroll_bottom = rows.saturating_sub(PINNED_PROMPT_LINES + 1);
    write!(stdout(), "\x1b[1;{}r", scroll_bottom + 1)?;
    stdout().flush()
}

fn format_destructive_summary(risk: &PlanRisk) -> String {
    risk.destructive_changes
        .iter()
        .map(|c| format!("  - {c}"))
        .collect::<Vec<_>>()
        .join("\n")
}

// ---------------------------------------------------------------------------
// Column-rename confirmation gate (forward-only)
// ---------------------------------------------------------------------------
//
// The plan initially contains raw `Removed` + `Added` pairs. Detected renames
// are stored as metadata in `InfraChanges::pending_column_renames`. This gate
// prompts the user per rename, then applies only the confirmed ones via
// `apply_detected_renames`, converting matched pairs to `ColumnChange::Renamed`.
// Rejected renames stay as `Removed` + `Added` (naturally destructive).

/// Displayable description of a single pending rename for prompting.
struct PendingRenameDisplay<'a> {
    database: &'a Option<String>,
    table_name: &'a str,
    rename: &'a DetectedColumnRename,
}

impl fmt::Display for PendingRenameDisplay<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "`{}` → `{}` in ",
            self.rename.before.name, self.rename.after.name
        )?;
        fmt_qualified(f, self.database, self.table_name)
    }
}

fn format_pending_renames_summary(pending: &[PendingTableRenames]) -> String {
    pending
        .iter()
        .flat_map(|t| {
            t.renames.iter().map(move |r| {
                format!(
                    "  - {}",
                    PendingRenameDisplay {
                        database: &t.database,
                        table_name: &t.table_name,
                        rename: r,
                    }
                )
            })
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn total_pending_rename_count(pending: &[PendingTableRenames]) -> usize {
    pending.iter().map(|t| t.renames.len()).sum()
}

/// Prompts the user per detected column rename and applies only confirmed ones.
///
/// The plan's `olap_changes` contain raw `Removed` + `Added` pairs. This
/// function reads `pending_column_renames`, asks the user for each one, and
/// converts confirmed pairs to `ColumnChange::Renamed` via
/// `apply_detected_renames`. Rejected renames remain as-is (destructive).
///
/// Returns `Ok(Some(approved_drops))` to proceed (the set should be passed to
/// `PlanRisk::exclude_approved_drops` so the destructive gate doesn't re-ask),
/// or `Ok(None)` if the user cancelled.
pub async fn rename_confirmation_gate(
    changes: &mut InfraChanges,
    policy: &ConfirmationPolicy,
) -> Result<Option<HashSet<ApprovedColumnDrop>>, RoutineFailure> {
    let pending = std::mem::take(&mut changes.pending_column_renames);
    let total = total_pending_rename_count(&pending);
    if total == 0 {
        return Ok(Some(HashSet::new()));
    }

    if policy.accept_destructive {
        show_message!(
            MessageType::Info,
            Message::new(
                "Rename".to_string(),
                format!(
                    "Auto-accepted {} column rename(s) via override:\n{}",
                    total,
                    format_pending_renames_summary(&pending),
                )
            )
        );
        apply_all_pending_renames(changes, &pending);
        return Ok(Some(HashSet::new()));
    }

    if !std::io::stdin().is_terminal() {
        return Err(RoutineFailure::error(Message::new(
            "Rename".to_string(),
            format!(
                "Plan contains {} detected column rename(s) but running non-interactively.\n\
                 {}\n\n\
                 To auto-accept, re-run with --yes-destructive or set MOOSE_ACCEPT_DESTRUCTIVE=1",
                total,
                format_pending_renames_summary(&pending),
            ),
        )));
    }

    let use_pinned = stdout().is_terminal();
    let mut session = if use_pinned {
        PinnedSession::start().ok()
    } else {
        None
    };

    let mut confirmed: HashMap<String, Vec<DetectedColumnRename>> = HashMap::new();
    let mut approved_drops: HashSet<ApprovedColumnDrop> = HashSet::new();
    let mut prompt_idx = 0usize;

    for table_renames in &pending {
        for rename in &table_renames.renames {
            prompt_idx += 1;
            let display = PendingRenameDisplay {
                database: &table_renames.database,
                table_name: &table_renames.table_name,
                rename,
            };

            let input = if let Some(ref mut s) = session {
                let text = format!(
                    " Rename ({prompt_idx}/{total}): {display}  \x1b[1my\x1b[0m=rename  \x1b[1mn\x1b[0m=drop+create  \x1b[1mc\x1b[0m=cancel"
                );
                s.prompt(&text).await.unwrap_or_default()
            } else {
                let text = format!(
                    "Rename detected ({}/{}): {}\n  \
                     [y] Yes, rename the column\n  \
                     [n] No, drop + recreate instead\n  \
                     [c] Cancel this change cycle",
                    prompt_idx, total, display,
                );
                prompt_user_async(&text, Some("y"), None).await?
            };

            match input.as_str() {
                "" | "y" | "yes" => {
                    show_message!(
                        MessageType::Success,
                        Message::new("Rename".to_string(), format!("Accepted: {display}"),)
                    );
                    confirmed
                        .entry(table_renames.table_name.clone())
                        .or_default()
                        .push(rename.clone());
                }
                "n" | "no" => {
                    show_message!(
                        MessageType::Warning,
                        Message::new(
                            "Drop+Create".to_string(),
                            format!("Rejected rename: {display}"),
                        )
                    );
                    approved_drops.insert(ApprovedColumnDrop {
                        database: table_renames.database.clone(),
                        table_name: table_renames.table_name.clone(),
                        column_name: rename.before.name.clone(),
                    });
                }
                _ => {
                    drop(session);
                    show_message!(
                        MessageType::Warning,
                        Message::new(
                            "Cancelled".to_string(),
                            "Rename confirmation cancelled — skipping this change cycle."
                                .to_string()
                        )
                    );
                    return Ok(None);
                }
            }
        }
    }

    // Apply only the confirmed renames to the plan.
    for change in &mut changes.olap_changes {
        if let OlapChange::Table(TableChange::Updated {
            name,
            column_changes,
            ..
        }) = change
        {
            if let Some(renames) = confirmed.get(name.as_str()) {
                let taken = std::mem::take(column_changes);
                *column_changes = apply_detected_renames(taken, renames);
            }
        }
    }

    Ok(Some(approved_drops))
}

/// Applies all pending renames (used by the auto-approve path).
fn apply_all_pending_renames(changes: &mut InfraChanges, pending: &[PendingTableRenames]) {
    let by_table: HashMap<&str, Vec<&DetectedColumnRename>> = pending
        .iter()
        .map(|t| (t.table_name.as_str(), t.renames.iter().collect::<Vec<_>>()))
        .collect();

    for change in &mut changes.olap_changes {
        if let OlapChange::Table(TableChange::Updated {
            name,
            column_changes,
            ..
        }) = change
        {
            if let Some(renames) = by_table.get(name.as_str()) {
                let owned: Vec<DetectedColumnRename> =
                    renames.iter().map(|r| (*r).clone()).collect();
                let taken = std::mem::take(column_changes);
                *column_changes = apply_detected_renames(taken, &owned);
            }
        }
    }
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

    #[test]
    fn column_rename_is_not_destructive() {
        let mut changes = empty_changes();
        changes
            .olap_changes
            .push(OlapChange::Table(TableChange::Updated {
                name: "events".to_string(),
                column_changes: vec![ColumnChange::Renamed {
                    before: make_column("old_name"),
                    after: make_column("new_name"),
                    confidence: 0.9,
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
    fn pending_renames_counted() {
        let mut changes = empty_changes();
        changes.pending_column_renames.push(PendingTableRenames {
            database: None,
            table_name: "events".to_string(),
            renames: vec![DetectedColumnRename {
                before: make_column("old_name"),
                after: make_column("new_name"),
                confidence: 0.85,
            }],
        });

        assert_eq!(
            total_pending_rename_count(&changes.pending_column_renames),
            1
        );
    }

    #[test]
    fn apply_all_pending_converts_to_renamed() {
        let mut changes = empty_changes();
        changes
            .olap_changes
            .push(OlapChange::Table(TableChange::Updated {
                name: "events".to_string(),
                column_changes: vec![
                    ColumnChange::Removed(make_column("old_name")),
                    ColumnChange::Added {
                        column: make_column("new_name"),
                        position_after: None,
                    },
                ],
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

        let pending = vec![PendingTableRenames {
            database: None,
            table_name: "events".to_string(),
            renames: vec![DetectedColumnRename {
                before: make_column("old_name"),
                after: make_column("new_name"),
                confidence: 0.9,
            }],
        }];

        // Before applying: Removed + Added → destructive
        let risk = classify_plan_risk(&changes);
        assert!(risk.is_destructive());

        apply_all_pending_renames(&mut changes, &pending);

        // After applying: Renamed → not destructive
        let risk = classify_plan_risk(&changes);
        assert!(!risk.is_destructive());

        if let OlapChange::Table(TableChange::Updated { column_changes, .. }) =
            &changes.olap_changes[0]
        {
            assert_eq!(column_changes.len(), 1);
            assert!(matches!(
                &column_changes[0],
                ColumnChange::Renamed { before, after, .. }
                    if before.name == "old_name" && after.name == "new_name"
            ));
        } else {
            panic!("Expected TableChange::Updated");
        }
    }

    #[test]
    fn unapplied_pending_rename_stays_destructive() {
        let mut changes = empty_changes();
        changes
            .olap_changes
            .push(OlapChange::Table(TableChange::Updated {
                name: "events".to_string(),
                column_changes: vec![
                    ColumnChange::Removed(make_column("old_name")),
                    ColumnChange::Added {
                        column: make_column("new_name"),
                        position_after: None,
                    },
                ],
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
        changes.pending_column_renames.push(PendingTableRenames {
            database: None,
            table_name: "events".to_string(),
            renames: vec![DetectedColumnRename {
                before: make_column("old_name"),
                after: make_column("new_name"),
                confidence: 0.9,
            }],
        });

        // Without applying the rename, the Removed column is destructive
        let risk = classify_plan_risk(&changes);
        assert!(risk.is_destructive());
    }

    #[test]
    fn exclude_approved_drops_filters_rejected_renames() {
        let mut changes = empty_changes();
        changes
            .olap_changes
            .push(OlapChange::Table(TableChange::Updated {
                name: "events".to_string(),
                column_changes: vec![
                    ColumnChange::Removed(make_column("old_name")),
                    ColumnChange::Added {
                        column: make_column("new_name"),
                        position_after: None,
                    },
                ],
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

        let mut risk = classify_plan_risk(&changes);
        assert!(risk.is_destructive());
        assert_eq!(risk.destructive_changes.len(), 1);

        let approved = HashSet::from([ApprovedColumnDrop {
            database: None,
            table_name: "events".to_string(),
            column_name: "old_name".to_string(),
        }]);
        risk.exclude_approved_drops(&approved);
        assert!(!risk.is_destructive());
    }
}
