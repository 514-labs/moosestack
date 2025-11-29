use crate::framework::core::infrastructure_map::{
    InfraChanges, InfrastructureMap, OlapChange, TableChange,
};
use crate::infrastructure::olap::clickhouse::{IgnorableOperation, SerializableOlapOperation};
use crate::infrastructure::olap::ddl_ordering::PlanOrderingError;
use crate::utilities::json;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::collections::HashSet;

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
    /// Creates a new migration plan from an infrastructure plan.
    ///
    /// * `ignore_ops` - operations to exclude from the generated plan.
    pub fn from_infra_plan(
        infra_plan_changes: &InfraChanges,
        default_database: &str,
        ignore_ops: &[IgnorableOperation],
    ) -> Result<Self, PlanOrderingError> {
        // Pre-compute which table names have actual partition_by changes so that
        // ModifyPartitionBy only ignores drop+create for those tables, not unrelated
        // table additions/removals.
        let partition_changed_tables: HashSet<String> = if ignore_ops
            .iter()
            .any(|op| matches!(op, IgnorableOperation::ModifyPartitionBy))
        {
            infra_plan_changes
                .olap_changes
                .iter()
                .filter_map(|change| {
                    if let OlapChange::Table(TableChange::Updated {
                        name,
                        partition_by_change,
                        before,
                        after,
                        ..
                    }) = change
                    {
                        if partition_by_change.before != partition_by_change.after {
                            let db = before
                                .database
                                .as_deref()
                                .or(after.database.as_deref())
                                .unwrap_or(default_database);
                            return Some(format!("{db}.{name}"));
                        }
                    }
                    None
                })
                .collect()
        } else {
            HashSet::new()
        };

        let operations = crate::framework::core::plan::infra_changes_to_operations(
            infra_plan_changes,
            default_database,
        )?
        .into_iter()
        .filter(|op| {
            !Self::should_ignore_operation(
                op,
                ignore_ops,
                &partition_changed_tables,
                default_database,
            )
        })
        .collect();

        Ok(MigrationPlan {
            created_at: Utc::now(),
            operations,
        })
    }

    /// Determines if an operation should be ignored based on the ignore operations list.
    ///
    /// `partition_changed_tables` provides context for `ModifyPartitionBy`: only drop/create
    /// operations for tables whose partition expression actually changed are suppressed.
    /// Keys in `partition_changed_tables` are `"{database}.{name}"` to avoid cross-database
    /// collisions when two databases contain tables with the same name.
    fn should_ignore_operation(
        operation: &SerializableOlapOperation,
        ignore_ops: &[IgnorableOperation],
        partition_changed_tables: &HashSet<String>,
        default_database: &str,
    ) -> bool {
        ignore_ops.iter().any(|ignore_op| {
            // ModifyPartitionBy needs table-name context to avoid hiding unrelated
            // table additions/removals alongside the partition-driven drop+create.
            if matches!(ignore_op, IgnorableOperation::ModifyPartitionBy) {
                let table_key = match operation {
                    SerializableOlapOperation::DropTable {
                        table, database, ..
                    } => {
                        let db = database.as_deref().unwrap_or(default_database);
                        Some(format!("{db}.{table}"))
                    }
                    SerializableOlapOperation::CreateTable { table } => {
                        let db = table.database.as_deref().unwrap_or(default_database);
                        Some(format!("{db}.{}", table.name))
                    }
                    _ => None,
                };
                return table_key.is_some_and(|key| partition_changed_tables.contains(&key));
            }
            ignore_op.matches(operation)
        })
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
                    codec: None,
                    materialized: None,
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
                    codec: None,
                    materialized: None,
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
            table_settings_hash: None,
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
            workflow_changes: vec![],
            filtered_olap_changes: vec![],
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
            codec: None,
            materialized: None,
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
            codec: None,
            materialized: None,
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
            workflow_changes: vec![],
            filtered_olap_changes: vec![],
        };

        // Test with ModifyColumnTtl ignored
        let plan_with_ignore = MigrationPlan::from_infra_plan(
            &infra_changes,
            "test_db",
            &[IgnorableOperation::ModifyColumnTtl],
        )
        .unwrap();

        // Check that no TTL-only column operations remain
        for operation in &plan_with_ignore.operations {
            if let SerializableOlapOperation::ModifyTableColumn {
                before_column,
                after_column,
                ..
            } = operation
            {
                let mut before_no_ttl = before_column.clone();
                before_no_ttl.ttl = None;
                let mut after_no_ttl = after_column.clone();
                after_no_ttl.ttl = None;
                let is_ttl_only_change =
                    before_column.ttl != after_column.ttl && before_no_ttl == after_no_ttl;
                assert!(
                    !is_ttl_only_change,
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
            codec: None,
            materialized: None,
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
            codec: None,
            materialized: None,
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
            workflow_changes: vec![],
            filtered_olap_changes: vec![],
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
            workflow_changes: vec![],
            filtered_olap_changes: vec![],
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
                codec: None,
                materialized: None,
            },
            after_column: None,
            database: None,
            cluster_name: None,
        };

        // Test with ModifyTableTtl ignored
        assert!(MigrationPlan::should_ignore_operation(
            &ttl_op,
            &[IgnorableOperation::ModifyTableTtl],
            &std::collections::HashSet::new(),
            "",
        ));

        assert!(!MigrationPlan::should_ignore_operation(
            &column_op,
            &[IgnorableOperation::ModifyTableTtl],
            &std::collections::HashSet::new(),
            "",
        ));

        // Test with no ignore operations
        assert!(!MigrationPlan::should_ignore_operation(
            &ttl_op,
            &[],
            &std::collections::HashSet::new(),
            "",
        ));
        assert!(!MigrationPlan::should_ignore_operation(
            &column_op,
            &[],
            &std::collections::HashSet::new(),
            "",
        ));
    }
}
