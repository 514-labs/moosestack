use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure_map::{InfraChanges, InfrastructureMap};
use crate::infrastructure::olap::clickhouse::SerializableOlapOperation;
use crate::infrastructure::olap::ddl_ordering::{order_olap_changes, PlanOrderingError};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Operations that can be ignored during migration plan generation
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum IgnorableOperation {
    AddTableIndex,
    ModifyTableTtl,
    ModifyColumnTtl,
}

/// A comprehensive migration plan that can be reviewed, approved, and executed
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationPlan {
    /// Timestamp when this plan was generated
    pub created_at: DateTime<Utc>,
    /// DB Operations to run
    pub operations: Vec<SerializableOlapOperation>,
}

pub const MIGRATION_SCHEMA: &str = include_str!("../../utilities/migration_plan_schema.json");

impl MigrationPlan {
    /// Creates a new migration plan from an infrastructure plan
    pub fn from_infra_plan(infra_plan_changes: &InfraChanges) -> Result<Self, PlanOrderingError> {
        // Convert OLAP changes to atomic operations
        let (teardown_ops, setup_ops) = order_olap_changes(&infra_plan_changes.olap_changes)?;

        // Combine teardown and setup operations into a single vector
        // Teardown operations are executed first, then setup operations
        let mut operations = Vec::new();

        // Add teardown operations first
        for op in teardown_ops {
            operations.push(op.to_minimal());
        }

        // Add setup operations second
        for op in setup_ops {
            operations.push(op.to_minimal());
        }

        Ok(MigrationPlan {
            created_at: Utc::now(),
            operations,
        })
    }

    /// Returns the total number of operations
    pub fn total_operations(&self) -> usize {
        self.operations.len()
    }

    pub fn to_yaml(&self) -> anyhow::Result<String> {
        let plan_json = serde_json::to_value(self)?;
        // going through JSON before YAML because tooling does not support `!tag`
        let plan_yaml = serde_yaml::to_string(&plan_json)?;
        Ok(plan_yaml)
    }

    /// Filter out operations that should be ignored based on config
    pub fn filter_ignored_operations(&mut self, ignore_ops: &[IgnorableOperation]) {
        if ignore_ops.is_empty() {
            return;
        }

        self.operations.retain(|op| {
            let ignorable = match op {
                SerializableOlapOperation::AddTableIndex { .. } => {
                    Some(IgnorableOperation::AddTableIndex)
                }
                SerializableOlapOperation::ModifyTableTtl { .. } => {
                    Some(IgnorableOperation::ModifyTableTtl)
                }
                SerializableOlapOperation::ModifyColumnTtl { .. } => {
                    Some(IgnorableOperation::ModifyColumnTtl)
                }
                _ => None,
            };

            // Keep operation if it's not ignorable or not in the ignore list
            ignorable.is_none_or(|ig| !ignore_ops.contains(&ig))
        });
    }
}

pub struct MigrationPlanWithBeforeAfter {
    pub remote_state: InfrastructureMap,
    pub local_infra_map: InfrastructureMap,
    pub db_migration: MigrationPlan,
}

/// Strips ignored fields from a table for comparison (used in drift detection)
///
/// This removes fields that correspond to ignored operations, so that drift
/// detection doesn't fail when those changes exist in the database.
pub fn strip_ignored_fields(table: &Table, ignore_ops: &[IgnorableOperation]) -> Table {
    let mut table = table.clone();

    if ignore_ops.contains(&IgnorableOperation::AddTableIndex) {
        table.indexes = vec![];
    }

    if ignore_ops.contains(&IgnorableOperation::ModifyTableTtl) {
        table.table_ttl_setting = None;
    }

    if ignore_ops.contains(&IgnorableOperation::ModifyColumnTtl) {
        for col in &mut table.columns {
            col.ttl = None;
        }
    }

    table
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, OrderBy, TableIndex};
    use crate::framework::core::infrastructure_map::PrimitiveSignature;
    use crate::framework::core::partial_infrastructure_map::LifeCycle;

    fn create_test_table() -> Table {
        Table {
            name: "test_table".to_string(),
            columns: vec![
                Column {
                    name: "id".to_string(),
                    data_type: ColumnType::String,
                    required: true,
                    unique: false,
                    primary_key: true,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: Some("id + INTERVAL 30 DAY".to_string()),
                },
                Column {
                    name: "data".to_string(),
                    data_type: ColumnType::String,
                    required: false,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: Some("data + INTERVAL 60 DAY".to_string()),
                },
            ],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            indexes: vec![TableIndex {
                name: "test_index".to_string(),
                expression: "data".to_string(),
                index_type: "bloom_filter".to_string(),
                arguments: vec![],
                granularity: 1,
            }],
            version: None,
            source_primitive: PrimitiveSignature {
                name: "test_table".to_string(),
                primitive_type:
                    crate::framework::core::infrastructure_map::PrimitiveTypes::DataModel,
            },
            engine: None,
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: Some(std::collections::HashMap::from([(
                "index_granularity".to_string(),
                "8192".to_string(),
            )])),
            table_ttl_setting: Some("created_at + INTERVAL 90 DAY".to_string()),
        }
    }

    // Category 1: strip_ignored_fields tests

    #[test]
    fn test_strip_table_ttl_when_modify_table_ttl_ignored() {
        let table = create_test_table();
        let ignore_ops = vec![IgnorableOperation::ModifyTableTtl];

        let result = strip_ignored_fields(&table, &ignore_ops);

        assert!(result.table_ttl_setting.is_none());
        assert_eq!(result.indexes.len(), 1); // Other fields preserved
        assert!(result.columns[0].ttl.is_some()); // Column TTL still there
    }

    #[test]
    fn test_strip_column_ttl_when_modify_column_ttl_ignored() {
        let table = create_test_table();
        let ignore_ops = vec![IgnorableOperation::ModifyColumnTtl];

        let result = strip_ignored_fields(&table, &ignore_ops);

        assert!(result.columns[0].ttl.is_none());
        assert!(result.columns[1].ttl.is_none());
        assert!(result.table_ttl_setting.is_some()); // Table TTL still there
        assert_eq!(result.indexes.len(), 1); // Other fields preserved
    }

    #[test]
    fn test_strip_nothing_when_ignore_list_empty() {
        let table = create_test_table();
        let ignore_ops = vec![];

        let result = strip_ignored_fields(&table, &ignore_ops);

        assert_eq!(result.indexes.len(), 1);
        assert!(result.table_ttl_setting.is_some());
        assert!(result.columns[0].ttl.is_some());
        assert!(result.columns[1].ttl.is_some());
    }

    #[test]
    fn test_strip_both_ttl_types_at_once() {
        let table = create_test_table();
        let ignore_ops = vec![
            IgnorableOperation::ModifyTableTtl,
            IgnorableOperation::ModifyColumnTtl,
        ];

        let result = strip_ignored_fields(&table, &ignore_ops);

        assert!(result.table_ttl_setting.is_none());
        assert!(result.columns[0].ttl.is_none());
        assert!(result.columns[1].ttl.is_none());
        // But other fields are preserved
        assert_eq!(result.columns.len(), 2);
        assert_eq!(result.indexes.len(), 1);
        assert_eq!(result.name, "test_table");
    }

    // Category 2: filter_ignored_operations tests

    #[test]
    fn test_filter_modify_table_ttl_operations() {
        let mut plan = MigrationPlan {
            created_at: chrono::Utc::now(),
            operations: vec![
                SerializableOlapOperation::ModifyTableTtl {
                    table: "test".to_string(),
                    before: None,
                    after: Some("created_at + INTERVAL 30 DAY".to_string()),
                },
                SerializableOlapOperation::CreateTable {
                    table: create_test_table(),
                },
            ],
        };

        plan.filter_ignored_operations(&[IgnorableOperation::ModifyTableTtl]);

        assert_eq!(plan.operations.len(), 1);
        assert!(matches!(
            plan.operations[0],
            SerializableOlapOperation::CreateTable { .. }
        ));
    }

    #[test]
    fn test_filter_modify_column_ttl_operations() {
        let mut plan = MigrationPlan {
            created_at: chrono::Utc::now(),
            operations: vec![
                SerializableOlapOperation::ModifyColumnTtl {
                    table: "test".to_string(),
                    column: "col1".to_string(),
                    before: None,
                    after: Some("col1 + INTERVAL 30 DAY".to_string()),
                },
                SerializableOlapOperation::CreateTable {
                    table: create_test_table(),
                },
            ],
        };

        plan.filter_ignored_operations(&[IgnorableOperation::ModifyColumnTtl]);

        assert_eq!(plan.operations.len(), 1);
        assert!(matches!(
            plan.operations[0],
            SerializableOlapOperation::CreateTable { .. }
        ));
    }

    #[test]
    fn test_filter_both_ttl_operation_types() {
        let mut plan = MigrationPlan {
            created_at: chrono::Utc::now(),
            operations: vec![
                SerializableOlapOperation::ModifyTableTtl {
                    table: "test".to_string(),
                    before: None,
                    after: Some("created_at + INTERVAL 30 DAY".to_string()),
                },
                SerializableOlapOperation::ModifyColumnTtl {
                    table: "test".to_string(),
                    column: "col1".to_string(),
                    before: None,
                    after: Some("col1 + INTERVAL 60 DAY".to_string()),
                },
                SerializableOlapOperation::CreateTable {
                    table: create_test_table(),
                },
            ],
        };

        plan.filter_ignored_operations(&[
            IgnorableOperation::ModifyTableTtl,
            IgnorableOperation::ModifyColumnTtl,
        ]);

        assert_eq!(plan.operations.len(), 1);
        assert!(matches!(
            plan.operations[0],
            SerializableOlapOperation::CreateTable { .. }
        ));
    }

    #[test]
    fn test_filter_nothing_when_ignore_list_empty() {
        let mut plan = MigrationPlan {
            created_at: chrono::Utc::now(),
            operations: vec![
                SerializableOlapOperation::ModifyTableTtl {
                    table: "test".to_string(),
                    before: None,
                    after: Some("created_at + INTERVAL 30 DAY".to_string()),
                },
                SerializableOlapOperation::CreateTable {
                    table: create_test_table(),
                },
            ],
        };

        plan.filter_ignored_operations(&[]);

        assert_eq!(plan.operations.len(), 2);
    }

    #[test]
    fn test_keep_non_ttl_operations() {
        let mut plan = MigrationPlan {
            created_at: chrono::Utc::now(),
            operations: vec![
                SerializableOlapOperation::ModifyTableTtl {
                    table: "test".to_string(),
                    before: None,
                    after: Some("created_at + INTERVAL 30 DAY".to_string()),
                },
                SerializableOlapOperation::AddTableColumn {
                    table: "test".to_string(),
                    column: Column {
                        name: "new_col".to_string(),
                        data_type: ColumnType::String,
                        required: false,
                        unique: false,
                        primary_key: false,
                        default: None,
                        annotations: vec![],
                        comment: None,
                        ttl: None,
                    },
                    after_column: None,
                },
            ],
        };

        plan.filter_ignored_operations(&[IgnorableOperation::ModifyTableTtl]);

        assert_eq!(plan.operations.len(), 1);
        assert!(matches!(
            plan.operations[0],
            SerializableOlapOperation::AddTableColumn { .. }
        ));
    }
}
