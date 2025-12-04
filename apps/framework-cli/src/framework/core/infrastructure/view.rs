use protobuf::MessageField;
use serde::{Deserialize, Serialize};

use crate::framework::data_model::model::DataModel;
use crate::framework::versions::Version;
use crate::proto::infrastructure_map::view::View_type as ProtoViewType;
use crate::proto::infrastructure_map::CustomView as ProtoCustomView;
use crate::proto::infrastructure_map::SelectQuery as ProtoSelectQuery;
use crate::proto::infrastructure_map::TableAlias as ProtoTableAlias;
use crate::proto::infrastructure_map::TableReference as ProtoTableReference;
use crate::proto::infrastructure_map::View as ProtoView;

use super::DataLineage;
use super::InfrastructureSignature;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ViewType {
    TableAlias { source_table_name: String },
}

/// Internal view for table aliasing (versioned data models).
///
/// This is used by the framework to create alias views for data model versions.
/// For user-defined views, see `CustomView`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct View {
    pub name: String,
    pub version: Version,
    pub view_type: ViewType,
}

/// A user-defined ClickHouse View.
///
/// Unlike `View` which is used for internal aliasing, `CustomView` represents
/// a user-defined view with an arbitrary SELECT query. Views are virtual tables
/// that compute their results on-demand from the SELECT query.
///
/// This is distinct from `MaterializedView` which persists its results to a table.
///
/// The structure is flat to match JSON output from TypeScript/Python moose-lib.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomView {
    /// Name of the view
    pub name: String,

    /// Database where the view is created (None = default database)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub database: Option<String>,

    /// The raw SELECT SQL statement
    pub select_sql: String,

    /// Names of source tables/views referenced in the SELECT
    pub source_tables: Vec<String>,

    /// Optional source file path where this view is defined
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub source_file: Option<String>,
}

impl CustomView {
    /// Creates a new CustomView
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
            source_file: None,
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
    pub fn to_proto(&self) -> ProtoCustomView {
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

        ProtoCustomView {
            name: self.name.clone(),
            database: self.database.clone(),
            select_query: MessageField::some(select_query),
            source_file: self.source_file.clone(),
            special_fields: Default::default(),
        }
    }

    /// Create from proto representation
    pub fn from_proto(proto: ProtoCustomView) -> Self {
        let (select_sql, source_tables) = proto
            .select_query
            .map(|sq| {
                (
                    sq.sql,
                    sq.source_tables.into_iter().map(|t| t.table).collect(),
                )
            })
            .unwrap_or_default();

        Self {
            name: proto.name,
            database: proto.database,
            select_sql,
            source_tables,
            source_file: proto.source_file,
        }
    }
}

impl DataLineage for CustomView {
    fn pulls_data_from(&self) -> Vec<InfrastructureSignature> {
        self.source_tables
            .iter()
            .map(|t| InfrastructureSignature::Table { id: t.clone() })
            .collect()
    }

    fn pushes_data_to(&self) -> Vec<InfrastructureSignature> {
        vec![] // Views don't push data
    }
}

impl View {
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
        View {
            name: data_model.name.clone(),
            version: data_model.version.clone(),
            view_type: ViewType::TableAlias {
                source_table_name: source_data_model.id(),
            },
        }
    }

    pub fn to_proto(&self) -> ProtoView {
        ProtoView {
            name: self.name.clone(),
            version: self.version.to_string(),
            view_type: Some(self.view_type.to_proto()),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: ProtoView) -> Self {
        View {
            name: proto.name,
            version: Version::from_string(proto.version),
            view_type: ViewType::from_proto(proto.view_type.unwrap()),
        }
    }
}

impl DataLineage for View {
    fn pulls_data_from(&self) -> Vec<InfrastructureSignature> {
        match &self.view_type {
            ViewType::TableAlias { source_table_name } => vec![InfrastructureSignature::Table {
                id: source_table_name.clone(),
            }],
        }
    }

    fn pushes_data_to(&self) -> Vec<InfrastructureSignature> {
        vec![]
    }
}

impl ViewType {
    fn to_proto(&self) -> ProtoViewType {
        match self {
            ViewType::TableAlias { source_table_name } => {
                ProtoViewType::TableAlias(ProtoTableAlias {
                    source_table_name: source_table_name.clone(),
                    special_fields: Default::default(),
                })
            }
        }
    }

    pub fn from_proto(proto: ProtoViewType) -> Self {
        match proto {
            ProtoViewType::TableAlias(alias) => ViewType::TableAlias {
                source_table_name: alias.source_table_name,
            },
        }
    }
}
