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
    pub fn from_infra_plan(
        infra_plan_changes: &InfraChanges,
        default_database: &str,
    ) -> Result<Self, PlanOrderingError> {
        // Convert OLAP changes to atomic operations
        let (teardown_ops, setup_ops) =
            order_olap_changes(&infra_plan_changes.olap_changes, default_database)?;

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

    if ignore_ops.contains(&IgnorableOperation::ModifyPartitionBy) {
        table.partition_by = None;
    }

    table
}
