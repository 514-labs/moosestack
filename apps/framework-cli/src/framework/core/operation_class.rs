//! Operation classification for hybrid static/dynamic migrations.
//!
//! Classifies OLAP changes into two categories:
//! - **PlanWorthy**: Destructive operations that require human review (drops, removals)
//! - **AutoApply**: Safe operations that can be applied automatically (adds, updates, settings)

use crate::framework::core::infrastructure_map::{
    Change, ColumnChange, InfraChanges, OlapChange, TableChange,
};
use crate::infrastructure::olap::clickhouse::SerializableOlapOperation;

/// Whether an operation requires human review or can be auto-applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationClass {
    /// Destructive operation requiring human review before execution.
    PlanWorthy,
    /// Safe operation that can be applied without review.
    AutoApply,
}

/// Classify a single [`OlapChange`] as plan-worthy or auto-apply.
///
/// Plan-worthy changes are destructive operations:
/// - `TableChange::Removed`
/// - `TableChange::Updated` with any `ColumnChange::Removed`
/// - `MaterializedView(Change::Removed)`
/// - `View(Change::Removed)`
///
/// Everything else is auto-apply.
pub fn classify_olap_change(change: &OlapChange) -> OperationClass {
    match change {
        OlapChange::Table(table_change) => classify_table_change(table_change),
        OlapChange::MaterializedView(Change::Removed(_)) => OperationClass::PlanWorthy,
        OlapChange::View(Change::Removed(_)) => OperationClass::PlanWorthy,
        _ => OperationClass::AutoApply,
    }
}

/// Classify a table change, checking for removals and column removals within updates.
fn classify_table_change(change: &TableChange) -> OperationClass {
    match change {
        TableChange::Removed(_) => OperationClass::PlanWorthy,
        TableChange::Updated { column_changes, .. } => {
            if column_changes
                .iter()
                .any(|c| matches!(c, ColumnChange::Removed(_)))
            {
                OperationClass::PlanWorthy
            } else {
                OperationClass::AutoApply
            }
        }
        _ => OperationClass::AutoApply,
    }
}

/// Classify a [`SerializableOlapOperation`] as plan-worthy or auto-apply.
///
/// Plan-worthy operations:
/// - `DropTable`
/// - `DropTableColumn`
/// - `DropMaterializedView`
/// - `DropView`
/// - `RawSql`
///
/// Everything else is auto-apply.
pub fn classify_serializable_op(op: &SerializableOlapOperation) -> OperationClass {
    match op {
        SerializableOlapOperation::DropTable { .. }
        | SerializableOlapOperation::DropTableColumn { .. }
        | SerializableOlapOperation::DropMaterializedView { .. }
        | SerializableOlapOperation::DropView { .. }
        | SerializableOlapOperation::RawSql { .. } => OperationClass::PlanWorthy,
        _ => OperationClass::AutoApply,
    }
}

/// Partition OLAP changes into (plan_worthy, auto_apply) vectors of references.
pub fn partition_olap_changes(
    infra_changes: &InfraChanges,
) -> (Vec<&OlapChange>, Vec<&OlapChange>) {
    let mut plan_worthy = Vec::new();
    let mut auto_apply = Vec::new();

    for change in &infra_changes.olap_changes {
        match classify_olap_change(change) {
            OperationClass::PlanWorthy => plan_worthy.push(change),
            OperationClass::AutoApply => auto_apply.push(change),
        }
    }

    (plan_worthy, auto_apply)
}

/// Returns `true` if any OLAP change in `infra_changes` is plan-worthy.
pub fn has_plan_worthy_changes(infra_changes: &InfraChanges) -> bool {
    infra_changes
        .olap_changes
        .iter()
        .any(|c| classify_olap_change(c) == OperationClass::PlanWorthy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::materialized_view::MaterializedView;
    use crate::framework::core::infrastructure::select_row_policy::SelectRowPolicy;
    use crate::framework::core::infrastructure::table::{
        Column, ColumnType, OrderBy, Table, TableReference,
    };
    use crate::framework::core::infrastructure::view::{Dmv1View, View, ViewType};
    use crate::framework::core::infrastructure_map::{
        OrderByChange, PartitionByChange, PrimitiveSignature, PrimitiveTypes,
    };
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::framework::versions::Version;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

    // -----------------------------------------------------------------------
    // Test helpers
    // -----------------------------------------------------------------------

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

    fn test_mv(name: &str) -> MaterializedView {
        MaterializedView {
            name: name.to_string(),
            database: None,
            select_sql: "SELECT 1".to_string(),
            source_tables: vec![],
            target_table: "target".to_string(),
            target_database: None,
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
        }
    }

    fn test_view(name: &str) -> View {
        View {
            name: name.to_string(),
            database: None,
            select_sql: "SELECT 1".to_string(),
            source_tables: vec![],
            metadata: None,
        }
    }

    fn empty_infra_changes() -> InfraChanges {
        InfraChanges {
            olap_changes: vec![],
            processes_changes: vec![],
            api_changes: vec![],
            web_app_changes: vec![],
            streaming_engine_changes: vec![],
            workflow_changes: vec![],
            filtered_olap_changes: vec![],
            pending_column_renames: vec![],
        }
    }

    // -----------------------------------------------------------------------
    // classify_olap_change tests
    // -----------------------------------------------------------------------

    #[test]
    fn table_added_is_auto_apply() {
        let change = OlapChange::Table(TableChange::Added(test_table("t1")));
        assert_eq!(classify_olap_change(&change), OperationClass::AutoApply);
    }

    #[test]
    fn table_removed_is_plan_worthy() {
        let change = OlapChange::Table(TableChange::Removed(test_table("t1")));
        assert_eq!(classify_olap_change(&change), OperationClass::PlanWorthy);
    }

    #[test]
    fn table_updated_no_column_removal_is_auto_apply() {
        let change = OlapChange::Table(TableChange::Updated {
            name: "t1".to_string(),
            column_changes: vec![ColumnChange::Added {
                column: test_column("new_col"),
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
            before: test_table("t1"),
            after: test_table("t1"),
        });
        assert_eq!(classify_olap_change(&change), OperationClass::AutoApply);
    }

    #[test]
    fn table_updated_with_column_removal_is_plan_worthy() {
        let change = OlapChange::Table(TableChange::Updated {
            name: "t1".to_string(),
            column_changes: vec![
                ColumnChange::Added {
                    column: test_column("new_col"),
                    position_after: None,
                },
                ColumnChange::Removed(test_column("old_col")),
            ],
            order_by_change: OrderByChange {
                before: OrderBy::Fields(vec![]),
                after: OrderBy::Fields(vec![]),
            },
            partition_by_change: PartitionByChange {
                before: None,
                after: None,
            },
            before: test_table("t1"),
            after: test_table("t1"),
        });
        assert_eq!(classify_olap_change(&change), OperationClass::PlanWorthy);
    }

    #[test]
    fn table_updated_with_only_renames_is_auto_apply() {
        let change = OlapChange::Table(TableChange::Updated {
            name: "t1".to_string(),
            column_changes: vec![ColumnChange::Renamed {
                before: test_column("old_name"),
                after: test_column("new_name"),
                confidence: 0.95,
            }],
            order_by_change: OrderByChange {
                before: OrderBy::Fields(vec![]),
                after: OrderBy::Fields(vec![]),
            },
            partition_by_change: PartitionByChange {
                before: None,
                after: None,
            },
            before: test_table("t1"),
            after: test_table("t1"),
        });
        assert_eq!(classify_olap_change(&change), OperationClass::AutoApply);
    }

    #[test]
    fn table_settings_changed_is_auto_apply() {
        let change = OlapChange::Table(TableChange::SettingsChanged {
            name: "t1".to_string(),
            before_settings: None,
            after_settings: Some(
                [("index_granularity".to_string(), "8192".to_string())]
                    .into_iter()
                    .collect(),
            ),
            table: test_table("t1"),
        });
        assert_eq!(classify_olap_change(&change), OperationClass::AutoApply);
    }

    #[test]
    fn table_ttl_changed_is_auto_apply() {
        let change = OlapChange::Table(TableChange::TtlChanged {
            name: "t1".to_string(),
            before: None,
            after: Some("event_time + INTERVAL 30 DAY".to_string()),
            table: test_table("t1"),
        });
        assert_eq!(classify_olap_change(&change), OperationClass::AutoApply);
    }

    #[test]
    fn materialized_view_added_is_auto_apply() {
        let change = OlapChange::MaterializedView(Change::Added(Box::new(test_mv("mv1"))));
        assert_eq!(classify_olap_change(&change), OperationClass::AutoApply);
    }

    #[test]
    fn materialized_view_removed_is_plan_worthy() {
        let change = OlapChange::MaterializedView(Change::Removed(Box::new(test_mv("mv1"))));
        assert_eq!(classify_olap_change(&change), OperationClass::PlanWorthy);
    }

    #[test]
    fn materialized_view_updated_is_auto_apply() {
        let change = OlapChange::MaterializedView(Change::Updated {
            before: Box::new(test_mv("mv1")),
            after: Box::new(test_mv("mv1")),
        });
        assert_eq!(classify_olap_change(&change), OperationClass::AutoApply);
    }

    #[test]
    fn view_added_is_auto_apply() {
        let change = OlapChange::View(Change::Added(Box::new(test_view("v1"))));
        assert_eq!(classify_olap_change(&change), OperationClass::AutoApply);
    }

    #[test]
    fn view_removed_is_plan_worthy() {
        let change = OlapChange::View(Change::Removed(Box::new(test_view("v1"))));
        assert_eq!(classify_olap_change(&change), OperationClass::PlanWorthy);
    }

    #[test]
    fn view_updated_is_auto_apply() {
        let change = OlapChange::View(Change::Updated {
            before: Box::new(test_view("v1")),
            after: Box::new(test_view("v1")),
        });
        assert_eq!(classify_olap_change(&change), OperationClass::AutoApply);
    }

    #[test]
    fn dmv1_view_changes_are_auto_apply() {
        let dmv = Dmv1View {
            name: "alias_v1".to_string(),
            version: Version::from_string("1.0".to_string()),
            view_type: ViewType::TableAlias {
                source_table_name: "source".to_string(),
            },
        };
        let added = OlapChange::Dmv1View(Change::Added(Box::new(dmv.clone())));
        let removed = OlapChange::Dmv1View(Change::Removed(Box::new(dmv.clone())));
        let updated = OlapChange::Dmv1View(Change::Updated {
            before: Box::new(dmv.clone()),
            after: Box::new(dmv),
        });
        assert_eq!(classify_olap_change(&added), OperationClass::AutoApply);
        assert_eq!(classify_olap_change(&removed), OperationClass::AutoApply);
        assert_eq!(classify_olap_change(&updated), OperationClass::AutoApply);
    }

    #[test]
    fn select_row_policy_changes_are_auto_apply() {
        let policy = SelectRowPolicy {
            name: "rls_org".to_string(),
            tables: vec![TableReference {
                name: "events".to_string(),
                database: None,
            }],
            column: "org_id".to_string(),
            claim: "org_id".to_string(),
        };
        let added = OlapChange::SelectRowPolicy(Change::Added(Box::new(policy.clone())));
        let removed = OlapChange::SelectRowPolicy(Change::Removed(Box::new(policy.clone())));
        assert_eq!(classify_olap_change(&added), OperationClass::AutoApply);
        assert_eq!(classify_olap_change(&removed), OperationClass::AutoApply);
    }

    #[test]
    fn populate_materialized_view_is_auto_apply() {
        let change = OlapChange::PopulateMaterializedView {
            view_name: "mv1".to_string(),
            target_table: "target".to_string(),
            target_database: None,
            select_statement: "SELECT 1".to_string(),
            source_tables: vec![],
            should_truncate: false,
        };
        assert_eq!(classify_olap_change(&change), OperationClass::AutoApply);
    }

    // -----------------------------------------------------------------------
    // classify_serializable_op tests
    // -----------------------------------------------------------------------

    #[test]
    fn create_table_op_is_auto_apply() {
        let op = SerializableOlapOperation::CreateTable {
            table: test_table("t1"),
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::AutoApply);
    }

    #[test]
    fn drop_table_op_is_plan_worthy() {
        let op = SerializableOlapOperation::DropTable {
            table: "t1".to_string(),
            database: None,
            cluster_name: None,
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::PlanWorthy);
    }

    #[test]
    fn add_table_column_op_is_auto_apply() {
        let op = SerializableOlapOperation::AddTableColumn {
            table: "t1".to_string(),
            column: test_column("new_col"),
            after_column: None,
            database: None,
            cluster_name: None,
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::AutoApply);
    }

    #[test]
    fn drop_table_column_op_is_plan_worthy() {
        let op = SerializableOlapOperation::DropTableColumn {
            table: "t1".to_string(),
            column_name: "old_col".to_string(),
            database: None,
            cluster_name: None,
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::PlanWorthy);
    }

    #[test]
    fn modify_table_column_op_is_auto_apply() {
        let op = SerializableOlapOperation::ModifyTableColumn {
            table: "t1".to_string(),
            before_column: test_column("col"),
            after_column: test_column("col"),
            database: None,
            cluster_name: None,
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::AutoApply);
    }

    #[test]
    fn rename_table_column_op_is_auto_apply() {
        let op = SerializableOlapOperation::RenameTableColumn {
            table: "t1".to_string(),
            before_column_name: "old".to_string(),
            after_column_name: "new".to_string(),
            database: None,
            cluster_name: None,
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::AutoApply);
    }

    #[test]
    fn modify_table_settings_op_is_auto_apply() {
        let op = SerializableOlapOperation::ModifyTableSettings {
            table: "t1".to_string(),
            before_settings: None,
            after_settings: None,
            database: None,
            cluster_name: None,
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::AutoApply);
    }

    #[test]
    fn modify_table_ttl_op_is_auto_apply() {
        let op = SerializableOlapOperation::ModifyTableTtl {
            table: "t1".to_string(),
            before: None,
            after: Some("event_time + INTERVAL 30 DAY".to_string()),
            database: None,
            cluster_name: None,
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::AutoApply);
    }

    #[test]
    fn create_materialized_view_op_is_auto_apply() {
        let op = SerializableOlapOperation::CreateMaterializedView {
            name: "mv1".to_string(),
            database: None,
            target_table: "target".to_string(),
            target_database: None,
            select_sql: "SELECT 1".to_string(),
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::AutoApply);
    }

    #[test]
    fn drop_materialized_view_op_is_plan_worthy() {
        let op = SerializableOlapOperation::DropMaterializedView {
            name: "mv1".to_string(),
            database: None,
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::PlanWorthy);
    }

    #[test]
    fn create_view_op_is_auto_apply() {
        let op = SerializableOlapOperation::CreateView {
            name: "v1".to_string(),
            database: None,
            select_sql: "SELECT 1".to_string(),
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::AutoApply);
    }

    #[test]
    fn drop_view_op_is_plan_worthy() {
        let op = SerializableOlapOperation::DropView {
            name: "v1".to_string(),
            database: None,
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::PlanWorthy);
    }

    #[test]
    fn raw_sql_op_is_plan_worthy() {
        let op = SerializableOlapOperation::RawSql {
            sql: vec!["DROP TABLE foo".to_string()],
            description: "dangerous".to_string(),
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::PlanWorthy);
    }

    #[test]
    fn create_row_policy_op_is_auto_apply() {
        let policy = SelectRowPolicy {
            name: "rls".to_string(),
            tables: vec![TableReference {
                name: "events".to_string(),
                database: None,
            }],
            column: "org_id".to_string(),
            claim: "org_id".to_string(),
        };
        let op = SerializableOlapOperation::CreateRowPolicy {
            policy: policy.clone(),
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::AutoApply);

        let op = SerializableOlapOperation::DropRowPolicy { policy };
        assert_eq!(classify_serializable_op(&op), OperationClass::AutoApply);
    }

    #[test]
    fn add_table_index_op_is_auto_apply() {
        let op = SerializableOlapOperation::AddTableIndex {
            table: "t1".to_string(),
            index: crate::framework::core::infrastructure::table::TableIndex {
                name: "idx".to_string(),
                expression: "col".to_string(),
                index_type: "minmax".to_string(),
                arguments: vec![],
                granularity: 1,
            },
            database: None,
            cluster_name: None,
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::AutoApply);
    }

    #[test]
    fn add_table_projection_op_is_auto_apply() {
        let op = SerializableOlapOperation::AddTableProjection {
            table: "t1".to_string(),
            projection: crate::framework::core::infrastructure::table::TableProjection {
                name: "proj".to_string(),
                body: "SELECT col ORDER BY col".to_string(),
            },
            database: None,
            cluster_name: None,
        };
        assert_eq!(classify_serializable_op(&op), OperationClass::AutoApply);
    }

    // -----------------------------------------------------------------------
    // partition_olap_changes tests
    // -----------------------------------------------------------------------

    #[test]
    fn partition_empty_changes() {
        let infra = empty_infra_changes();
        let (plan_worthy, auto_apply) = partition_olap_changes(&infra);
        assert!(plan_worthy.is_empty());
        assert!(auto_apply.is_empty());
    }

    #[test]
    fn partition_mixed_changes() {
        let mut infra = empty_infra_changes();
        infra.olap_changes = vec![
            OlapChange::Table(TableChange::Added(test_table("t_new"))),
            OlapChange::Table(TableChange::Removed(test_table("t_old"))),
            OlapChange::MaterializedView(Change::Added(Box::new(test_mv("mv_new")))),
            OlapChange::MaterializedView(Change::Removed(Box::new(test_mv("mv_old")))),
            OlapChange::View(Change::Added(Box::new(test_view("v_new")))),
            OlapChange::View(Change::Removed(Box::new(test_view("v_old")))),
        ];
        let (plan_worthy, auto_apply) = partition_olap_changes(&infra);
        assert_eq!(plan_worthy.len(), 3); // table removed, mv removed, view removed
        assert_eq!(auto_apply.len(), 3); // table added, mv added, view added
    }

    #[test]
    fn partition_all_auto_apply() {
        let mut infra = empty_infra_changes();
        infra.olap_changes = vec![
            OlapChange::Table(TableChange::Added(test_table("t1"))),
            OlapChange::MaterializedView(Change::Added(Box::new(test_mv("mv1")))),
            OlapChange::View(Change::Added(Box::new(test_view("v1")))),
        ];
        let (plan_worthy, auto_apply) = partition_olap_changes(&infra);
        assert!(plan_worthy.is_empty());
        assert_eq!(auto_apply.len(), 3);
    }

    // -----------------------------------------------------------------------
    // has_plan_worthy_changes tests
    // -----------------------------------------------------------------------

    #[test]
    fn no_changes_means_no_plan_worthy() {
        let infra = empty_infra_changes();
        assert!(!has_plan_worthy_changes(&infra));
    }

    #[test]
    fn only_adds_means_no_plan_worthy() {
        let mut infra = empty_infra_changes();
        infra.olap_changes = vec![OlapChange::Table(TableChange::Added(test_table("t1")))];
        assert!(!has_plan_worthy_changes(&infra));
    }

    #[test]
    fn removal_means_plan_worthy() {
        let mut infra = empty_infra_changes();
        infra.olap_changes = vec![OlapChange::Table(TableChange::Removed(test_table("t1")))];
        assert!(has_plan_worthy_changes(&infra));
    }

    #[test]
    fn mv_removal_means_plan_worthy() {
        let mut infra = empty_infra_changes();
        infra.olap_changes = vec![OlapChange::MaterializedView(Change::Removed(Box::new(
            test_mv("mv1"),
        )))];
        assert!(has_plan_worthy_changes(&infra));
    }

    #[test]
    fn view_removal_means_plan_worthy() {
        let mut infra = empty_infra_changes();
        infra.olap_changes = vec![OlapChange::View(Change::Removed(Box::new(test_view("v1"))))];
        assert!(has_plan_worthy_changes(&infra));
    }

    #[test]
    fn column_removal_in_update_means_plan_worthy() {
        let mut infra = empty_infra_changes();
        infra.olap_changes = vec![OlapChange::Table(TableChange::Updated {
            name: "t1".to_string(),
            column_changes: vec![ColumnChange::Removed(test_column("dropped_col"))],
            order_by_change: OrderByChange {
                before: OrderBy::Fields(vec![]),
                after: OrderBy::Fields(vec![]),
            },
            partition_by_change: PartitionByChange {
                before: None,
                after: None,
            },
            before: test_table("t1"),
            after: test_table("t1"),
        })];
        assert!(has_plan_worthy_changes(&infra));
    }
}
