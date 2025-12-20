use protobuf::MessageField;
use serde::{Deserialize, Serialize};

use crate::framework::data_model::model::DataModel;
use crate::framework::versions::Version;
use crate::proto::infrastructure_map::dmv1view;
use crate::proto::infrastructure_map::Dmv1View as ProtoDmv1View;
use crate::proto::infrastructure_map::SelectQuery as ProtoSelectQuery;
use crate::proto::infrastructure_map::TableAlias as ProtoTableAlias;
use crate::proto::infrastructure_map::TableReference as ProtoTableReference;
use crate::proto::infrastructure_map::View as ProtoView;

use super::table::Metadata;
use super::DataLineage;
use super::InfrastructureSignature;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ViewType {
    TableAlias { source_table_name: String },
}

/// Internal view for table aliasing (versioned data models).
///
/// This is used by the framework to create alias views for data model versions.
/// For user-defined views, see `View`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Dmv1View {
    pub name: String,
    pub version: Version,
    pub view_type: ViewType,
}

/// A user-defined ClickHouse View.
///
/// This represents a user-defined view with an arbitrary SELECT query.
/// Views are virtual tables that compute their results on-demand from the SELECT query.
///
/// This is distinct from `MaterializedView` which persists its results to a table.
///
/// The structure is flat to match JSON output from TypeScript/Python moose-lib.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    /// Name of the view
    pub name: String,

    /// Database where the view is created (None = default database)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub database: Option<String>,

    /// The raw SELECT SQL statement
    pub select_sql: String,

    /// Names of source tables/views referenced in the SELECT
    pub source_tables: Vec<String>,

    /// Optional metadata for the view (e.g., description, source file)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub metadata: Option<Metadata>,
}

impl View {
    /// Creates a new View
    pub fn new(
        name: impl Into<String>,
        select_sql: impl Into<String>,
        source_tables: Vec<String>,
    ) -> Self {
        Self {
            name: name.into(),
            database: None,
            select_sql: select_sql.into(),
            source_tables,
            metadata: None,
        }
    }

    /// Returns a unique identifier for this view
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

    /// Generates the CREATE VIEW SQL statement
    pub fn to_create_sql(&self) -> String {
        format!(
            "CREATE VIEW IF NOT EXISTS {} AS {}",
            self.quoted_name(),
            self.select_sql
        )
    }

    /// Generates the DROP VIEW SQL statement
    pub fn to_drop_sql(&self) -> String {
        format!("DROP VIEW IF EXISTS {}", self.quoted_name())
    }

    /// Short display string for logging/UI
    pub fn short_display(&self) -> String {
        format!("View: {}", self.name)
    }

    /// Expanded display string with more details
    pub fn expanded_display(&self) -> String {
        format!("View: {} (sources: {:?})", self.name, self.source_tables)
    }

    /// Convert to proto representation
    pub fn to_proto(&self) -> ProtoView {
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

        ProtoView {
            name: self.name.clone(),
            database: self.database.clone(),
            select_query: MessageField::some(select_query),
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
    pub fn from_proto(proto: ProtoView) -> Self {
        let (select_sql, source_tables) = proto
            .select_query
            .map(|sq| {
                (
                    sq.sql,
                    sq.source_tables.into_iter().map(|t| t.table).collect(),
                )
            })
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
            metadata,
        }
    }
}

impl View {
    /// Parse a table reference string (e.g., "`table`" or "`database`.`table`")
    /// and return the database and table names with backticks removed.
    ///
    /// Returns (database, table) where database is None if not specified.
    fn parse_table_reference(table_ref: &str) -> (Option<String>, String) {
        // Remove backticks and split by '.'
        let cleaned = table_ref.replace('`', "");
        let parts: Vec<&str> = cleaned.split('.').collect();

        match parts.as_slice() {
            [table] => (None, table.to_string()),
            [database, table] => (Some(database.to_string()), table.to_string()),
            _ => {
                // Fallback: treat the whole string as table name
                (None, cleaned)
            }
        }
    }

    /// Convert a table reference string to a Table ID format: "database_tablename"
    ///
    /// This matches the format used by `Table::id(default_database)` to ensure
    /// dependency edges connect properly in the DDL ordering graph.
    fn table_reference_to_id(table_ref: &str, default_database: &str) -> String {
        let (db, table) = Self::parse_table_reference(table_ref);
        let database = db.as_deref().unwrap_or(default_database);
        format!("{}_{}", database, table)
    }
}

impl DataLineage for View {
    fn pulls_data_from(&self, default_database: &str) -> Vec<InfrastructureSignature> {
        self.source_tables
            .iter()
            .map(|t| InfrastructureSignature::Table {
                id: Self::table_reference_to_id(t, default_database),
            })
            .collect()
    }

    fn pushes_data_to(&self, _default_database: &str) -> Vec<InfrastructureSignature> {
        vec![] // Views don't push data
    }
}

impl Dmv1View {
    // This is only to be used in the context of the new core
    // currently name includes the version, here we are separating that out.
    pub fn id(&self) -> String {
        format!("{}_{}", self.name, self.version.as_suffix())
    }

    pub fn expanded_display(&self) -> String {
        self.short_display()
    }

    pub fn short_display(&self) -> String {
        format!("View: {} Version {}", self.name, self.version)
    }

    pub fn alias_view(data_model: &DataModel, source_data_model: &DataModel) -> Self {
        Dmv1View {
            name: data_model.name.clone(),
            version: data_model.version.clone(),
            view_type: ViewType::TableAlias {
                source_table_name: source_data_model.id(),
            },
        }
    }

    pub fn to_proto(&self) -> ProtoDmv1View {
        ProtoDmv1View {
            name: self.name.clone(),
            version: self.version.to_string(),
            view_type: Some(self.view_type.to_proto()),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: ProtoDmv1View) -> Self {
        Dmv1View {
            name: proto.name,
            version: Version::from_string(proto.version),
            view_type: ViewType::from_proto(proto.view_type.unwrap()),
        }
    }
}

impl DataLineage for Dmv1View {
    fn pulls_data_from(&self, _default_database: &str) -> Vec<InfrastructureSignature> {
        match &self.view_type {
            ViewType::TableAlias { source_table_name } => vec![InfrastructureSignature::Table {
                id: source_table_name.clone(),
            }],
        }
    }

    fn pushes_data_to(&self, _default_database: &str) -> Vec<InfrastructureSignature> {
        vec![]
    }
}

impl ViewType {
    fn to_proto(&self) -> dmv1view::View_type {
        match self {
            ViewType::TableAlias { source_table_name } => {
                dmv1view::View_type::TableAlias(ProtoTableAlias {
                    source_table_name: source_table_name.clone(),
                    special_fields: Default::default(),
                })
            }
        }
    }

    pub fn from_proto(proto: dmv1view::View_type) -> Self {
        match proto {
            dmv1view::View_type::TableAlias(alias) => ViewType::TableAlias {
                source_table_name: alias.source_table_name,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_view_data_lineage_with_backticks() {
        // Test with backticked table names (as they come from TypeScript/Python)
        let view = View::new(
            "my_view",
            "SELECT * FROM events",
            vec!["`events`".to_string()],
        );

        let pulls = view.pulls_data_from("local");
        assert_eq!(pulls.len(), 1);
        // Should match Table::id format: "database_tablename"
        assert_eq!(
            pulls[0],
            InfrastructureSignature::Table {
                id: "local_events".to_string()
            }
        );

        let pushes = view.pushes_data_to("local");
        assert_eq!(pushes.len(), 0); // Views don't push data
    }

    #[test]
    fn test_view_data_lineage_with_database_qualifier() {
        // Test with database-qualified table names
        let view = View::new(
            "my_view",
            "SELECT * FROM mydb.events",
            vec!["`mydb`.`events`".to_string()],
        );

        let pulls = view.pulls_data_from("local");
        assert_eq!(pulls.len(), 1);
        // Should use the explicit database, not default
        assert_eq!(
            pulls[0],
            InfrastructureSignature::Table {
                id: "mydb_events".to_string()
            }
        );
    }

    #[test]
    fn test_view_data_lineage_multiple_sources() {
        // Test with multiple source tables
        let view = View::new(
            "my_view",
            "SELECT * FROM a JOIN b ON a.id = b.id",
            vec!["`a`".to_string(), "`mydb`.`b`".to_string()],
        );

        let pulls = view.pulls_data_from("local");
        assert_eq!(pulls.len(), 2);
        assert_eq!(
            pulls[0],
            InfrastructureSignature::Table {
                id: "local_a".to_string()
            }
        );
        assert_eq!(
            pulls[1],
            InfrastructureSignature::Table {
                id: "mydb_b".to_string()
            }
        );
    }
}
