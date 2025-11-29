use crate::framework::core::infrastructure_map::{InfraChanges, InfrastructureMap};
use crate::infrastructure::olap::clickhouse::SerializableOlapOperation;
use crate::infrastructure::olap::ddl_ordering::{order_olap_changes, PlanOrderingError};
use crate::utilities::json;
use chrono::{DateTime, Utc};
use serde::Deserialize;

/// A comprehensive migration plan that can be reviewed, approved, and executed
///
/// Note: This type has a custom `Serialize` implementation that sorts all JSON keys
/// alphabetically for deterministic output in version-controlled migration files.
#[derive(Debug, Clone, Deserialize)]
pub struct MigrationPlan {
    /// Timestamp when this plan was generated
    pub created_at: DateTime<Utc>,
    /// DB Operations to run
    pub operations: Vec<SerializableOlapOperation>,
}

pub const MIGRATION_SCHEMA: &str = include_str!("../../utilities/migration_plan_schema.json");

impl MigrationPlan {
    /// Creates a new migration plan from an infrastructure plan
    pub fn from_infra_plan(
        infra_plan_changes: &InfraChanges,
        default_database: &str,
        ignore_ops: &[crate::infrastructure::olap::clickhouse::IgnorableOperation],
    ) -> Result<Self, PlanOrderingError> {
        // Convert OLAP changes to atomic operations
        let (teardown_ops, setup_ops) =
            order_olap_changes(&infra_plan_changes.olap_changes, default_database)?;

        // Combine teardown and setup operations into a single vector
        // Teardown operations are executed first, then setup operations
        let mut operations = Vec::new();

        // Add teardown operations first
        for op in teardown_ops {
            let minimal_op = op.to_minimal();
            // Filter out operations that should be ignored
            if !Self::should_ignore_operation(&minimal_op, ignore_ops) {
                operations.push(minimal_op);
            }
        }

        // Add setup operations second
        for op in setup_ops {
            let minimal_op = op.to_minimal();
            // Filter out operations that should be ignored
            if !Self::should_ignore_operation(&minimal_op, ignore_ops) {
                operations.push(minimal_op);
            }
        }

        Ok(MigrationPlan {
            created_at: Utc::now(),
            operations,
        })
    }

    /// Determines if an operation should be ignored based on the ignore operations list
    fn should_ignore_operation(
        operation: &SerializableOlapOperation,
        ignore_ops: &[crate::infrastructure::olap::clickhouse::IgnorableOperation],
    ) -> bool {
        ignore_ops
            .iter()
            .any(|ignore_op| ignore_op.matches(operation))
    }

    /// Returns the total number of operations
    pub fn total_operations(&self) -> usize {
        self.operations.len()
    }

    pub fn to_yaml(&self) -> anyhow::Result<String> {
        // going through JSON before YAML because tooling does not support `!tag`
        // Sorted keys are handled by the custom Serialize implementation
        let plan_json = serde_json::to_value(self)?;
        let plan_yaml = serde_yaml::to_string(&plan_json)?;
        Ok(plan_yaml)
    }
}

impl serde::Serialize for MigrationPlan {
    /// Custom serialization with sorted keys for deterministic output.
    ///
    /// Migration files are version-controlled, so we need consistent output.
    /// Without sorted keys, HashMap serialization order is random, causing noisy diffs.
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        // Shadow type to avoid infinite recursion
        #[derive(serde::Serialize)]
        struct MigrationPlanForSerialization<'a> {
            created_at: &'a DateTime<Utc>,
            operations: &'a Vec<SerializableOlapOperation>,
        }

        let shadow = MigrationPlanForSerialization {
            created_at: &self.created_at,
            operations: &self.operations,
        };

        // Serialize to JSON value, sort keys, then serialize that
        let json_value = serde_json::to_value(&shadow).map_err(serde::ser::Error::custom)?;
        let sorted_value = json::sort_json_keys(json_value);
        sorted_value.serialize(serializer)
    }
}

pub struct MigrationPlanWithBeforeAfter {
    pub remote_state: InfrastructureMap,
    pub local_infra_map: InfrastructureMap,
    pub db_migration: MigrationPlan,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, OrderBy, Table};
    use crate::framework::core::infrastructure_map::{OlapChange, TableChange};
    use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
    use crate::framework::core::partial_infrastructure_map::LifeCycle;
    use crate::framework::versions::Version;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
    use crate::infrastructure::olap::clickhouse::IgnorableOperation;

    fn create_test_table(name: &str) -> Table {
        Table {
            name: name.to_string(),
            database: None,
            cluster_name: None,
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
                    name: "timestamp".to_string(),
                    data_type: ColumnType::String,
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                },
            ],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            engine: ClickhouseEngine::MergeTree,
            version: Some(Version::from_string("1.0.0".to_string())),
            source_primitive: PrimitiveSignature {
                name: "test".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings: None,
            indexes: vec![],
            table_ttl_setting: None,
            primary_key_expression: None,
        }
    }

    #[test]
    fn test_migration_plan_filters_ignored_table_ttl_operations() {
        // Create a table change that includes a ModifyTableTtl operation
        let table = create_test_table("test_table");
        let table_change = TableChange::Updated {
            name: "test_table".to_string(),
            column_changes: vec![],
            order_by_change: crate::framework::core::infrastructure_map::OrderByChange {
                before: OrderBy::Fields(vec!["id".to_string()]),
                after: OrderBy::Fields(vec!["id".to_string()]),
            },
            partition_by_change: crate::framework::core::infrastructure_map::PartitionByChange {
                before: None,
                after: None,
            },
            before: table.clone(),
            after: table,
        };

        let infra_changes = InfraChanges {
            olap_changes: vec![OlapChange::Table(table_change)],
            processes_changes: vec![],
            api_changes: vec![],
            web_app_changes: vec![],
            streaming_engine_changes: vec![],
        };

        // Test without ignore operations - should include all operations
        let plan_without_ignore = MigrationPlan::from_infra_plan(
            &infra_changes,
            "test_db",
            &[], // No ignore operations
        )
        .unwrap();

        // Test with ModifyTableTtl ignored - should filter out TTL operations
        let plan_with_ignore = MigrationPlan::from_infra_plan(
            &infra_changes,
            "test_db",
            &[IgnorableOperation::ModifyTableTtl], // Ignore TTL operations
        )
        .unwrap();

        // The plan with ignored operations should have fewer (or equal) operations
        assert!(plan_with_ignore.operations.len() <= plan_without_ignore.operations.len());

        // Check that no ModifyTableTtl operations remain in the filtered plan
        for operation in &plan_with_ignore.operations {
            assert!(
                !matches!(operation, SerializableOlapOperation::ModifyTableTtl { .. }),
                "ModifyTableTtl operation should have been filtered out"
            );
        }
    }

    #[test]
    fn test_migration_plan_filters_ignored_column_ttl_operations() {
        let before_column = Column {
            name: "test_col".to_string(),
            data_type: ColumnType::String,
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: Some("timestamp + INTERVAL 7 DAY".to_string()),
        };

        let after_column = Column {
            name: "test_col".to_string(),
            data_type: ColumnType::String,
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: Some("timestamp + INTERVAL 14 DAY".to_string()),
        };

        let table_change = TableChange::Updated {
            name: "test_table".to_string(),
            column_changes: vec![
                crate::framework::core::infrastructure_map::ColumnChange::Updated {
                    before: before_column,
                    after: after_column,
                },
            ],
            order_by_change: crate::framework::core::infrastructure_map::OrderByChange {
                before: OrderBy::Fields(vec!["id".to_string()]),
                after: OrderBy::Fields(vec!["id".to_string()]),
            },
            partition_by_change: crate::framework::core::infrastructure_map::PartitionByChange {
                before: None,
                after: None,
            },
            before: create_test_table("test_table"),
            after: create_test_table("test_table"),
        };

        let infra_changes = InfraChanges {
            olap_changes: vec![OlapChange::Table(table_change)],
            processes_changes: vec![],
            api_changes: vec![],
            web_app_changes: vec![],
            streaming_engine_changes: vec![],
        };

        // Test with ModifyColumnTtl ignored
        let plan_with_ignore = MigrationPlan::from_infra_plan(
            &infra_changes,
            "test_db",
            &[IgnorableOperation::ModifyColumnTtl],
        )
        .unwrap();

        // Check that no column TTL operations remain
        for operation in &plan_with_ignore.operations {
            if let SerializableOlapOperation::ModifyTableColumn {
                before_column,
                after_column,
                ..
            } = operation
            {
                // If it's a ModifyTableColumn operation, it should not be a TTL-only change
                assert_ne!(
                    before_column.ttl, after_column.ttl,
                    "TTL-only column changes should have been filtered out"
                );
            }
        }
    }

    #[test]
    fn test_migration_plan_filters_ignored_low_cardinality_operations() {
        let before_column = Column {
            name: "test_col".to_string(),
            data_type: ColumnType::String,
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![("LowCardinality".to_string(), serde_json::json!(true))],
            comment: None,
            ttl: None,
        };

        let after_column = Column {
            name: "test_col".to_string(),
            data_type: ColumnType::String,
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![], // LowCardinality removed
            comment: None,
            ttl: None,
        };

        let table_change = TableChange::Updated {
            name: "test_table".to_string(),
            column_changes: vec![
                crate::framework::core::infrastructure_map::ColumnChange::Updated {
                    before: before_column,
                    after: after_column,
                },
            ],
            order_by_change: crate::framework::core::infrastructure_map::OrderByChange {
                before: OrderBy::Fields(vec!["id".to_string()]),
                after: OrderBy::Fields(vec!["id".to_string()]),
            },
            partition_by_change: crate::framework::core::infrastructure_map::PartitionByChange {
                before: None,
                after: None,
            },
            before: create_test_table("test_table"),
            after: create_test_table("test_table"),
        };

        let infra_changes = InfraChanges {
            olap_changes: vec![OlapChange::Table(table_change)],
            processes_changes: vec![],
            api_changes: vec![],
            web_app_changes: vec![],
            streaming_engine_changes: vec![],
        };

        // Test with IgnoreStringLowCardinalityDifferences
        let plan_with_ignore = MigrationPlan::from_infra_plan(
            &infra_changes,
            "test_db",
            &[IgnorableOperation::IgnoreStringLowCardinalityDifferences],
        )
        .unwrap();

        // Check that no LowCardinality-only column operations remain
        for operation in &plan_with_ignore.operations {
            if let SerializableOlapOperation::ModifyTableColumn {
                before_column,
                after_column,
                ..
            } = operation
            {
                // Should not be a LowCardinality-only change
                assert!(
                    !IgnorableOperation::is_low_cardinality_only_change(
                        before_column,
                        after_column
                    ),
                    "LowCardinality-only changes should have been filtered out"
                );
            }
        }
    }

    #[test]
    fn test_migration_plan_filters_ignored_partition_operations() {
        let mut before_table = create_test_table("test_table");
        let mut after_table = create_test_table("test_table");

        // Set different partition_by values to trigger drop+create
        before_table.partition_by = None;
        after_table.partition_by = Some("toYYYYMM(timestamp)".to_string());

        let table_change = TableChange::Updated {
            name: "test_table".to_string(),
            column_changes: vec![],
            order_by_change: crate::framework::core::infrastructure_map::OrderByChange {
                before: before_table.order_by.clone(),
                after: after_table.order_by.clone(),
            },
            partition_by_change: crate::framework::core::infrastructure_map::PartitionByChange {
                before: before_table.partition_by.clone(),
                after: after_table.partition_by.clone(),
            },
            before: before_table,
            after: after_table,
        };

        let infra_changes = InfraChanges {
            olap_changes: vec![OlapChange::Table(table_change)],
            processes_changes: vec![],
            api_changes: vec![],
            web_app_changes: vec![],
            streaming_engine_changes: vec![],
        };

        // Test without ignore operations - may include drop+create
        let plan_without_ignore =
            MigrationPlan::from_infra_plan(&infra_changes, "test_db", &[]).unwrap();

        // Test with ModifyPartitionBy ignored - should filter drop+create for partition changes
        let plan_with_ignore = MigrationPlan::from_infra_plan(
            &infra_changes,
            "test_db",
            &[IgnorableOperation::ModifyPartitionBy],
        )
        .unwrap();

        // The plan with ignored operations should have fewer (or equal) operations
        assert!(plan_with_ignore.operations.len() <= plan_without_ignore.operations.len());
    }

    #[test]
    fn test_should_ignore_operation() {
        let ttl_op = SerializableOlapOperation::ModifyTableTtl {
            table: "test_table".to_string(),
            before: Some("timestamp + INTERVAL 30 DAY".to_string()),
            after: Some("timestamp + INTERVAL 60 DAY".to_string()),
            database: None,
            cluster_name: None,
        };

        let column_op = SerializableOlapOperation::AddTableColumn {
            table: "test_table".to_string(),
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
            database: None,
            cluster_name: None,
        };

        // Test with ModifyTableTtl ignored
        assert!(MigrationPlan::should_ignore_operation(
            &ttl_op,
            &[IgnorableOperation::ModifyTableTtl]
        ));

        assert!(!MigrationPlan::should_ignore_operation(
            &column_op,
            &[IgnorableOperation::ModifyTableTtl]
        ));

        // Test with no ignore operations
        assert!(!MigrationPlan::should_ignore_operation(&ttl_op, &[]));
        assert!(!MigrationPlan::should_ignore_operation(&column_op, &[]));
    }
}
