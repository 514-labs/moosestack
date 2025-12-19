//! Materialized View infrastructure component.
//!
//! This module provides a structured representation of ClickHouse Materialized Views,
//! replacing the opaque SQL strings previously stored in `SqlResource`.
//!
//! A MaterializedView consists of:
//! - A SELECT query that defines the transformation
//! - Source tables/views that the SELECT reads from
//! - A target table where data is written
//!
//! This structured representation allows for:
//! - Better schema introspection
//! - More accurate change detection
//! - Clearer dependency tracking

use protobuf::MessageField;
use serde::{Deserialize, Serialize};

use crate::proto::infrastructure_map::{
    MaterializedView as ProtoMaterializedView, SelectQuery as ProtoSelectQuery,
    TableReference as ProtoTableReference,
};

use super::table::Metadata;
use super::{DataLineage, InfrastructureSignature};

/// Reference to a table, optionally qualified with database.
/// Used internally for proto conversion and dependency tracking.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TableReference {
    /// Database name (None means use default database)
    pub database: Option<String>,
    /// Table name
    pub table: String,
}

impl TableReference {
    /// Create a new table reference without database qualification
    pub fn new(table: impl Into<String>) -> Self {
        Self {
            database: None,
            table: table.into(),
        }
    }

    /// Create a new table reference with database qualification
    pub fn with_database(database: impl Into<String>, table: impl Into<String>) -> Self {
        Self {
            database: Some(database.into()),
            table: table.into(),
        }
    }

    /// Returns the fully qualified name (database.table or just table)
    pub fn qualified_name(&self) -> String {
        match &self.database {
            Some(db) => format!("{}.{}", db, self.table),
            None => self.table.clone(),
        }
    }

    /// Returns the quoted identifier for use in SQL
    pub fn quoted(&self) -> String {
        match &self.database {
            Some(db) => format!("`{}`.`{}`", db, self.table),
            None => format!("`{}`", self.table),
        }
    }

    /// Convert to proto representation
    pub fn to_proto(&self) -> ProtoTableReference {
        ProtoTableReference {
            database: self.database.clone(),
            table: self.table.clone(),
            special_fields: Default::default(),
        }
    }

    /// Create from proto representation
    pub fn from_proto(proto: ProtoTableReference) -> Self {
        Self {
            database: proto.database,
            table: proto.table,
        }
    }
}

/// Represents a ClickHouse Materialized View.
///
/// A MaterializedView is a special view that:
/// 1. Runs a SELECT query whenever data is inserted into source tables
/// 2. Writes the transformed results to a target table
///
/// Unlike regular views, MVs persist data and can significantly speed up
/// queries at the cost of storage and insert-time computation.
///
/// The structure is flat to match JSON output from TypeScript/Python moose-lib.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializedView {
    /// Name of the materialized view
    pub name: String,

    /// Database where the MV is created (None = default database)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub database: Option<String>,

    /// The raw SELECT SQL statement
    pub select_sql: String,

    /// Names of source tables/views referenced in the SELECT
    pub source_tables: Vec<String>,

    /// Name of the target table where transformed data is written
    pub target_table: String,

    /// Database of the target table (None = same as MV database)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub target_database: Option<String>,

    /// Optional metadata for the materialized view (e.g., description, source file)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub metadata: Option<Metadata>,
}

impl MaterializedView {
    /// Creates a new MaterializedView
    pub fn new(
        name: impl Into<String>,
        select_sql: impl Into<String>,
        source_tables: Vec<String>,
        target_table: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            database: None,
            select_sql: select_sql.into(),
            source_tables,
            target_table: target_table.into(),
            target_database: None,
            metadata: None,
        }
    }

    /// Returns a unique identifier for this MV
    ///
    /// Format: `{database}_{name}` to ensure uniqueness across databases
    pub fn id(&self, default_database: &str) -> String {
        let db = self.database.as_deref().unwrap_or(default_database);
        format!("{}_{}", db, self.name)
    }

    /// Returns the quoted view name for SQL
    pub fn quoted_name(&self) -> String {
        match &self.database {
            Some(db) => format!("`{}`.`{}`", db, self.name),
            None => format!("`{}`", self.name),
        }
    }

    /// Returns the quoted target table name for SQL
    pub fn quoted_target_table(&self) -> String {
        match &self.target_database {
            Some(db) => format!("`{}`.`{}`", db, self.target_table),
            None => format!("`{}`", self.target_table),
        }
    }

    /// Generates the CREATE MATERIALIZED VIEW SQL statement
    pub fn to_create_sql(&self) -> String {
        format!(
            "CREATE MATERIALIZED VIEW IF NOT EXISTS {} TO {} AS {}",
            self.quoted_name(),
            self.quoted_target_table(),
            self.select_sql
        )
    }

    /// Generates the DROP VIEW SQL statement
    pub fn to_drop_sql(&self) -> String {
        format!("DROP VIEW IF EXISTS {}", self.quoted_name())
    }

    /// Short display string for logging/UI
    pub fn short_display(&self) -> String {
        format!("MaterializedView: {} -> {}", self.name, self.target_table)
    }

    /// Expanded display string with more details
    pub fn expanded_display(&self) -> String {
        format!(
            "MaterializedView: {} (sources: {:?}) -> {}",
            self.name, self.source_tables, self.target_table
        )
    }

    /// Convert to proto representation
    pub fn to_proto(&self) -> ProtoMaterializedView {
        let select_query = ProtoSelectQuery {
            sql: self.select_sql.clone(),
            source_tables: self
                .source_tables
                .iter()
                .map(|t| ProtoTableReference {
                    database: None,
                    table: t.clone(),
                    special_fields: Default::default(),
                })
                .collect(),
            special_fields: Default::default(),
        };

        let target_table = ProtoTableReference {
            database: self.target_database.clone(),
            table: self.target_table.clone(),
            special_fields: Default::default(),
        };

        ProtoMaterializedView {
            name: self.name.clone(),
            database: self.database.clone(),
            select_query: MessageField::some(select_query),
            target_table: MessageField::some(target_table),
            metadata: MessageField::from_option(self.metadata.as_ref().map(|m| {
                crate::proto::infrastructure_map::Metadata {
                    description: m.description.clone().unwrap_or_default(),
                    source: MessageField::from_option(m.source.as_ref().map(|s| {
                        crate::proto::infrastructure_map::SourceLocation {
                            file: s.file.clone(),
                            special_fields: Default::default(),
                        }
                    })),
                    special_fields: Default::default(),
                }
            })),
            special_fields: Default::default(),
        }
    }

    /// Create from proto representation
    pub fn from_proto(proto: ProtoMaterializedView) -> Self {
        let (select_sql, source_tables) = proto
            .select_query
            .map(|sq| {
                (
                    sq.sql,
                    sq.source_tables.into_iter().map(|t| t.table).collect(),
                )
            })
            .unwrap_or_default();

        let (target_table, target_database) = proto
            .target_table
            .map(|t| (t.table, t.database))
            .unwrap_or_default();

        let metadata = proto.metadata.into_option().map(|m| Metadata {
            description: if m.description.is_empty() {
                None
            } else {
                Some(m.description)
            },
            source: m
                .source
                .into_option()
                .map(|s| super::table::SourceLocation { file: s.file }),
        });

        Self {
            name: proto.name,
            database: proto.database,
            select_sql,
            source_tables,
            target_table,
            target_database,
            metadata,
        }
    }
}

impl DataLineage for MaterializedView {
    fn pulls_data_from(&self) -> Vec<InfrastructureSignature> {
        self.source_tables
            .iter()
            .map(|t| InfrastructureSignature::Table { id: t.clone() })
            .collect()
    }

    fn pushes_data_to(&self) -> Vec<InfrastructureSignature> {
        vec![InfrastructureSignature::Table {
            id: self.target_table.clone(),
        }]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_table_reference_qualified_name() {
        let simple = TableReference::new("users");
        assert_eq!(simple.qualified_name(), "users");

        let qualified = TableReference::with_database("mydb", "users");
        assert_eq!(qualified.qualified_name(), "mydb.users");
    }

    #[test]
    fn test_table_reference_quoted() {
        let simple = TableReference::new("users");
        assert_eq!(simple.quoted(), "`users`");

        let qualified = TableReference::with_database("mydb", "users");
        assert_eq!(qualified.quoted(), "`mydb`.`users`");
    }

    #[test]
    fn test_materialized_view_create_sql() {
        let mv = MaterializedView::new(
            "user_stats_mv",
            "SELECT user_id, count(*) as cnt FROM events GROUP BY user_id",
            vec!["events".to_string()],
            "user_stats",
        );

        let sql = mv.to_create_sql();
        assert!(sql.contains("CREATE MATERIALIZED VIEW IF NOT EXISTS"));
        assert!(sql.contains("`user_stats_mv`"));
        assert!(sql.contains("TO `user_stats`"));
        assert!(sql.contains("SELECT user_id, count(*) as cnt FROM events GROUP BY user_id"));
    }

    #[test]
    fn test_materialized_view_data_lineage() {
        let mv = MaterializedView::new(
            "mv",
            "SELECT * FROM a JOIN b ON a.id = b.id",
            vec!["a".to_string(), "b".to_string()],
            "target",
        );

        let pulls = mv.pulls_data_from();
        assert_eq!(pulls.len(), 2);

        let pushes = mv.pushes_data_to();
        assert_eq!(pushes.len(), 1);
    }

    #[test]
    fn test_materialized_view_id() {
        let mv = MaterializedView::new("my_mv", "SELECT 1", vec![], "target");
        assert_eq!(mv.id("default_db"), "default_db_my_mv");

        let mv_with_db = MaterializedView {
            database: Some("other_db".to_string()),
            ..mv
        };
        assert_eq!(mv_with_db.id("default_db"), "other_db_my_mv");
    }

    #[test]
    fn test_materialized_view_serde_camel_case() {
        let mv = MaterializedView::new(
            "test_mv",
            "SELECT * FROM source",
            vec!["source".to_string()],
            "target",
        );

        let json = serde_json::to_string(&mv).unwrap();
        assert!(json.contains("selectSql"));
        assert!(json.contains("sourceTables"));
        assert!(json.contains("targetTable"));
        assert!(!json.contains("select_sql"));
        assert!(!json.contains("source_tables"));
        assert!(!json.contains("target_table"));
    }
}
