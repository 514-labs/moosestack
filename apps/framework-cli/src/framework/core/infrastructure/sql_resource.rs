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

    /// The database where this SQL resource exists.
    /// - None means use the default database
    /// - Some(db) means the resource is in a specific database
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub database: Option<String>,

    /// Optional source file path where this SQL resource is defined
    #[serde(skip_serializing_if = "Option::is_none", default, alias = "sourceFile")]
    pub source_file: Option<String>,

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
    /// Returns a unique identifier for this SQL resource.
    ///
    /// The ID format matches the table ID format: `{database}_{name}`
    /// This ensures resources in different databases don't collide.
    ///
    /// # Arguments
    /// * `default_database` - The default database name to use when `database` is None
    ///
    /// # Returns
    /// A string in the format `{database}_{name}`
    pub fn id(&self, default_database: &str) -> String {
        let db = self.database.as_deref().unwrap_or(default_database);
        format!("{}_{}", db, self.name)
    }

    /// Converts the `SqlResource` struct into its corresponding Protobuf representation.
    pub fn to_proto(&self) -> ProtoSqlResource {
        ProtoSqlResource {
            name: self.name.clone(),
            database: self.database.clone(),
            source_file: self.source_file.clone().unwrap_or_default(),
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
            database: proto.database,
            source_file: if proto.source_file.is_empty() {
                None
            } else {
                Some(proto.source_file)
            },
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

        // Database comparison: treat None as equivalent to any explicit database
        // This allows resources from user code (database=None) to match introspected
        // resources (database=Some("local")), since both resolve to the same ID
        // We don't compare database here because the HashMap key already includes it

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
            // Pass empty string for default_database since the comparison happens after HashMap
            // lookup by ID (which includes database prefix). Both SQL statements are from the
            // same database context, so we only need AST-based normalization (backticks, casing,
            // whitespace) without database prefix stripping. User-defined SQL typically doesn't
            // include explicit database prefixes (e.g., "FROM local.Table").
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
            database: None,
            source_file: None,
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

    #[test]
    fn test_sql_resource_id_with_database() {
        // Test with explicit database
        let resource_with_db = SqlResource {
            name: "MyView".to_string(),
            database: Some("custom".to_string()),
            source_file: None,
            setup: vec![],
            teardown: vec![],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };
        assert_eq!(resource_with_db.id("default"), "custom_MyView");

        // Test with None database (uses default)
        let resource_no_db = SqlResource {
            name: "MyView".to_string(),
            database: None,
            source_file: None,
            setup: vec![],
            teardown: vec![],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };
        assert_eq!(resource_no_db.id("default"), "default_MyView");
    }

    #[test]
    fn test_sql_resource_equality_ignores_database_field() {
        // Resources with different database fields should be equal if they have the same name
        // This is because the HashMap key already includes the database, so we don't need to
        // compare it during equality checks
        let resource_no_db = SqlResource {
            name: "MyView".to_string(),
            database: None,
            source_file: None,
            setup: vec!["CREATE VIEW MyView AS SELECT * FROM table1".to_string()],
            teardown: vec!["DROP VIEW IF EXISTS MyView".to_string()],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };

        let resource_with_db = SqlResource {
            name: "MyView".to_string(),
            database: Some("local".to_string()),
            source_file: None,
            setup: vec!["CREATE VIEW MyView AS SELECT * FROM table1".to_string()],
            teardown: vec!["DROP VIEW IF EXISTS MyView".to_string()],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };

        // These should be equal because database is not compared in PartialEq
        assert_eq!(resource_no_db, resource_with_db);
    }

    #[test]
    fn test_sql_resource_equality_with_normalized_sql() {
        // Test that SQL normalization handles whitespace and formatting differences
        let resource_formatted = SqlResource {
            name: "TestView".to_string(),
            database: None,
            source_file: None,
            setup: vec![
                "CREATE VIEW IF NOT EXISTS TestView \n          AS SELECT\n    `primaryKey`,\n    `utcTimestamp`,\n    `textLength`\n  FROM `Bar`\n  WHERE `hasText` = true".to_string()
            ],
            teardown: vec!["DROP VIEW IF EXISTS `TestView`".to_string()],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };

        let resource_compact = SqlResource {
            name: "TestView".to_string(),
            database: None,
            source_file: None,
            setup: vec![
                "CREATE VIEW IF NOT EXISTS TestView AS SELECT primaryKey, utcTimestamp, textLength FROM Bar WHERE hasText = true".to_string()
            ],
            teardown: vec!["DROP VIEW IF EXISTS `TestView`".to_string()],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };

        // These should be equal after SQL normalization
        assert_eq!(resource_formatted, resource_compact);
    }
}
