use std::fmt;
use std::io::IsTerminal;

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
/// - No destructive changes: returns `Ok(())` immediately.
/// - `accept_destructive` override: logs a warning and proceeds.
/// - Interactive TTY: displays the list and prompts for confirmation.
/// - Non-interactive without override: returns `Err`.
pub fn destructive_confirmation_gate(
    risk: &PlanRisk,
    policy: &ConfirmationPolicy,
) -> Result<(), RoutineFailure> {
    if !risk.is_destructive() {
        return Ok(());
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
        return Ok(());
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

    let input =
        crate::cli::prompt_user("\nProceed with destructive changes? [y/N]", Some("N"), None)?;
    if matches!(input.trim().to_lowercase().as_str(), "y" | "yes") {
        Ok(())
    } else {
        Err(RoutineFailure::error(Message::new(
            "Cancelled".to_string(),
            "Migration aborted by user.".to_string(),
        )))
    }
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
