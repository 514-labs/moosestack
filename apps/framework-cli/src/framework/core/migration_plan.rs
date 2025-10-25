use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure_map::{InfraChanges, InfrastructureMap};
use crate::infrastructure::olap::clickhouse::{IgnorableOperation, SerializableOlapOperation};
use crate::infrastructure::olap::ddl_ordering::{order_olap_changes, PlanOrderingError};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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
            // Keep operation if none of the ignore rules match it
            !ignore_ops.iter().any(|ig| ig.matches(op))
        });
    }
}

pub struct MigrationPlanWithBeforeAfter {
    pub remote_state: InfrastructureMap,
    pub local_infra_map: InfrastructureMap,
    pub db_migration: MigrationPlan,
}

/// Strips fields from a table that correspond to ignored operations
/// This is used during drift detection to ignore differences in fields that the user has configured to ignore
pub fn strip_ignored_fields(table: &Table, ignore_ops: &[IgnorableOperation]) -> Table {
    let mut table = table.clone();

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
    use crate::framework::core::infrastructure::table::{Column, ColumnType, OrderBy};
    use crate::framework::core::infrastructure_map::PrimitiveSignature;
    use crate::framework::core::partial_infrastructure_map::LifeCycle;

    fn create_test_table() -> Table {
        Table {
            name: "test_table".to_string(),
            database: Some("local".to_string()),
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
                    ttl: None,
                },
                Column {
                    name: "expiring_field".to_string(),
                    data_type: ColumnType::String,
                    required: false,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: Some("timestamp + INTERVAL 30 DAY".to_string()),
                },
            ],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            indexes: vec![],
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
            table_settings: None,
            table_ttl_setting: Some("timestamp + INTERVAL 90 DAY".to_string()),
        }
    }

    #[test]
    fn test_filter_modify_table_ttl() {
        let test_table = create_test_table();
        let mut plan = MigrationPlan {
            created_at: Utc::now(),
            operations: vec![
                SerializableOlapOperation::CreateTable {
                    table: test_table.clone(),
                },
                SerializableOlapOperation::ModifyTableTtl {
                    table: "users".to_string(),
                    database: Some("local".to_string()),
                    before: None,
                    after: Some("timestamp + INTERVAL 30 DAY".to_string()),
                },
                SerializableOlapOperation::DropTable {
                    table: "old_users".to_string(),
                    database: Some("local".to_string()),
                },
            ],
        };

        plan.filter_ignored_operations(&[IgnorableOperation::ModifyTableTtl]);

        assert_eq!(plan.operations.len(), 2);
        assert!(matches!(
            plan.operations[0],
            SerializableOlapOperation::CreateTable { .. }
        ));
        assert!(matches!(
            plan.operations[1],
            SerializableOlapOperation::DropTable { .. }
        ));
    }

    #[test]
    fn test_filter_modify_column_ttl() {
        let test_table = create_test_table();
        let mut plan = MigrationPlan {
            created_at: Utc::now(),
            operations: vec![
                SerializableOlapOperation::CreateTable {
                    table: test_table.clone(),
                },
                SerializableOlapOperation::ModifyColumnTtl {
                    table: "users".to_string(),
                    database: Some("local".to_string()),
                    column: "created_at".to_string(),
                    before: None,
                    after: Some("timestamp + INTERVAL 30 DAY".to_string()),
                },
                SerializableOlapOperation::DropTable {
                    table: "old_users".to_string(),
                    database: Some("local".to_string()),
                },
            ],
        };

        plan.filter_ignored_operations(&[IgnorableOperation::ModifyColumnTtl]);

        assert_eq!(plan.operations.len(), 2);
        assert!(matches!(
            plan.operations[0],
            SerializableOlapOperation::CreateTable { .. }
        ));
        assert!(matches!(
            plan.operations[1],
            SerializableOlapOperation::DropTable { .. }
        ));
    }

    #[test]
    fn test_filter_multiple_ignored_operations() {
        let test_table = create_test_table();
        let mut plan = MigrationPlan {
            created_at: Utc::now(),
            operations: vec![
                SerializableOlapOperation::ModifyTableTtl {
                    table: "users".to_string(),
                    database: Some("local".to_string()),
                    before: None,
                    after: Some("ttl1".to_string()),
                },
                SerializableOlapOperation::ModifyColumnTtl {
                    table: "users".to_string(),
                    database: Some("local".to_string()),
                    column: "col".to_string(),
                    before: None,
                    after: Some("ttl2".to_string()),
                },
                SerializableOlapOperation::CreateTable {
                    table: test_table.clone(),
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
    fn test_strip_table_ttl() {
        let table = create_test_table();
        assert!(table.table_ttl_setting.is_some());

        let stripped = strip_ignored_fields(&table, &[IgnorableOperation::ModifyTableTtl]);

        assert!(stripped.table_ttl_setting.is_none());
        assert_eq!(stripped.columns[1].ttl, table.columns[1].ttl); // Column TTL unchanged
    }

    #[test]
    fn test_strip_column_ttl() {
        let table = create_test_table();
        assert!(table.columns[1].ttl.is_some());

        let stripped = strip_ignored_fields(&table, &[IgnorableOperation::ModifyColumnTtl]);

        assert!(stripped.columns[1].ttl.is_none());
        assert_eq!(stripped.table_ttl_setting, table.table_ttl_setting); // Table TTL unchanged
    }

    #[test]
    fn test_strip_both_ttls() {
        let table = create_test_table();

        let stripped = strip_ignored_fields(
            &table,
            &[
                IgnorableOperation::ModifyTableTtl,
                IgnorableOperation::ModifyColumnTtl,
            ],
        );

        assert!(stripped.table_ttl_setting.is_none());
        assert!(stripped.columns[1].ttl.is_none());
    }
}
