use crate::infrastructure::olap::clickhouse::sql_parser::normalize_sql_for_comparison;
use crate::proto::infrastructure_map::SqlResource as ProtoSqlResource;
use serde::{Deserialize, Serialize};

use super::DataLineage;
use super::InfrastructureSignature;

/// Represents a SQL resource defined within the infrastructure configuration.
///
/// This struct holds information about a SQL resource, including its name,
/// setup and teardown scripts, and its data lineage relationships with other
/// infrastructure components.
#[derive(Debug, Serialize, Deserialize, Clone, Eq)]
pub struct SqlResource {
    /// The unique name identifier for the SQL resource.
    pub name: String,

    /// A list of SQL commands or script paths executed during the setup phase.
    pub setup: Vec<String>,
    /// A list of SQL commands or script paths executed during the teardown phase.
    pub teardown: Vec<String>,

    /// Signatures of infrastructure components from which this SQL resource pulls data.
    #[serde(alias = "pullsDataFrom")]
    pub pulls_data_from: Vec<InfrastructureSignature>,
    /// Signatures of infrastructure components to which this SQL resource pushes data.
    #[serde(alias = "pushesDataTo")]
    pub pushes_data_to: Vec<InfrastructureSignature>,
}

impl SqlResource {
    /// Converts the `SqlResource` struct into its corresponding Protobuf representation.
    pub fn to_proto(&self) -> ProtoSqlResource {
        ProtoSqlResource {
            name: self.name.clone(),
            setup: self.setup.clone(),
            teardown: self.teardown.clone(),
            special_fields: Default::default(),
            pulls_data_from: self.pulls_data_from.iter().map(|s| s.to_proto()).collect(),
            pushes_data_to: self.pushes_data_to.iter().map(|s| s.to_proto()).collect(),
        }
    }

    /// Creates a `SqlResource` struct from its Protobuf representation.
    pub fn from_proto(proto: ProtoSqlResource) -> Self {
        Self {
            name: proto.name,
            setup: proto.setup,
            teardown: proto.teardown,
            pulls_data_from: proto
                .pulls_data_from
                .into_iter()
                .map(InfrastructureSignature::from_proto)
                .collect(),
            pushes_data_to: proto
                .pushes_data_to
                .into_iter()
                .map(InfrastructureSignature::from_proto)
                .collect(),
        }
    }
}

/// Implements the `DataLineage` trait for `SqlResource`.
///
/// This allows querying the data flow relationships of the SQL resource.
impl DataLineage for SqlResource {
    /// Returns the signatures of infrastructure components from which this resource pulls data.
    fn pulls_data_from(&self) -> Vec<InfrastructureSignature> {
        self.pulls_data_from.clone()
    }

    /// Returns the signatures of infrastructure components to which this resource pushes data.
    fn pushes_data_to(&self) -> Vec<InfrastructureSignature> {
        self.pushes_data_to.clone()
    }
}

/// Custom PartialEq implementation that normalizes SQL statements before comparing.
/// This prevents false differences due to cosmetic formatting (whitespace, casing, backticks).
impl PartialEq for SqlResource {
    fn eq(&self, other: &Self) -> bool {
        // Name must match exactly
        if self.name != other.name {
            return false;
        }

        // Data lineage must match exactly
        if self.pulls_data_from != other.pulls_data_from
            || self.pushes_data_to != other.pushes_data_to
        {
            return false;
        }

        // Setup and teardown scripts must match after normalization
        if self.setup.len() != other.setup.len() || self.teardown.len() != other.teardown.len() {
            return false;
        }

        for (self_sql, other_sql) in self.setup.iter().zip(other.setup.iter()) {
            // Pass empty string for default_database since we're comparing already-normalized SQL
            // or SQL from the same database context
            let self_normalized = normalize_sql_for_comparison(self_sql, "");
            let other_normalized = normalize_sql_for_comparison(other_sql, "");
            if self_normalized != other_normalized {
                return false;
            }
        }

        for (self_sql, other_sql) in self.teardown.iter().zip(other.teardown.iter()) {
            let self_normalized = normalize_sql_for_comparison(self_sql, "");
            let other_normalized = normalize_sql_for_comparison(other_sql, "");
            if self_normalized != other_normalized {
                return false;
            }
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_resource(name: &str, setup: Vec<&str>, teardown: Vec<&str>) -> SqlResource {
        SqlResource {
            name: name.to_string(),
            setup: setup.into_iter().map(String::from).collect(),
            teardown: teardown.into_iter().map(String::from).collect(),
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        }
    }

    #[test]
    fn test_sql_resource_equality_exact_match() {
        let resource1 = create_test_resource(
            "TestMV",
            vec!["CREATE MATERIALIZED VIEW TestMV AS SELECT * FROM source"],
            vec!["DROP VIEW IF EXISTS TestMV"],
        );
        let resource2 = create_test_resource(
            "TestMV",
            vec!["CREATE MATERIALIZED VIEW TestMV AS SELECT * FROM source"],
            vec!["DROP VIEW IF EXISTS TestMV"],
        );

        assert_eq!(resource1, resource2);
    }

    #[test]
    fn test_sql_resource_equality_with_backticks() {
        let resource_with_backticks = create_test_resource(
            "TestMV",
            vec!["CREATE VIEW `TestMV` AS SELECT `col1`, `col2` FROM `table`"],
            vec!["DROP VIEW IF EXISTS `TestMV`"],
        );
        let resource_without_backticks = create_test_resource(
            "TestMV",
            vec!["CREATE VIEW TestMV AS SELECT col1, col2 FROM table"],
            vec!["DROP VIEW IF EXISTS TestMV"],
        );

        assert_eq!(resource_with_backticks, resource_without_backticks);
    }

    #[test]
    fn test_sql_resource_equality_with_whitespace_differences() {
        let resource_multiline = create_test_resource(
            "TestMV",
            vec!["CREATE VIEW TestMV\n  AS SELECT\n    col1,\n    col2\n  FROM table"],
            vec!["DROP VIEW IF EXISTS TestMV"],
        );
        let resource_singleline = create_test_resource(
            "TestMV",
            vec!["CREATE VIEW TestMV AS SELECT col1, col2 FROM table"],
            vec!["DROP VIEW IF EXISTS TestMV"],
        );

        assert_eq!(resource_multiline, resource_singleline);
    }

    #[test]
    fn test_sql_resource_equality_with_case_differences() {
        let resource_lowercase = create_test_resource(
            "TestMV",
            vec!["create view TestMV as select count(id) from users"],
            vec!["drop view if exists TestMV"],
        );
        let resource_uppercase = create_test_resource(
            "TestMV",
            vec!["CREATE VIEW TestMV AS SELECT COUNT(id) FROM users"],
            vec!["DROP VIEW IF EXISTS TestMV"],
        );

        assert_eq!(resource_lowercase, resource_uppercase);
    }

    #[test]
    fn test_sql_resource_equality_comprehensive() {
        // User-defined (from TypeScript/Python with backticks and formatting)
        let user_defined = create_test_resource(
            "BarAggregated_MV",
            vec![
                "CREATE MATERIALIZED VIEW IF NOT EXISTS `BarAggregated_MV`\n        TO `BarAggregated`\n        AS SELECT\n    count(`primaryKey`) as totalRows\n  FROM `Bar`"
            ],
            vec!["DROP VIEW IF EXISTS `BarAggregated_MV`"],
        );

        // Introspected from ClickHouse (no backticks, single line, uppercase keywords)
        let introspected = create_test_resource(
            "BarAggregated_MV",
            vec![
                "CREATE MATERIALIZED VIEW IF NOT EXISTS BarAggregated_MV TO BarAggregated AS SELECT COUNT(primaryKey) AS totalRows FROM Bar"
            ],
            vec!["DROP VIEW IF EXISTS `BarAggregated_MV`"],
        );

        assert_eq!(user_defined, introspected);
    }

    #[test]
    fn test_sql_resource_inequality_different_names() {
        let resource1 = create_test_resource(
            "MV1",
            vec!["CREATE VIEW MV1 AS SELECT * FROM source"],
            vec!["DROP VIEW IF EXISTS MV1"],
        );
        let resource2 = create_test_resource(
            "MV2",
            vec!["CREATE VIEW MV2 AS SELECT * FROM source"],
            vec!["DROP VIEW IF EXISTS MV2"],
        );

        assert_ne!(resource1, resource2);
    }

    #[test]
    fn test_sql_resource_inequality_different_sql() {
        let resource1 = create_test_resource(
            "TestMV",
            vec!["CREATE VIEW TestMV AS SELECT col1 FROM table"],
            vec!["DROP VIEW IF EXISTS TestMV"],
        );
        let resource2 = create_test_resource(
            "TestMV",
            vec!["CREATE VIEW TestMV AS SELECT col2 FROM table"],
            vec!["DROP VIEW IF EXISTS TestMV"],
        );

        assert_ne!(resource1, resource2);
    }

    #[test]
    fn test_sql_resource_inequality_different_data_lineage() {
        let mut resource1 = create_test_resource(
            "TestMV",
            vec!["CREATE VIEW TestMV AS SELECT * FROM source"],
            vec!["DROP VIEW IF EXISTS TestMV"],
        );
        resource1.pulls_data_from = vec![InfrastructureSignature::Table {
            id: "Table1".to_string(),
        }];

        let mut resource2 = create_test_resource(
            "TestMV",
            vec!["CREATE VIEW TestMV AS SELECT * FROM source"],
            vec!["DROP VIEW IF EXISTS TestMV"],
        );
        resource2.pulls_data_from = vec![InfrastructureSignature::Table {
            id: "Table2".to_string(),
        }];

        assert_ne!(resource1, resource2);
    }

    #[test]
    fn test_sql_resource_equality_multiple_statements() {
        let resource1 = create_test_resource(
            "TestMV",
            vec![
                "CREATE VIEW TestMV AS SELECT * FROM source",
                "CREATE INDEX idx ON TestMV (col1)",
            ],
            vec!["DROP VIEW IF EXISTS TestMV"],
        );
        let resource2 = create_test_resource(
            "TestMV",
            vec![
                "create view TestMV as select * from source",
                "create index idx on TestMV (col1)",
            ],
            vec!["drop view if exists TestMV"],
        );

        assert_eq!(resource1, resource2);
    }
}
