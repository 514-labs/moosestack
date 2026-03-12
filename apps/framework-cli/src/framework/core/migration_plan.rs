use crate::framework::core::infrastructure_map::{InfraChanges, InfrastructureMap};
use crate::infrastructure::olap::clickhouse::SerializableOlapOperation;
use crate::infrastructure::olap::ddl_ordering::PlanOrderingError;
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
    ) -> Result<Self, PlanOrderingError> {
        let operations = crate::framework::core::plan::infra_changes_to_operations(
            infra_plan_changes,
            default_database,
        )?;

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
        // going through JSON before YAML because tooling does not support `!tag`
        // Sorted keys are handled by the custom Serialize implementation
        let plan_json = serde_json::to_value(self)?;
        // We must explicitly convert rather than using serde_yaml::to_string(&json_value)
        // because arbitrary precision numbers in serde_json becomes `$serde_json::private::Number: '42'`
        let plan_yaml = serde_yaml::to_string(&json::json_value_to_yaml(&plan_json))?;
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
    use crate::framework::core::infrastructure::table::TableIndex;

    #[test]
    fn test_to_yaml_does_not_leak_serde_json_private_number() {
        let plan = MigrationPlan {
            created_at: DateTime::parse_from_rfc3339("2025-01-15T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            operations: vec![SerializableOlapOperation::AddTableIndex {
                table: "events".to_string(),
                index: TableIndex {
                    name: "idx_timestamp".to_string(),
                    expression: "timestamp".to_string(),
                    index_type: "minmax".to_string(),
                    arguments: vec![],
                    granularity: 3,
                },
                database: None,
                cluster_name: None,
            }],
        };

        let yaml = plan.to_yaml().unwrap();

        assert!(
            !yaml.contains("serde_json::private"),
            "YAML output leaked serde_json internal representation:\n{yaml}"
        );
        assert!(
            yaml.contains("granularity: 3"),
            "Expected `granularity: 3` in YAML output:\n{yaml}"
        );
    }
}
