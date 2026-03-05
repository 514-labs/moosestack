use std::fmt;
use std::io::{stdout, IsTerminal, Write};
use std::time::Duration;

use crossterm::cursor::MoveTo;
use crossterm::event::{Event, EventStream, KeyCode, KeyModifiers};
use crossterm::execute;
use crossterm::style::Print;
use crossterm::terminal::{self, Clear, ClearType};
use futures::StreamExt;

use crate::cli::display::{Message, MessageType};
use crate::cli::routines::RoutineFailure;

use super::infrastructure_map::{Change, ColumnChange, InfraChanges, OlapChange, TableChange};

/// A single destructive operation identified in a migration plan.
#[derive(Debug, Clone)]
pub enum DestructiveChange {
    TableDrop {
        table_name: String,
    },
    ColumnDrop {
        table_name: String,
        column_name: String,
    },
    /// A table that must be dropped and recreated (ORDER BY, PARTITION BY, engine, etc.)
    TableRecreate {
        table_name: String,
        reason: String,
    },
}

impl fmt::Display for DestructiveChange {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DestructiveChange::TableDrop { table_name } => {
                write!(f, "DROP TABLE `{table_name}`")
            }
            DestructiveChange::ColumnDrop {
                table_name,
                column_name,
            } => write!(f, "DROP COLUMN `{column_name}` FROM `{table_name}`"),
            DestructiveChange::TableRecreate { table_name, reason } => {
                write!(f, "DROP + RECREATE `{table_name}` ({reason})")
            }
        }
    }
}

/// Aggregated risk assessment for a migration plan.
#[derive(Debug, Clone)]
pub struct PlanRisk {
    pub destructive_changes: Vec<DestructiveChange>,
}

impl PlanRisk {
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

    // Collect table names that are both removed and added (recreates).
    let removed_table_names: std::collections::HashSet<&str> = changes
        .olap_changes
        .iter()
        .filter_map(|c| match c {
            OlapChange::Table(TableChange::Removed(t)) => Some(t.name.as_str()),
            _ => None,
        })
        .collect();

    let added_table_names: std::collections::HashSet<&str> = changes
        .olap_changes
        .iter()
        .filter_map(|c| match c {
            OlapChange::Table(TableChange::Added(t)) => Some(t.name.as_str()),
            _ => None,
        })
        .collect();

    let recreated_table_names: std::collections::HashSet<&str> = removed_table_names
        .intersection(&added_table_names)
        .copied()
        .collect();

    for change in &changes.olap_changes {
        match change {
            OlapChange::Table(TableChange::Removed(table)) => {
                if recreated_table_names.contains(table.name.as_str()) {
                    destructive_changes.push(DestructiveChange::TableRecreate {
                        table_name: table.name.clone(),
                        reason: "schema change requires drop + recreate".to_string(),
                    });
                } else {
                    destructive_changes.push(DestructiveChange::TableDrop {
                        table_name: table.name.clone(),
                    });
                }
            }
            OlapChange::Table(TableChange::Updated {
                name,
                column_changes,
                ..
            }) => {
                for col_change in column_changes {
                    if let ColumnChange::Removed(col) = col_change {
                        destructive_changes.push(DestructiveChange::ColumnDrop {
                            table_name: name.clone(),
                            column_name: col.name.clone(),
                        });
                    }
                }
            }
            OlapChange::MaterializedView(Change::Removed(mv)) => {
                destructive_changes.push(DestructiveChange::TableDrop {
                    table_name: mv.name.clone(),
                });
            }
            OlapChange::View(Change::Removed(v)) => {
                destructive_changes.push(DestructiveChange::TableDrop {
                    table_name: v.name.clone(),
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

    let accepted = match pinned_prompt(risk.destructive_changes.len()).await {
        Ok(result) => result,
        Err(_) => {
            // Pinned prompt failed (unsupported terminal, etc.) — fall back to sync prompt
            let input = crate::cli::prompt_user(
                "\nProceed with destructive changes? [y/N]",
                Some("N"),
                None,
            )?;
            matches!(input.trim().to_lowercase().as_str(), "y" | "yes")
        }
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

// ---------------------------------------------------------------------------
// Pinned terminal prompt
// ---------------------------------------------------------------------------

const PINNED_PROMPT_LINES: u16 = 3;
const PROMPT_REDRAW_INTERVAL: Duration = Duration::from_millis(500);

/// RAII guard that restores terminal state (raw mode, scroll region) on drop.
struct TerminalGuard {
    original_rows: u16,
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = terminal::disable_raw_mode();
        let _lock = crate::cli::display::terminal_lock::acquire();
        let rows = terminal::size()
            .map(|(_, r)| r)
            .unwrap_or(self.original_rows);
        let start = rows.saturating_sub(PINNED_PROMPT_LINES);
        for row in start..rows {
            let _ = execute!(stdout(), MoveTo(0, row), Clear(ClearType::CurrentLine));
        }
        let _ = write!(stdout(), "\x1b[1;{}r", rows);
        let _ = execute!(stdout(), MoveTo(0, start));
        let _ = stdout().flush();
    }
}

/// Displays a pinned prompt at the bottom of the terminal while log output
/// scrolls above it, and waits for a single-key response.
///
/// Uses an ANSI scroll region to confine normal output to the upper portion
/// of the terminal. The bottom [`PINNED_PROMPT_LINES`] rows are reserved for
/// the prompt and redrawn periodically to stay visible.
///
/// Requires raw mode for key-by-key reading via [`EventStream`]. Returns
/// `true` if the user presses `y`/`Y`, `false` for any other key.
async fn pinned_prompt(change_count: usize) -> std::io::Result<bool> {
    let (_cols, rows) = terminal::size()?;
    let scroll_bottom = rows.saturating_sub(PINNED_PROMPT_LINES + 1);

    {
        let _lock = crate::cli::display::terminal_lock::acquire();
        write!(stdout(), "\x1b[1;{}r", scroll_bottom + 1)?;
        stdout().flush()?;
    }

    terminal::enable_raw_mode()?;
    #[cfg(unix)]
    unsafe {
        let mut termios: libc::termios = std::mem::zeroed();
        if libc::tcgetattr(libc::STDOUT_FILENO, &mut termios) == 0 {
            termios.c_oflag |= libc::OPOST;
            libc::tcsetattr(libc::STDOUT_FILENO, libc::TCSANOW, &termios);
        }
    }
    let _guard = TerminalGuard {
        original_rows: rows,
    };

    draw_pinned_prompt(rows, change_count)?;

    {
        let _lock = crate::cli::display::terminal_lock::acquire();
        execute!(stdout(), MoveTo(0, scroll_bottom))?;
        stdout().flush()?;
    }

    let mut stream = EventStream::new();
    loop {
        tokio::select! {
            event = stream.next() => {
                match event {
                    Some(Ok(Event::Key(key_event))) => {
                        match (key_event.code, key_event.modifiers) {
                            (KeyCode::Char('y' | 'Y'), _) => return Ok(true),
                            (KeyCode::Char('n' | 'N'), _)
                            | (KeyCode::Enter, _)
                            | (KeyCode::Esc, _) => return Ok(false),
                            (KeyCode::Char('c'), m) if m.contains(KeyModifiers::CONTROL) => {
                                return Ok(false);
                            }
                            _ => {}
                        }
                    }
                    Some(Ok(Event::Resize(_new_cols, new_rows))) => {
                        let _lock = crate::cli::display::terminal_lock::acquire();
                        let new_bottom = new_rows.saturating_sub(PINNED_PROMPT_LINES + 1);
                        let _ = write!(stdout(), "\x1b[1;{}r", new_bottom + 1);
                        draw_pinned_prompt(new_rows, change_count)?;
                        let _ = execute!(stdout(), MoveTo(0, new_bottom));
                        stdout().flush()?;
                    }
                    Some(Err(_)) | None => return Ok(false),
                    _ => {}
                }
            }
            _ = tokio::time::sleep(PROMPT_REDRAW_INTERVAL) => {
                let current_rows = terminal::size().map(|(_, r)| r).unwrap_or(rows);
                draw_pinned_prompt(current_rows, change_count)?;
            }
        }
    }
}

/// Draws the prompt in the reserved bottom rows without disturbing the cursor
/// position in the scroll region (saves/restores it around the draw).
///
/// Uses synchronized updates so the entire prompt paints atomically, preventing
/// the spinner (which also redraws on a timer) from tearing through it.
fn draw_pinned_prompt(rows: u16, change_count: usize) -> std::io::Result<()> {
    let start = rows.saturating_sub(PINNED_PROMPT_LINES);

    let prompt_text = format!(
        " \x1b[1;33m⚠\x1b[0m  {} destructive change(s) — press \x1b[1my\x1b[0m to accept, \x1b[1mn\x1b[0m to reject",
        change_count
    );

    let _lock = crate::cli::display::terminal_lock::acquire();
    execute!(
        stdout(),
        crossterm::terminal::BeginSynchronizedUpdate,
        crossterm::cursor::SavePosition,
        MoveTo(0, start),
        Clear(ClearType::CurrentLine),
        Print("\x1b[90m───────────────────────────────────────────────────\x1b[0m"),
        MoveTo(0, start + 1),
        Clear(ClearType::CurrentLine),
        Print(&prompt_text),
        MoveTo(0, start + 2),
        Clear(ClearType::CurrentLine),
        Print(" > "),
        crossterm::cursor::RestorePosition,
        crossterm::terminal::EndSynchronizedUpdate,
    )?;
    stdout().flush()
}

fn format_destructive_summary(risk: &PlanRisk) -> String {
    risk.destructive_changes
        .iter()
        .map(|c| format!("  - {c}"))
        .collect::<Vec<_>>()
        .join("\n")
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
            DestructiveChange::TableDrop { table_name } if table_name == "events"
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
            DestructiveChange::ColumnDrop { table_name, column_name }
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
            DestructiveChange::TableRecreate { table_name, .. } if table_name == "events"
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
}
