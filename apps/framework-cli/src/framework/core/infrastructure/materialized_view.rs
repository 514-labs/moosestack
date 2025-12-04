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

use super::{DataLineage, InfrastructureSignature};

/// Reference to a table, optionally qualified with database
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

/// Represents a SELECT query in a structured format
///
/// While the raw SQL is preserved for flexibility, we also extract
/// semantic information like source tables for dependency tracking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelectQuery {
    /// The raw SELECT SQL statement
    pub sql: String,
    /// Tables/views referenced in the FROM clause(s)
    pub source_tables: Vec<TableReference>,
}

impl SelectQuery {
    /// Create a new SelectQuery from raw SQL and extracted source tables
    pub fn new(sql: impl Into<String>, source_tables: Vec<TableReference>) -> Self {
        Self {
            sql: sql.into(),
            source_tables,
        }
    }

    /// Create a SelectQuery with just the SQL (source tables empty)
    pub fn from_sql(sql: impl Into<String>) -> Self {
        Self {
            sql: sql.into(),
            source_tables: Vec::new(),
        }
    }

    /// Convert to proto representation
    pub fn to_proto(&self) -> ProtoSelectQuery {
        ProtoSelectQuery {
            sql: self.sql.clone(),
            source_tables: self.source_tables.iter().map(|t| t.to_proto()).collect(),
            special_fields: Default::default(),
        }
    }

    /// Create from proto representation
    pub fn from_proto(proto: ProtoSelectQuery) -> Self {
        Self {
            sql: proto.sql,
            source_tables: proto
                .source_tables
                .into_iter()
                .map(TableReference::from_proto)
                .collect(),
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MaterializedView {
    /// Name of the materialized view
    pub name: String,

    /// Database where the MV is created (None = default database)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub database: Option<String>,

    /// The SELECT query that defines the transformation
    pub select_query: SelectQuery,

    /// Target table where transformed data is written (the TO clause)
    pub target_table: TableReference,

    /// Optional source file path where this MV is defined
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub source_file: Option<String>,
}

impl MaterializedView {
    /// Creates a new MaterializedView
    pub fn new(
        name: impl Into<String>,
        select_query: SelectQuery,
        target_table: TableReference,
    ) -> Self {
        Self {
            name: name.into(),
            database: None,
            select_query,
            target_table,
            source_file: None,
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

    /// Generates the CREATE MATERIALIZED VIEW SQL statement
    pub fn to_create_sql(&self) -> String {
        format!(
            "CREATE MATERIALIZED VIEW IF NOT EXISTS {} TO {} AS {}",
            self.quoted_name(),
            self.target_table.quoted(),
            self.select_query.sql
        )
    }

    /// Generates the DROP VIEW SQL statement
    pub fn to_drop_sql(&self) -> String {
        format!("DROP VIEW IF EXISTS {}", self.quoted_name())
    }

    /// Short display string for logging/UI
    pub fn short_display(&self) -> String {
        format!(
            "MaterializedView: {} -> {}",
            self.name,
            self.target_table.qualified_name()
        )
    }

    /// Expanded display string with more details
    pub fn expanded_display(&self) -> String {
        format!(
            "MaterializedView: {} (sources: {:?}) -> {}",
            self.name,
            self.select_query
                .source_tables
                .iter()
                .map(|t| t.qualified_name())
                .collect::<Vec<_>>(),
            self.target_table.qualified_name()
        )
    }

    /// Convert to proto representation
    pub fn to_proto(&self) -> ProtoMaterializedView {
        ProtoMaterializedView {
            name: self.name.clone(),
            database: self.database.clone(),
            select_query: MessageField::some(self.select_query.to_proto()),
            target_table: MessageField::some(self.target_table.to_proto()),
            source_file: self.source_file.clone(),
            special_fields: Default::default(),
        }
    }

    /// Create from proto representation
    pub fn from_proto(proto: ProtoMaterializedView) -> Self {
        Self {
            name: proto.name,
            database: proto.database,
            select_query: proto
                .select_query
                .map(SelectQuery::from_proto)
                .unwrap_or_else(|| SelectQuery::from_sql("")),
            target_table: proto
                .target_table
                .map(TableReference::from_proto)
                .unwrap_or_else(|| TableReference::new("")),
            source_file: proto.source_file,
        }
    }
}

impl DataLineage for MaterializedView {
    fn pulls_data_from(&self) -> Vec<InfrastructureSignature> {
        self.select_query
            .source_tables
            .iter()
            .map(|t| InfrastructureSignature::Table {
                id: t.qualified_name(),
            })
            .collect()
    }

    fn pushes_data_to(&self) -> Vec<InfrastructureSignature> {
        vec![InfrastructureSignature::Table {
            id: self.target_table.qualified_name(),
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
            SelectQuery::new(
                "SELECT user_id, count(*) as cnt FROM events GROUP BY user_id",
                vec![TableReference::new("events")],
            ),
            TableReference::new("user_stats"),
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
            SelectQuery::new(
                "SELECT * FROM a JOIN b ON a.id = b.id",
                vec![TableReference::new("a"), TableReference::new("b")],
            ),
            TableReference::new("target"),
        );

        let pulls = mv.pulls_data_from();
        assert_eq!(pulls.len(), 2);

        let pushes = mv.pushes_data_to();
        assert_eq!(pushes.len(), 1);
    }

    #[test]
    fn test_materialized_view_id() {
        let mv = MaterializedView::new(
            "my_mv",
            SelectQuery::from_sql("SELECT 1"),
            TableReference::new("target"),
        );

        assert_eq!(mv.id("default_db"), "default_db_my_mv");

        let mv_with_db = MaterializedView {
            database: Some("other_db".to_string()),
            ..mv
        };
        assert_eq!(mv_with_db.id("default_db"), "other_db_my_mv");
    }
}
