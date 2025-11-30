//! # Infrastructure Map Module
//!
//! This module is a cornerstone of the Moose framework, providing a comprehensive representation
//! of all infrastructure components and their relationships. It serves as the source of truth for
//! the entire system architecture and enables infrastructure-as-code capabilities.
//!
//! ## Overview
//!
//! The `InfrastructureMap` tracks all components of the system:
//! - Data storage components (tables, views)
//! - Streaming components (topics)
//! - API components (endpoints)
//! - Process components (synchronization processes, function processes, etc.)
//!
//! This map enables the framework to:
//! 1. Generate a complete representation of the required infrastructure
//! 2. Compare infrastructure states to determine necessary changes
//! 3. Apply changes to actual infrastructure components
//! 4. Persist infrastructure state for later reference
//!
//! ## Key Components
//!
//! - `InfrastructureMap`: The main struct containing all infrastructure components
//! - `InfraChanges`: Represents changes between two infrastructure states
//! - Change enums: Various enums representing specific types of changes to components
//!
//! ## Usage Flow
//!
//! 1. Generate an `InfrastructureMap` from primitive components
//! 2. Compare maps to determine changes using `diff()`
//! 3. Apply changes to actual infrastructure
//! 4. Store the updated map for future reference
//!
//! This module is essential for maintaining consistency between the defined infrastructure
//! and the actual deployed components.
use super::infrastructure::api_endpoint::{APIType, ApiEndpoint};
use super::infrastructure::consumption_webserver::ConsumptionApiWebServer;
use super::infrastructure::function_process::FunctionProcess;
use super::infrastructure::orchestration_worker::OrchestrationWorker;
use super::infrastructure::sql_resource::SqlResource;
use super::infrastructure::table::{Column, OrderBy, Table};
use super::infrastructure::topic::Topic;
use super::infrastructure::topic_sync_process::{TopicToTableSyncProcess, TopicToTopicSyncProcess};
use super::infrastructure::view::{Dmv1View, View};
use super::partial_infrastructure_map::LifeCycle;
use super::partial_infrastructure_map::PartialInfrastructureMap;
use crate::cli::display::{show_message_wrapper, Message, MessageType};
use crate::framework::core::infra_reality_checker::find_table_from_infra_map;
use crate::framework::core::infrastructure::materialized_view::MaterializedView;
use crate::framework::core::infrastructure_map::Change::Added;
use crate::framework::core::lifecycle_filter;
use crate::framework::languages::SupportedLanguages;
use crate::framework::python::datamodel_config::load_main_py;
use crate::framework::scripts::Workflow;
use crate::infrastructure::olap::clickhouse::codec_expressions_are_equivalent;
use crate::infrastructure::olap::clickhouse::config::DEFAULT_DATABASE_NAME;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
use crate::infrastructure::olap::clickhouse::IgnorableOperation;
use crate::infrastructure::redis::redis_client::RedisClient;
use crate::project::Project;
use crate::proto::infrastructure_map::InfrastructureMap as ProtoInfrastructureMap;
use crate::utilities::constants::{PYTHON_MAIN_FILE, TYPESCRIPT_MAIN_FILE};
use crate::utilities::secrets::CREDENTIAL_PLACEHOLDER;
use anyhow::{Context, Result};
use protobuf::{EnumOrUnknown, Message as ProtoMessage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::{fs, mem};

/// Strategy trait for handling database-specific table diffing logic
///
/// Different OLAP engines have different capabilities for handling schema changes.
/// This trait allows database-specific modules to define how table updates should
/// be decomposed into atomic operations that the database can actually perform.
pub trait TableDiffStrategy {
    /// Converts a table update into the appropriate change operations
    /// based on database capabilities. Returns the actual operations
    /// that will be shown to the user in the plan.
    ///
    /// # Arguments
    /// * `before` - The table before changes
    /// * `after` - The table after changes
    /// * `column_changes` - Detailed column-level changes
    /// * `order_by_change` - Changes to the ORDER BY clause
    /// * `partition_by_change` - Changes to the PARTITION BY clause
    /// * `default_database` - The configured default database name for equivalence checks
    ///
    /// # Returns
    /// A vector of `OlapChange` representing the actual operations needed
    fn diff_table_update(
        &self,
        before: &Table,
        after: &Table,
        column_changes: Vec<ColumnChange>,
        order_by_change: OrderByChange,
        partition_by_change: PartitionByChange,
        default_database: &str,
    ) -> Vec<OlapChange>;
}

/// Default table diff strategy for databases that support most ALTER operations
///
/// This strategy assumes the database can handle:
/// - Column additions, removals, and modifications via ALTER TABLE
/// - ORDER BY changes via ALTER TABLE
/// - Primary key changes via ALTER TABLE
///
/// This is suitable for most modern SQL databases.
pub struct DefaultTableDiffStrategy;

impl TableDiffStrategy for DefaultTableDiffStrategy {
    fn diff_table_update(
        &self,
        before: &Table,
        after: &Table,
        column_changes: Vec<ColumnChange>,
        order_by_change: OrderByChange,
        partition_by_change: PartitionByChange,
        _default_database: &str,
    ) -> Vec<OlapChange> {
        // Most databases can handle all changes via ALTER TABLE operations
        // Return the standard table update change
        vec![OlapChange::Table(TableChange::Updated {
            name: before.name.clone(),
            column_changes,
            order_by_change,
            partition_by_change,
            before: before.clone(),
            after: after.clone(),
        })]
    }
}

/// Error types for InfrastructureMap protocol buffer operations
///
/// This enum defines errors that can occur when converting between protocol
/// buffer representations and Rust representations of the infrastructure map.
#[derive(Debug, thiserror::Error)]
#[error("Failed to convert infrastructure map from proto")]
#[non_exhaustive]
pub enum InfraMapProtoError {
    /// Error occurred during protobuf parsing
    #[error("Failed to parse proto message")]
    ProtoParseError(#[from] protobuf::Error),

    /// A required field was missing in the protobuf message
    #[error("Missing required field: {field_name}")]
    MissingField { field_name: String },
}

/// Error types for InfrastructureMap operations
///
/// This enum defines errors that can occur when working with the infrastructure map,
/// particularly when trying to access components that don't exist.
#[derive(Debug, thiserror::Error)]
pub enum InfraMapError {
    /// Error when a topic with the specified ID cannot be found
    #[error("Topic {topic_id} not found in the infrastructure map")]
    TopicNotFound { topic_id: String },

    /// Error when a table with the specified ID cannot be found
    #[error("Table {table_id} not found in the infrastructure map")]
    TableNotFound { table_id: String },
}
/// Types of primitives that can be represented in the infrastructure
///
/// These represent the core building blocks of the system that can be
/// transformed into infrastructure components.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PrimitiveTypes {
    /// A data model that defines the structure of data
    DataModel,
    /// A function that processes data
    Function,
    /// A database block for OLAP operations
    DBBlock,
    /// An API for consumption of data
    ConsumptionAPI,
}

/// TODO: delete this DM V1 type
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PrimitiveSignature {
    /// Name of the primitive component
    pub name: String,
    /// Type of the primitive component
    pub primitive_type: PrimitiveTypes,
}

impl PrimitiveSignature {
    /// Converts this signature to its protocol buffer representation
    pub fn to_proto(&self) -> crate::proto::infrastructure_map::PrimitiveSignature {
        crate::proto::infrastructure_map::PrimitiveSignature {
            name: self.name.clone(),
            primitive_type: EnumOrUnknown::new(self.primitive_type.to_proto()),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: crate::proto::infrastructure_map::PrimitiveSignature) -> Self {
        PrimitiveSignature {
            name: proto.name,
            primitive_type: PrimitiveTypes::from_proto(proto.primitive_type.unwrap()),
        }
    }
}

impl PrimitiveTypes {
    /// Converts this primitive type to its protocol buffer representation
    ///
    /// Maps each variant of the enum to the corresponding protocol buffer enum value.
    ///
    /// # Returns
    /// The protocol buffer enum value corresponding to this primitive type
    fn to_proto(&self) -> crate::proto::infrastructure_map::PrimitiveTypes {
        match self {
            PrimitiveTypes::DataModel => {
                crate::proto::infrastructure_map::PrimitiveTypes::DATA_MODEL
            }
            PrimitiveTypes::Function => crate::proto::infrastructure_map::PrimitiveTypes::FUNCTION,
            PrimitiveTypes::DBBlock => crate::proto::infrastructure_map::PrimitiveTypes::DB_BLOCK,
            PrimitiveTypes::ConsumptionAPI => {
                crate::proto::infrastructure_map::PrimitiveTypes::CONSUMPTION_API
            }
        }
    }

    /// Creates a primitive type from its protocol buffer representation
    ///
    /// Maps each protocol buffer enum value to the corresponding Rust enum variant.
    ///
    /// # Arguments
    /// * `proto` - The protocol buffer enum value to convert
    ///
    /// # Returns
    /// The corresponding PrimitiveTypes variant
    pub fn from_proto(proto: crate::proto::infrastructure_map::PrimitiveTypes) -> Self {
        match proto {
            crate::proto::infrastructure_map::PrimitiveTypes::DATA_MODEL => {
                PrimitiveTypes::DataModel
            }
            crate::proto::infrastructure_map::PrimitiveTypes::FUNCTION => PrimitiveTypes::Function,
            crate::proto::infrastructure_map::PrimitiveTypes::DB_BLOCK => PrimitiveTypes::DBBlock,
            crate::proto::infrastructure_map::PrimitiveTypes::CONSUMPTION_API => {
                PrimitiveTypes::ConsumptionAPI
            }
        }
    }
}

/// Represents a change to a database column
///
/// This enum captures the three possible states of change for a column:
/// addition, removal, or update with before and after states.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(clippy::large_enum_variant)]
pub enum ColumnChange {
    /// A new column has been added
    Added {
        column: Column,
        position_after: Option<String>,
    },
    /// An existing column has been removed
    Removed(Column),
    /// An existing column has been modified
    Updated { before: Column, after: Column },
}

/// Represents changes to the order_by configuration of a table
///
/// Tracks the before and after states of the ordering columns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderByChange {
    /// Previous ORDER BY configuration
    pub before: OrderBy,
    /// New ORDER BY configuration
    pub after: OrderBy,
}

/// Represents changes to the partition_by configuration of a table
///
/// Tracks the before and after states of the partition expression.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartitionByChange {
    /// Previous PARTITION BY configuration
    pub before: Option<String>,
    /// New PARTITION BY configuration
    pub after: Option<String>,
}

/// Represents a change to a database table
///
/// This captures the complete picture of table changes, including additions,
/// removals, and detailed updates with column-level changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(clippy::large_enum_variant)]
pub enum TableChange {
    /// A new table has been added
    Added(Table),
    /// An existing table has been removed
    Removed(Table),
    /// An existing table has been modified
    Updated {
        /// Name of the table that was updated
        name: String,
        /// List of column-level changes
        column_changes: Vec<ColumnChange>,
        /// Changes to the ordering columns
        order_by_change: OrderByChange,
        /// Changes to the partitioning expression
        partition_by_change: PartitionByChange,
        /// Complete representation of the table before changes
        before: Table,
        /// Complete representation of the table after changes
        after: Table,
    },
    /// Only table settings have been modified (can use ALTER TABLE MODIFY SETTING)
    SettingsChanged {
        /// Name of the table
        name: String,
        /// Table settings before the change
        before_settings: Option<std::collections::HashMap<String, String>>,
        /// Table settings after the change
        after_settings: Option<std::collections::HashMap<String, String>>,
        /// Complete table representation for context
        table: Table,
    },
    /// Table-level TTL changed
    TtlChanged {
        name: String,
        before: Option<String>,
        after: Option<String>,
        table: Table,
    },
    /// A validation error occurred - the requested change is not allowed
    ValidationError {
        /// Name of the table
        table_name: String,
        /// Error message explaining why the change is not allowed
        message: String,
        /// Complete representation of the table before the invalid change
        before: Box<Table>,
        /// Complete representation of the table after the invalid change
        after: Box<Table>,
    },
}

/// Generic representation of a change to any infrastructure component
///
/// This type-parametrized enum can represent changes to any serializable
/// component type in a consistent way.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Change<T: Serialize> {
    /// A new component has been added
    Added(Box<T>),
    /// An existing component has been removed
    Removed(Box<T>),
    /// An existing component has been modified
    Updated { before: Box<T>, after: Box<T> },
}

/// High-level categories of infrastructure changes
///
/// This enum categorizes changes by the part of the infrastructure they affect.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum InfraChange {
    /// Changes to OLAP (Online Analytical Processing) components
    Olap(OlapChange),
    /// Changes to streaming components
    Streaming(StreamingChange),
    /// Changes to API components
    Api(ApiChange),
    /// Changes to WebApp components
    WebApp(WebAppChange),
    /// Changes to process components
    Process(ProcessChange),
}

/// Changes to OLAP (database) components
///
/// This includes changes to tables and views.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(clippy::large_enum_variant)]
pub enum OlapChange {
    /// Change to a database table
    Table(TableChange),
    /// Change to a database view (internal alias views for data model versioning)
    Dmv1View(Change<Dmv1View>),
    /// Change to SQL resource (legacy, for raw SQL)
    SqlResource(Change<SqlResource>),
    /// Change to a structured materialized view
    MaterializedView(Change<MaterializedView>),
    /// Change to a structured view (user-defined SELECT views)
    View(Change<View>),
    /// Explicit operation to populate a materialized view with initial data
    PopulateMaterializedView {
        /// Name of the materialized view
        view_name: String,
        /// Target table that will receive the data
        target_table: String,
        /// Target database (if different from default)
        target_database: Option<String>,
        /// The SELECT statement to populate with
        select_statement: String,
        /// Source tables that data is pulled from
        source_tables: Vec<String>,
        /// Whether to truncate the target table before populating
        should_truncate: bool,
    },
}

/// Changes to streaming components
///
/// Currently only includes changes to topics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StreamingChange {
    /// Change to a streaming topic
    Topic(Change<Topic>),
}

/// Changes to API components
///
/// Currently only includes changes to API endpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ApiChange {
    /// Change to an API endpoint
    ApiEndpoint(Change<ApiEndpoint>),
}

/// Changes to WebApp components
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WebAppChange {
    /// Change to a WebApp
    WebApp(Change<super::infrastructure::web_app::WebApp>),
}

/// Changes to process components
///
/// This includes various types of processes that operate on the infrastructure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProcessChange {
    /// Change to a process that syncs data from a topic to a table
    TopicToTableSyncProcess(Change<TopicToTableSyncProcess>),
    /// Change to a process that syncs data between topics
    TopicToTopicSyncProcess(Change<TopicToTopicSyncProcess>),
    /// Change to a function process
    FunctionProcess(Change<FunctionProcess>),
    /// Change to a consumption API web server
    ConsumptionApiWebServer(Change<ConsumptionApiWebServer>),
    /// Change to an orchestration worker
    OrchestrationWorker(Change<OrchestrationWorker>),
}

/// Changes to workflow components
///
/// Workflows are orchestration units that execute tasks on a schedule or on-demand.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WorkflowChange {
    /// Change to a workflow
    Workflow(Change<Workflow>),
}

/// Represents a change that was blocked by lifecycle policies
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilteredChange {
    /// The change that was blocked
    pub change: OlapChange,
    /// The reason the change was blocked
    pub reason: String,
}

/// Collection of all changes detected between two infrastructure states
///
/// This struct aggregates changes across all parts of the infrastructure
/// and is the primary output of the difference calculation.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InfraChanges {
    /// Changes to OLAP (database) components
    pub olap_changes: Vec<OlapChange>,
    /// Changes to process components
    pub processes_changes: Vec<ProcessChange>,
    /// Changes to API components
    pub api_changes: Vec<ApiChange>,
    /// Changes to WebApp components
    pub web_app_changes: Vec<WebAppChange>,
    /// Changes to streaming components
    pub streaming_engine_changes: Vec<StreamingChange>,
    /// Changes to workflow components
    #[serde(default)]
    pub workflow_changes: Vec<WorkflowChange>,
    /// Changes that were filtered out due to lifecycle policies
    #[serde(default)]
    pub filtered_olap_changes: Vec<FilteredChange>,
}

impl InfraChanges {
    /// Checks if there are any changes in this collection
    ///
    /// Returns true if all change vectors are empty, false otherwise.
    /// This includes filtered changes so users see feedback about blocked operations.
    pub fn is_empty(&self) -> bool {
        self.olap_changes.is_empty()
            && self.processes_changes.is_empty()
            && self.api_changes.is_empty()
            && self.web_app_changes.is_empty()
            && self.streaming_engine_changes.is_empty()
            && self.workflow_changes.is_empty()
            && self.filtered_olap_changes.is_empty()
    }
}

/// Represents the complete infrastructure map of the system, containing all components and their relationships
///
/// Default function for serde to provide default database name
fn default_database_name() -> String {
    DEFAULT_DATABASE_NAME.to_string()
}

/// The `InfrastructureMap` is the central data structure of the Moose framework's infrastructure management.
/// It contains a comprehensive representation of all infrastructure components and their relationships,
/// serving as the source of truth for the entire system architecture.
///
/// Components are organized by type and indexed by appropriate identifiers for efficient lookup.
/// The map can be serialized to/from various formats (JSON, Protocol Buffers) for persistence
/// and can be compared with other maps to detect changes.
///
/// The relationship between the components is maintained by reference rather than by value.
/// Helper methods facilitate navigating the map and finding related components.
///
/// Note: This type has a custom `Serialize` implementation that sorts all JSON keys
/// alphabetically for deterministic output in version-controlled migration files.
#[derive(Debug, Clone, Deserialize)]
pub struct InfrastructureMap {
    #[serde(default = "default_database_name")]
    pub default_database: String,
    /// Collection of topics indexed by topic ID
    pub topics: HashMap<String, Topic>,

    /// Collection of API endpoints indexed by endpoint ID
    pub api_endpoints: HashMap<String, ApiEndpoint>,

    /// Collection of database tables indexed by table name
    pub tables: HashMap<String, Table>,

    /// Collection of database views (DMv1 for table aliases) indexed by view name
    pub dmv1_views: HashMap<String, Dmv1View>,

    /// Processes that sync data from topics to tables
    pub topic_to_table_sync_processes: HashMap<String, TopicToTableSyncProcess>,

    /// Processes that sync data between topics
    #[serde(default = "HashMap::new")]
    pub topic_to_topic_sync_processes: HashMap<String, TopicToTopicSyncProcess>,

    /// Collection of function processes that transform data
    pub function_processes: HashMap<String, FunctionProcess>,

    /// Web server handling consumption API endpoints
    // Not sure if we will want to change that or not in the future to be able to tell
    // the new consumption endpoints that were added or removed.
    pub consumption_api_web_server: ConsumptionApiWebServer,

    /// Collection of orchestration workers indexed by worker ID
    #[serde(default = "HashMap::new")]
    pub orchestration_workers: HashMap<String, OrchestrationWorker>,

    /// resources that have setup and teardown (legacy, for raw SQL)
    #[serde(default)]
    pub sql_resources: HashMap<String, SqlResource>,

    /// Collection of workflows indexed by workflow name
    #[serde(default)]
    pub workflows: HashMap<String, Workflow>,

    /// Collection of web applications indexed by name
    #[serde(default)]
    pub web_apps: HashMap<String, super::infrastructure::web_app::WebApp>,

    /// Collection of materialized views indexed by MV name
    #[serde(default)]
    pub materialized_views: HashMap<String, MaterializedView>,

    /// Collection of views indexed by view name
    #[serde(default)]
    pub views: HashMap<String, View>,

    /// Version of Moose CLI that created or last updated this infrastructure map.
    /// Populated automatically during storage operations.
    /// None for maps created by older CLI versions (pre-version-tracking).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub moose_version: Option<String>,
}

impl InfrastructureMap {
    /// Creates an empty infrastructure map from project configuration.
    ///
    /// This is used when loading state from storage returns None (first migration scenario).
    /// All fields are initialized to empty/default values except `default_database`,
    /// which is extracted from the project's ClickHouse configuration.
    ///
    /// # Why explicit field listing?
    /// This method explicitly lists all fields instead of using `..Default::default()`
    /// to force compiler errors when new fields are added to InfrastructureMap.
    /// This ensures developers must consciously decide: does this new field need
    /// project configuration (like default_database), or can it safely default to empty?
    ///
    /// # Arguments
    /// * `project` - The project context containing configuration
    ///
    /// # Returns
    /// An empty infrastructure map with the database name from project configuration
    pub fn empty_from_project(project: &Project) -> Self {
        Self {
            default_database: project.clickhouse_config.db_name.clone(),
            topics: Default::default(),
            api_endpoints: Default::default(),
            tables: Default::default(),
            dmv1_views: Default::default(),
            topic_to_table_sync_processes: Default::default(),
            topic_to_topic_sync_processes: Default::default(),
            function_processes: Default::default(),
            consumption_api_web_server: ConsumptionApiWebServer {},
            orchestration_workers: Default::default(),
            sql_resources: Default::default(),
            workflows: Default::default(),
            web_apps: Default::default(),
            materialized_views: Default::default(),
            views: Default::default(),
            moose_version: None,
        }
    }

    /// Generates all the changes needed for initial infrastructure deployment
    ///
    /// This method creates a complete set of changes representing the creation of
    /// all components in this infrastructure map. It's used when deploying to an
    /// environment with no existing infrastructure.
    ///
    /// # Arguments
    /// * `project` - The project context with configuration and features
    ///
    /// # Returns
    /// An `InfraChanges` object containing all components marked as additions
    pub fn init(&self, project: &Project) -> InfraChanges {
        let olap_changes = self.init_tables();
        let processes_changes = self.init_processes(project);
        let api_changes = self.init_api_endpoints();
        let streaming_engine_changes = self.init_topics();

        InfraChanges {
            olap_changes,
            processes_changes,
            api_changes,
            streaming_engine_changes,
            web_app_changes: vec![],
            workflow_changes: vec![],
            filtered_olap_changes: vec![],
        }
    }

    /// Creates changes for initial topic deployment
    ///
    /// Generates changes representing the creation of all topics in this map.
    ///
    /// # Returns
    /// A vector of `StreamingChange` objects for topic creation
    fn init_topics(&self) -> Vec<StreamingChange> {
        self.topics
            .values()
            .map(|topic| StreamingChange::Topic(Change::<Topic>::Added(Box::new(topic.clone()))))
            .collect()
    }

    /// Creates changes for initial API endpoint deployment
    ///
    /// Generates changes representing the creation of all API endpoints in this map.
    ///
    /// # Returns
    /// A vector of `ApiChange` objects for endpoint creation
    pub fn init_api_endpoints(&self) -> Vec<ApiChange> {
        self.api_endpoints
            .values()
            .map(|api_endpoint| {
                ApiChange::ApiEndpoint(Change::<ApiEndpoint>::Added(Box::new(api_endpoint.clone())))
            })
            .collect()
    }

    /// Creates changes for initial WebApp deployment
    ///
    /// Generates changes representing the creation of all WebApps in this map.
    ///
    /// # Returns
    /// A vector of `WebAppChange` objects for WebApp creation
    pub fn init_web_apps(&self) -> Vec<WebAppChange> {
        self.web_apps
            .values()
            .map(|web_app| {
                WebAppChange::WebApp(Change::<super::infrastructure::web_app::WebApp>::Added(
                    Box::new(web_app.clone()),
                ))
            })
            .collect()
    }

    /// Creates changes for initial table deployment
    ///
    /// Generates changes representing the creation of all tables in this map.
    ///
    /// # Returns
    /// A vector of `OlapChange` objects for table creation
    fn init_tables(&self) -> Vec<OlapChange> {
        self.tables
            .values()
            .map(|table| OlapChange::Table(TableChange::Added(table.clone())))
            .chain(
                self.sql_resources
                    .values()
                    .map(|resource| OlapChange::SqlResource(Added(Box::new(resource.clone())))),
            )
            .chain(
                self.materialized_views
                    .values()
                    .map(|mv| OlapChange::MaterializedView(Change::Added(Box::new(mv.clone())))),
            )
            .chain(
                self.views
                    .values()
                    .map(|cv| OlapChange::View(Change::Added(Box::new(cv.clone())))),
            )
            .collect()
    }

    /// Creates changes for initial process deployment
    ///
    /// Generates changes representing the creation of all processes in this map.
    ///
    /// # Arguments
    /// * `project` - The project context with configuration and features
    ///
    /// # Returns
    /// A vector of `ProcessChange` objects for process creation
    pub fn init_processes(&self, project: &Project) -> Vec<ProcessChange> {
        let mut process_changes: Vec<ProcessChange> = self
            .topic_to_table_sync_processes
            .values()
            .map(|topic_to_table_sync_process| {
                ProcessChange::TopicToTableSyncProcess(Change::<TopicToTableSyncProcess>::Added(
                    Box::new(topic_to_table_sync_process.clone()),
                ))
            })
            .collect();

        let mut topic_to_topic_process_changes: Vec<ProcessChange> = self
            .topic_to_topic_sync_processes
            .values()
            .map(|topic_to_table_sync_process| {
                ProcessChange::TopicToTopicSyncProcess(Change::<TopicToTopicSyncProcess>::Added(
                    Box::new(topic_to_table_sync_process.clone()),
                ))
            })
            .collect();
        process_changes.append(&mut topic_to_topic_process_changes);

        let mut function_process_changes: Vec<ProcessChange> = self
            .function_processes
            .values()
            .map(|function_process| {
                ProcessChange::FunctionProcess(Change::<FunctionProcess>::Added(Box::new(
                    function_process.clone(),
                )))
            })
            .collect();

        process_changes.append(&mut function_process_changes);

        // Only add Analytics API server if apis feature is enabled
        if project.features.apis {
            process_changes.push(ProcessChange::ConsumptionApiWebServer(Change::<
                ConsumptionApiWebServer,
            >::Added(
                Box::new(ConsumptionApiWebServer {}),
            )));
        }

        process_changes.push(ProcessChange::OrchestrationWorker(Change::<
            OrchestrationWorker,
        >::Added(
            Box::new(OrchestrationWorker {
                supported_language: project.language,
            }),
        )));
        process_changes
    }

    /// Compares this infrastructure map with a target map using a custom table diff strategy
    ///
    /// This method is similar to `diff()` but allows specifying a custom strategy for
    /// handling table differences. This is useful for database-specific behavior where
    /// certain operations need to be decomposed differently (e.g., ClickHouse requiring
    /// drop+create for ORDER BY changes).
    ///
    /// # Arguments
    /// * `target_map` - The target infrastructure map to compare against
    /// * `table_diff_strategy` - Strategy for handling database-specific table diffing
    ///
    /// # Returns
    /// An `InfraChanges` object containing all detected changes
    pub fn diff_with_table_strategy(
        &self,
        target_map: &InfrastructureMap,
        table_diff_strategy: &dyn TableDiffStrategy,
        respect_life_cycle: bool,
        is_production: bool,
        ignore_ops: &[IgnorableOperation],
    ) -> InfraChanges {
        let mut changes = InfraChanges::default();

        // Topics
        Self::diff_topics(
            &self.topics,
            &target_map.topics,
            &mut changes.streaming_engine_changes,
            respect_life_cycle,
        );

        // API Endpoints
        Self::diff_api_endpoints(
            &self.api_endpoints,
            &target_map.api_endpoints,
            &mut changes.api_changes,
        );

        // WebApps
        Self::diff_web_apps(
            &self.web_apps,
            &target_map.web_apps,
            &mut changes.web_app_changes,
        );

        // Tables (using custom strategy)
        tracing::info!("Analyzing changes in Tables...");
        let olap_changes_len_before = changes.olap_changes.len();
        Self::diff_tables_with_strategy(
            &self.tables,
            &target_map.tables,
            &mut changes.olap_changes,
            &mut changes.filtered_olap_changes,
            table_diff_strategy,
            respect_life_cycle,
            &target_map.default_database,
            ignore_ops,
        );
        let table_changes = changes.olap_changes.len() - olap_changes_len_before;
        tracing::info!("Table changes detected: {}", table_changes);

        // DMv1 Views (table aliases)
        Self::diff_dmv1_views(
            &self.dmv1_views,
            &target_map.dmv1_views,
            &mut changes.olap_changes,
        );

        // SQL Resources
        tracing::info!("Analyzing changes in SQL Resources...");
        let olap_changes_len_before = changes.olap_changes.len();
        Self::diff_sql_resources(
            &self.sql_resources,
            &target_map.sql_resources,
            &mut changes.olap_changes,
        );
        let sql_resource_changes = changes.olap_changes.len() - olap_changes_len_before;
        tracing::info!("SQL Resource changes detected: {}", sql_resource_changes);

        // Materialized Views
        tracing::info!("Analyzing changes in Materialized Views...");
        let olap_changes_len_before = changes.olap_changes.len();
        Self::diff_materialized_views(
            &self.materialized_views,
            &target_map.materialized_views,
            &target_map.tables,
            is_production,
            &self.default_database,
            &mut changes.olap_changes,
        );
        let mv_changes = changes.olap_changes.len() - olap_changes_len_before;
        tracing::info!("Materialized View changes detected: {}", mv_changes);

        // Views
        tracing::info!("Analyzing changes in Views...");
        let olap_changes_len_before = changes.olap_changes.len();
        Self::diff_views(
            &self.views,
            &target_map.views,
            &self.default_database,
            &mut changes.olap_changes,
        );
        let view_changes = changes.olap_changes.len() - olap_changes_len_before;
        tracing::info!("View changes detected: {}", view_changes);

        // All process types
        self.diff_all_processes(target_map, &mut changes.processes_changes);

        // Workflows
        Self::diff_workflows(
            &self.workflows,
            &target_map.workflows,
            &mut changes.workflow_changes,
        );

        // Summary
        tracing::info!(
            "Total changes detected - OLAP: {}, Processes: {}, API: {}, WebApps: {}, Streaming: {}, Workflows: {}",
            changes.olap_changes.len(),
            changes.processes_changes.len(),
            changes.api_changes.len(),
            changes.web_app_changes.len(),
            changes.streaming_engine_changes.len(),
            changes.workflow_changes.len()
        );

        changes
    }

    /// Compare topics between two infrastructure maps and compute the differences
    ///
    /// This method identifies added, removed, and updated topics by comparing
    /// the source and target topic maps, respecting lifecycle constraints.
    ///
    /// # Arguments
    /// * `self_topics` - HashMap of source topics to compare from
    /// * `target_topics` - HashMap of target topics to compare against
    /// * `streaming_changes` - Mutable vector to collect the identified changes
    ///
    /// # Returns
    /// A tuple of (additions, removals, updates) counts
    fn diff_topics(
        self_topics: &HashMap<String, Topic>,
        target_topics: &HashMap<String, Topic>,
        streaming_changes: &mut Vec<StreamingChange>,
        respect_life_cycle: bool,
    ) -> (usize, usize, usize) {
        tracing::info!("Analyzing changes in Topics...");
        let mut topic_updates = 0;
        let mut topic_removals = 0;
        let mut topic_additions = 0;

        for (id, topic) in self_topics {
            if let Some(target_topic) = target_topics.get(id) {
                if !topics_equal_ignore_metadata(topic, target_topic) {
                    // Respect lifecycle: ExternallyManaged topics are never modified
                    if target_topic.life_cycle == LifeCycle::ExternallyManaged && respect_life_cycle
                    {
                        tracing::debug!(
                            "Topic '{}' has changes but is externally managed - skipping update",
                            topic.name
                        );
                    } else {
                        tracing::debug!("Topic updated: {} ({})", topic.name, id);
                        topic_updates += 1;
                        streaming_changes.push(StreamingChange::Topic(Change::<Topic>::Updated {
                            before: Box::new(topic.clone()),
                            after: Box::new(target_topic.clone()),
                        }));
                    }
                }
            } else {
                // Respect lifecycle: DeletionProtected and ExternallyManaged topics are never removed
                match (topic.life_cycle, respect_life_cycle) {
                    (LifeCycle::FullyManaged, _) | (_, false) => {
                        tracing::debug!("Topic removed: {} ({})", topic.name, id);
                        topic_removals += 1;
                        streaming_changes.push(StreamingChange::Topic(Change::<Topic>::Removed(
                            Box::new(topic.clone()),
                        )));
                    }
                    (LifeCycle::DeletionProtected, true) => {
                        tracing::debug!(
                            "Topic '{}' marked for removal but is deletion-protected - skipping removal",
                            topic.name
                        );
                    }
                    (LifeCycle::ExternallyManaged, true) => {
                        tracing::debug!(
                            "Topic '{}' marked for removal but is externally managed - skipping removal",
                            topic.name
                        );
                    }
                }
            }
        }

        for (id, topic) in target_topics {
            if !self_topics.contains_key(id) {
                // Respect lifecycle: ExternallyManaged topics are never added automatically
                if topic.life_cycle == LifeCycle::ExternallyManaged && respect_life_cycle {
                    tracing::debug!(
                        "Topic '{}' marked for addition but is externally managed - skipping addition",
                        topic.name
                    );
                } else {
                    tracing::debug!("Topic added: {} ({})", topic.name, id);
                    topic_additions += 1;
                    streaming_changes.push(StreamingChange::Topic(Change::<Topic>::Added(
                        Box::new(topic.clone()),
                    )));
                }
            }
        }

        tracing::info!(
            "Topic changes: {} added, {} removed, {} updated",
            topic_additions,
            topic_removals,
            topic_updates
        );

        (topic_additions, topic_removals, topic_updates)
    }

    /// Compare API endpoints between two infrastructure maps and compute the differences
    ///
    /// This method identifies added, removed, and updated API endpoints by comparing
    /// the source and target endpoint maps.
    ///
    /// # Arguments
    /// * `self_endpoints` - HashMap of source API endpoints to compare from
    /// * `target_endpoints` - HashMap of target API endpoints to compare against
    /// * `api_changes` - Mutable vector to collect the identified changes
    ///
    /// # Returns
    /// A tuple of (additions, removals, updates) counts
    fn diff_api_endpoints(
        self_endpoints: &HashMap<String, ApiEndpoint>,
        target_endpoints: &HashMap<String, ApiEndpoint>,
        api_changes: &mut Vec<ApiChange>,
    ) -> (usize, usize, usize) {
        tracing::info!("Analyzing changes in API Endpoints...");
        let mut endpoint_updates = 0;
        let mut endpoint_removals = 0;
        let mut endpoint_additions = 0;

        for (id, endpoint) in self_endpoints {
            if let Some(target_endpoint) = target_endpoints.get(id) {
                if !api_endpoints_equal_ignore_metadata(endpoint, target_endpoint) {
                    tracing::debug!("API Endpoint updated: {}", id);
                    endpoint_updates += 1;
                    api_changes.push(ApiChange::ApiEndpoint(Change::<ApiEndpoint>::Updated {
                        before: Box::new(endpoint.clone()),
                        after: Box::new(target_endpoint.clone()),
                    }));
                }
            } else {
                tracing::debug!("API Endpoint removed: {}", id);
                endpoint_removals += 1;
                api_changes.push(ApiChange::ApiEndpoint(Change::<ApiEndpoint>::Removed(
                    Box::new(endpoint.clone()),
                )));
            }
        }

        for (id, endpoint) in target_endpoints {
            if !self_endpoints.contains_key(id) {
                tracing::debug!("API Endpoint added: {}", id);
                endpoint_additions += 1;
                api_changes.push(ApiChange::ApiEndpoint(Change::<ApiEndpoint>::Added(
                    Box::new(endpoint.clone()),
                )));
            }
        }

        tracing::info!(
            "API Endpoint changes: {} added, {} removed, {} updated",
            endpoint_additions,
            endpoint_removals,
            endpoint_updates
        );

        (endpoint_additions, endpoint_removals, endpoint_updates)
    }

    /// Compare WebApps between two infrastructure maps and compute the differences
    ///
    /// This method identifies added, removed, and updated WebApps by comparing
    /// the source and target WebApp maps.
    ///
    /// # Arguments
    /// * `self_web_apps` - HashMap of source WebApps to compare from
    /// * `target_web_apps` - HashMap of target WebApps to compare against
    /// * `web_app_changes` - Mutable vector to collect the identified changes
    ///
    /// # Returns
    /// A tuple of (additions, removals, updates) counts
    fn diff_web_apps(
        self_web_apps: &HashMap<String, super::infrastructure::web_app::WebApp>,
        target_web_apps: &HashMap<String, super::infrastructure::web_app::WebApp>,
        web_app_changes: &mut Vec<WebAppChange>,
    ) -> (usize, usize, usize) {
        tracing::info!("Analyzing changes in WebApps...");
        let mut webapp_updates = 0;
        let mut webapp_removals = 0;
        let mut webapp_additions = 0;

        for (id, webapp) in self_web_apps {
            if let Some(target_webapp) = target_web_apps.get(id) {
                if webapp != target_webapp {
                    tracing::debug!("WebApp updated: {}", id);
                    webapp_updates += 1;
                    web_app_changes.push(WebAppChange::WebApp(Change::Updated {
                        before: Box::new(webapp.clone()),
                        after: Box::new(target_webapp.clone()),
                    }));
                }
            } else {
                tracing::debug!("WebApp removed: {}", id);
                webapp_removals += 1;
                web_app_changes.push(WebAppChange::WebApp(Change::Removed(Box::new(
                    webapp.clone(),
                ))));
            }
        }

        for (id, webapp) in target_web_apps {
            if !self_web_apps.contains_key(id) {
                tracing::debug!("WebApp added: {}", id);
                webapp_additions += 1;
                web_app_changes.push(WebAppChange::WebApp(Change::Added(Box::new(
                    webapp.clone(),
                ))));
            }
        }

        tracing::info!(
            "WebApp changes: {} added, {} removed, {} updated",
            webapp_additions,
            webapp_removals,
            webapp_updates
        );

        (webapp_additions, webapp_removals, webapp_updates)
    }

    /// Compare views between two infrastructure maps and compute the differences
    ///
    /// This method identifies added, removed, and updated views by comparing
    /// the source and target view maps.
    ///
    /// # Arguments
    /// * `self_views` - HashMap of source views to compare from
    /// * `target_views` - HashMap of target views to compare against
    /// * `olap_changes` - Mutable vector to collect the identified changes
    ///
    /// # Returns
    /// A tuple of (additions, removals, updates) counts
    fn diff_dmv1_views(
        self_views: &HashMap<String, Dmv1View>,
        target_views: &HashMap<String, Dmv1View>,
        olap_changes: &mut Vec<OlapChange>,
    ) -> (usize, usize, usize) {
        tracing::info!("Analyzing changes in Views...");
        let mut view_updates = 0;
        let mut view_removals = 0;
        let mut view_additions = 0;

        // Check for updates and removals
        for (id, view) in self_views {
            if let Some(target_view) = target_views.get(id) {
                if view != target_view {
                    tracing::debug!("Dmv1View updated: {} ({})", view.name, id);
                    view_updates += 1;
                    olap_changes.push(OlapChange::Dmv1View(Change::Updated {
                        before: Box::new(view.clone()),
                        after: Box::new(target_view.clone()),
                    }));
                }
            } else {
                tracing::debug!("Dmv1View removed: {} ({})", view.name, id);
                view_removals += 1;
                olap_changes.push(OlapChange::Dmv1View(Change::Removed(Box::new(
                    view.clone(),
                ))));
            }
        }

        // Check for additions
        for (id, view) in target_views {
            if !self_views.contains_key(id) {
                tracing::debug!("Dmv1View added: {} ({})", view.name, id);
                view_additions += 1;
                olap_changes.push(OlapChange::Dmv1View(Change::Added(Box::new(view.clone()))));
            }
        }

        tracing::info!(
            "View changes: {} added, {} removed, {} updated",
            view_additions,
            view_removals,
            view_updates
        );

        (view_additions, view_removals, view_updates)
    }

    /// Diff all process-related changes between two infrastructure maps
    ///
    /// This orchestrates diffing for all process types by calling specialized functions
    fn diff_all_processes(
        &self,
        target_map: &InfrastructureMap,
        process_changes: &mut Vec<ProcessChange>,
    ) {
        Self::diff_topic_to_table_sync_processes(
            &self.topic_to_table_sync_processes,
            &target_map.topic_to_table_sync_processes,
            process_changes,
        );

        Self::diff_topic_to_topic_sync_processes(
            &self.topic_to_topic_sync_processes,
            &target_map.topic_to_topic_sync_processes,
            process_changes,
        );

        Self::diff_function_processes(
            &self.function_processes,
            &target_map.function_processes,
            process_changes,
        );

        Self::diff_consumption_api_processes(
            &self.consumption_api_web_server,
            &target_map.consumption_api_web_server,
            process_changes,
        );

        Self::diff_orchestration_workers(
            &self.orchestration_workers,
            &target_map.orchestration_workers,
            process_changes,
        );
    }

    /// Compare workflows between two infrastructure maps and compute the differences
    ///
    /// This method identifies added, removed, and updated workflows by comparing
    /// the source and target workflow maps. A workflow is considered updated when
    /// its configuration (schedule, retries, timeout) has changed.
    ///
    /// # Arguments
    /// * `self_workflows` - HashMap of source workflows to compare from
    /// * `target_workflows` - HashMap of target workflows to compare against
    /// * `workflow_changes` - Mutable vector to collect the identified changes
    ///
    /// # Returns
    /// A tuple of (additions, removals, updates) counts
    fn diff_workflows(
        self_workflows: &HashMap<String, Workflow>,
        target_workflows: &HashMap<String, Workflow>,
        workflow_changes: &mut Vec<WorkflowChange>,
    ) -> (usize, usize, usize) {
        tracing::info!("Analyzing changes in Workflows...");
        let mut workflow_updates = 0;
        let mut workflow_removals = 0;
        let mut workflow_additions = 0;

        for (id, workflow) in self_workflows {
            if let Some(target_workflow) = target_workflows.get(id) {
                if !workflows_config_equal(workflow, target_workflow) {
                    tracing::debug!("Workflow updated: {}", id);
                    workflow_updates += 1;
                    workflow_changes.push(WorkflowChange::Workflow(Change::<Workflow>::Updated {
                        before: Box::new(workflow.clone()),
                        after: Box::new(target_workflow.clone()),
                    }));
                }
            } else {
                tracing::debug!("Workflow removed: {}", id);
                workflow_removals += 1;
                workflow_changes.push(WorkflowChange::Workflow(Change::<Workflow>::Removed(
                    Box::new(workflow.clone()),
                )));
            }
        }

        for (id, workflow) in target_workflows {
            if !self_workflows.contains_key(id) {
                tracing::debug!("Workflow added: {}", id);
                workflow_additions += 1;
                workflow_changes.push(WorkflowChange::Workflow(Change::<Workflow>::Added(
                    Box::new(workflow.clone()),
                )));
            }
        }

        tracing::info!(
            "Workflow changes: {} added, {} removed, {} updated",
            workflow_additions,
            workflow_removals,
            workflow_updates
        );

        (workflow_additions, workflow_removals, workflow_updates)
    }

    /// Compare TopicToTableSyncProcess changes between two infrastructure maps
    fn diff_topic_to_table_sync_processes(
        self_processes: &HashMap<String, TopicToTableSyncProcess>,
        target_processes: &HashMap<String, TopicToTableSyncProcess>,
        process_changes: &mut Vec<ProcessChange>,
    ) -> (usize, usize, usize) {
        tracing::info!("Analyzing changes in Topic-to-Table Sync Processes...");
        let mut process_updates = 0;
        let mut process_removals = 0;
        let mut process_additions = 0;

        for (id, process) in self_processes {
            if let Some(target_process) = target_processes.get(id) {
                if process != target_process {
                    tracing::debug!("TopicToTableSyncProcess updated: {}", id);
                    process_updates += 1;
                    process_changes.push(ProcessChange::TopicToTableSyncProcess(Change::<
                        TopicToTableSyncProcess,
                    >::Updated {
                        before: Box::new(process.clone()),
                        after: Box::new(target_process.clone()),
                    }));
                }
            } else {
                tracing::debug!("TopicToTableSyncProcess removed: {}", id);
                process_removals += 1;
                process_changes.push(ProcessChange::TopicToTableSyncProcess(Change::<
                    TopicToTableSyncProcess,
                >::Removed(
                    Box::new(process.clone()),
                )));
            }
        }

        for (id, process) in target_processes {
            if !self_processes.contains_key(id) {
                tracing::debug!("TopicToTableSyncProcess added: {}", id);
                process_additions += 1;
                process_changes.push(ProcessChange::TopicToTableSyncProcess(Change::<
                    TopicToTableSyncProcess,
                >::Added(
                    Box::new(process.clone()),
                )));
            }
        }

        tracing::info!(
            "Topic-to-Table Sync Process changes: {} added, {} removed, {} updated",
            process_additions,
            process_removals,
            process_updates
        );

        (process_additions, process_removals, process_updates)
    }

    /// Compare TopicToTopicSyncProcess changes between two infrastructure maps
    fn diff_topic_to_topic_sync_processes(
        self_processes: &HashMap<String, TopicToTopicSyncProcess>,
        target_processes: &HashMap<String, TopicToTopicSyncProcess>,
        process_changes: &mut Vec<ProcessChange>,
    ) -> (usize, usize, usize) {
        tracing::info!("Analyzing changes in Topic-to-Topic Sync Processes...");
        let mut process_updates = 0;
        let mut process_removals = 0;
        let mut process_additions = 0;

        for (id, process) in self_processes {
            if let Some(target_process) = target_processes.get(id) {
                if process != target_process {
                    tracing::debug!("TopicToTopicSyncProcess updated: {}", id);
                    process_updates += 1;
                    process_changes.push(ProcessChange::TopicToTopicSyncProcess(Change::<
                        TopicToTopicSyncProcess,
                    >::Updated {
                        before: Box::new(process.clone()),
                        after: Box::new(target_process.clone()),
                    }));
                }
            } else {
                tracing::debug!("TopicToTopicSyncProcess removed: {}", id);
                process_removals += 1;
                process_changes.push(ProcessChange::TopicToTopicSyncProcess(Change::<
                    TopicToTopicSyncProcess,
                >::Removed(
                    Box::new(process.clone()),
                )));
            }
        }

        for (id, process) in target_processes {
            if !self_processes.contains_key(id) {
                tracing::debug!("TopicToTopicSyncProcess added: {}", id);
                process_additions += 1;
                process_changes.push(ProcessChange::TopicToTopicSyncProcess(Change::<
                    TopicToTopicSyncProcess,
                >::Added(
                    Box::new(process.clone()),
                )));
            }
        }

        tracing::info!(
            "Topic-to-Topic Sync Process changes: {} added, {} removed, {} updated",
            process_additions,
            process_removals,
            process_updates
        );

        (process_additions, process_removals, process_updates)
    }

    /// Compare FunctionProcess changes between two infrastructure maps
    fn diff_function_processes(
        self_processes: &HashMap<String, FunctionProcess>,
        target_processes: &HashMap<String, FunctionProcess>,
        process_changes: &mut Vec<ProcessChange>,
    ) -> (usize, usize, usize) {
        tracing::info!("Analyzing changes in Function Processes...");
        let mut process_updates = 0;
        let mut process_removals = 0;
        let mut process_additions = 0;

        for (id, process) in self_processes {
            if let Some(target_process) = target_processes.get(id) {
                // Always treat function processes as updated if they exist in both maps
                // This ensures function code changes are always redeployed
                tracing::debug!("FunctionProcess updated (forced): {}", id);
                process_updates += 1;
                process_changes.push(ProcessChange::FunctionProcess(
                    Change::<FunctionProcess>::Updated {
                        before: Box::new(process.clone()),
                        after: Box::new(target_process.clone()),
                    },
                ));
            } else {
                tracing::debug!("FunctionProcess removed: {}", id);
                process_removals += 1;
                process_changes.push(ProcessChange::FunctionProcess(
                    Change::<FunctionProcess>::Removed(Box::new(process.clone())),
                ));
            }
        }

        for (id, process) in target_processes {
            if !self_processes.contains_key(id) {
                tracing::debug!("FunctionProcess added: {}", id);
                process_additions += 1;
                process_changes.push(ProcessChange::FunctionProcess(
                    Change::<FunctionProcess>::Added(Box::new(process.clone())),
                ));
            }
        }

        tracing::info!(
            "Function Process changes: {} added, {} removed, {} updated",
            process_additions,
            process_removals,
            process_updates
        );

        (process_additions, process_removals, process_updates)
    }

    /// Compare Consumption API process changes between two infrastructure maps
    fn diff_consumption_api_processes(
        self_process: &ConsumptionApiWebServer,
        target_process: &ConsumptionApiWebServer,
        process_changes: &mut Vec<ProcessChange>,
    ) {
        tracing::info!("Analyzing changes in Analytics API processes...");

        // We are currently not tracking individual consumption endpoints, so we will just restart
        // the consumption web server when something changed
        tracing::debug!("Analytics API Web Server updated (assumed for now)");
        process_changes.push(ProcessChange::ConsumptionApiWebServer(Change::<
            ConsumptionApiWebServer,
        >::Updated {
            before: Box::new(self_process.clone()),
            after: Box::new(target_process.clone()),
        }));
    }

    /// Compare OrchestrationWorker changes between two infrastructure maps
    fn diff_orchestration_workers(
        self_workers: &HashMap<String, OrchestrationWorker>,
        target_workers: &HashMap<String, OrchestrationWorker>,
        process_changes: &mut Vec<ProcessChange>,
    ) -> (usize, usize, usize) {
        tracing::info!("Analyzing changes in Orchestration Workers...");
        let mut worker_updates = 0;
        let mut worker_removals = 0;
        let mut worker_additions = 0;

        for (id, worker) in self_workers {
            if let Some(target_worker) = target_workers.get(id) {
                // Always treat workers as updated to ensure redeployment
                tracing::debug!(
                    "OrchestrationWorker updated (forced): {} ({})",
                    id,
                    worker.supported_language
                );
                worker_updates += 1;
                process_changes.push(ProcessChange::OrchestrationWorker(Change::<
                    OrchestrationWorker,
                >::Updated {
                    before: Box::new(worker.clone()),
                    after: Box::new(target_worker.clone()),
                }));
            } else {
                tracing::debug!(
                    "OrchestrationWorker removed: {} ({})",
                    id,
                    worker.supported_language
                );
                worker_removals += 1;
                process_changes.push(ProcessChange::OrchestrationWorker(Change::<
                    OrchestrationWorker,
                >::Removed(
                    Box::new(worker.clone()),
                )));
            }
        }

        for (id, worker) in target_workers {
            if !self_workers.contains_key(id) {
                tracing::debug!(
                    "OrchestrationWorker added: {} ({})",
                    id,
                    worker.supported_language
                );
                worker_additions += 1;
                process_changes.push(ProcessChange::OrchestrationWorker(Change::<
                    OrchestrationWorker,
                >::Added(
                    Box::new(worker.clone()),
                )));
            }
        }

        tracing::info!(
            "Orchestration Worker changes: {} added, {} removed, {} updated",
            worker_additions,
            worker_removals,
            worker_updates
        );

        (worker_additions, worker_removals, worker_updates)
    }

    /// Compare SQL resources between two infrastructure maps and compute the differences
    ///
    /// This method identifies added, removed, and updated SQL resources by comparing
    /// the source and target SQL resource maps.
    ///
    /// Changes are collected in the provided changes vector with detailed logging
    /// of what has changed.
    ///
    /// Note: MV population detection is no longer done here. Moose-lib generated MVs
    /// are now emitted as structured MaterializedView types, and old SqlResource MVs
    /// are converted by normalize(). Population is handled by diff_materialized_views().
    ///
    /// # Arguments
    /// * `self_sql_resources` - HashMap of source SQL resources to compare from
    /// * `target_sql_resources` - HashMap of target SQL resources to compare against
    /// * `olap_changes` - Mutable vector to collect the identified changes
    fn diff_sql_resources(
        self_sql_resources: &HashMap<String, SqlResource>,
        target_sql_resources: &HashMap<String, SqlResource>,
        olap_changes: &mut Vec<OlapChange>,
    ) {
        tracing::info!(
            "Analyzing SQL resource differences between {} source resources and {} target resources",
            self_sql_resources.len(),
            target_sql_resources.len()
        );

        let mut sql_resource_updates = 0;
        let mut sql_resource_removals = 0;
        let mut sql_resource_additions = 0;

        for (id, sql_resource) in self_sql_resources {
            if let Some(target_sql_resource) = target_sql_resources.get(id) {
                if sql_resource != target_sql_resource {
                    // TODO: if only the teardown code changed, we should not need to execute any changes
                    tracing::debug!("SQL resource '{}' has differences", id);
                    sql_resource_updates += 1;
                    olap_changes.push(OlapChange::SqlResource(Change::Updated {
                        before: Box::new(sql_resource.clone()),
                        after: Box::new(target_sql_resource.clone()),
                    }));
                    // Note: MV population check is no longer needed here.
                    // Moose-lib generated MVs are now emitted as structured MaterializedView types.
                    // Old SqlResource MVs are converted by normalize() to MaterializedView.
                    // Population is handled by diff_materialized_views().
                }
            } else {
                tracing::debug!("SQL resource '{}' removed", id);
                sql_resource_removals += 1;
                olap_changes.push(OlapChange::SqlResource(Change::Removed(Box::new(
                    sql_resource.clone(),
                ))));
            }
        }

        for (id, sql_resource) in target_sql_resources {
            if !self_sql_resources.contains_key(id) {
                tracing::debug!("SQL resource '{}' added", id);
                sql_resource_additions += 1;
                olap_changes.push(OlapChange::SqlResource(Change::Added(Box::new(
                    sql_resource.clone(),
                ))));
                // Note: MV population check is no longer needed here.
                // Moose-lib generated MVs are now emitted as structured MaterializedView types.
                // Old SqlResource MVs are converted by normalize() to MaterializedView.
                // Population is handled by diff_materialized_views().
            }
        }

        tracing::info!(
            "SQL resource changes: {} added, {} removed, {} updated",
            sql_resource_additions,
            sql_resource_removals,
            sql_resource_updates
        );
    }

    /// Compare materialized views between two infrastructure maps and compute the differences
    ///
    /// Uses semantic equivalence checking to avoid false positives from formatting differences,
    /// whitespace changes, or database prefix variations.
    ///
    /// # Arguments
    /// * `self_mvs` - HashMap of source materialized views
    /// * `target_mvs` - HashMap of target materialized views
    /// * `tables` - HashMap of target tables (for checking if source tables are S3Queue/Kafka)
    /// * `is_production` - Whether we're in production mode (population only in dev)
    /// * `default_database` - Default database name for normalization
    /// * `olap_changes` - Mutable vector to collect the identified changes
    pub fn diff_materialized_views(
        self_mvs: &HashMap<String, MaterializedView>,
        target_mvs: &HashMap<String, MaterializedView>,
        tables: &HashMap<String, Table>,
        is_production: bool,
        default_database: &str,
        olap_changes: &mut Vec<OlapChange>,
    ) {
        use crate::framework::core::infra_reality_checker::materialized_views_are_equivalent;

        tracing::info!(
            "Analyzing materialized view differences between {} source MVs and {} target MVs",
            self_mvs.len(),
            target_mvs.len()
        );

        let mut mv_updates = 0;
        let mut mv_removals = 0;
        let mut mv_additions = 0;

        for (id, mv) in self_mvs {
            if let Some(target_mv) = target_mvs.get(id) {
                // Use semantic equivalence check instead of plain !=
                if !materialized_views_are_equivalent(mv, target_mv, default_database) {
                    tracing::debug!("Materialized view '{}' has differences", id);
                    mv_updates += 1;
                    olap_changes.push(OlapChange::MaterializedView(Change::Updated {
                        before: Box::new(mv.clone()),
                        after: Box::new(target_mv.clone()),
                    }));

                    // Check if updated MV needs population (only in dev)
                    // Pass true to populate - updated MVs need their data refreshed
                    Self::check_materialized_view_population(
                        target_mv,
                        tables,
                        true, // should_populate
                        is_production,
                        olap_changes,
                    );
                }
            } else {
                tracing::debug!("Materialized view '{}' removed", id);
                mv_removals += 1;
                olap_changes.push(OlapChange::MaterializedView(Change::Removed(Box::new(
                    mv.clone(),
                ))));
            }
        }

        for (id, mv) in target_mvs {
            if !self_mvs.contains_key(id) {
                tracing::debug!("Materialized view '{}' added", id);
                mv_additions += 1;
                olap_changes.push(OlapChange::MaterializedView(Change::Added(Box::new(
                    mv.clone(),
                ))));

                // Check if new MV needs population (only in dev)
                Self::check_materialized_view_population(
                    mv,
                    tables,
                    true, // should_populate
                    is_production,
                    olap_changes,
                );
            }
        }

        tracing::info!(
            "Materialized view changes: {} added, {} removed, {} updated",
            mv_additions,
            mv_removals,
            mv_updates
        );
    }

    /// Check if a materialized view needs initial population
    ///
    /// Population is only done in dev mode and when source tables are not S3Queue or Kafka
    /// (since those don't support SELECT queries for backfill).
    fn check_materialized_view_population(
        mv: &MaterializedView,
        tables: &HashMap<String, Table>,
        should_populate: bool,
        is_production: bool,
        olap_changes: &mut Vec<OlapChange>,
    ) {
        use crate::infrastructure::olap::clickhouse::diff_strategy::ClickHouseTableDiffStrategy;

        /// Helper to parse a table reference string (e.g., "`table`" or "`database`.`table`")
        /// and return the database and table names with backticks removed.
        fn parse_table_reference(table_ref: &str) -> (Option<String>, String) {
            let cleaned = table_ref.replace('`', "");
            let parts: Vec<&str> = cleaned.split('.').collect();
            match parts.as_slice() {
                [table] => (None, table.to_string()),
                [database, table] => (Some(database.to_string()), table.to_string()),
                _ => (None, cleaned),
            }
        }

        // Check if any source table is S3Queue or Kafka (which don't support SELECT)
        let has_unpopulatable_source = mv.source_tables.iter().any(|source_table| {
            // Parse the table reference and extract just the table name
            let (_db, table_name) = parse_table_reference(source_table);

            // Search by matching the actual Table.name field
            // This is the most reliable way since table HashMap keys include database and version
            if let Some((_key, table)) = tables.iter().find(|(_, t)| t.name == table_name) {
                return ClickHouseTableDiffStrategy::is_s3queue_table(table)
                    || ClickHouseTableDiffStrategy::is_kafka_table(table);
            }

            false
        });

        // Only populate if requested and in dev mode with supported source tables
        if should_populate && !has_unpopulatable_source && !is_production {
            tracing::info!(
                "Adding population operation for materialized view '{}'",
                mv.name
            );

            olap_changes.push(OlapChange::PopulateMaterializedView {
                view_name: mv.name.clone(),
                target_table: mv.target_table.clone(),
                target_database: mv.target_database.clone(),
                select_statement: mv.select_sql.clone(),
                source_tables: mv.source_tables.clone(),
                should_truncate: true,
            });
        }
    }

    /// Compare views between two infrastructure maps and compute the differences
    ///
    /// Uses semantic equivalence checking to avoid false positives from formatting differences,
    /// whitespace changes, or database prefix variations.
    ///
    /// # Arguments
    /// * `self_views` - HashMap of source views
    /// * `target_views` - HashMap of target views
    /// * `default_database` - Default database name for normalization
    /// * `olap_changes` - Mutable vector to collect the identified changes
    pub fn diff_views(
        self_views: &HashMap<String, View>,
        target_views: &HashMap<String, View>,
        default_database: &str,
        olap_changes: &mut Vec<OlapChange>,
    ) {
        use crate::framework::core::infra_reality_checker::views_are_equivalent;

        tracing::info!(
            "Analyzing custom view differences between {} source views and {} target views",
            self_views.len(),
            target_views.len()
        );

        let mut view_updates = 0;
        let mut view_removals = 0;
        let mut view_additions = 0;

        for (id, view) in self_views {
            if let Some(target_view) = target_views.get(id) {
                // Use semantic equivalence check instead of plain !=
                if !views_are_equivalent(view, target_view, default_database) {
                    tracing::debug!("Custom view '{}' has differences", id);
                    view_updates += 1;
                    olap_changes.push(OlapChange::View(Change::Updated {
                        before: Box::new(view.clone()),
                        after: Box::new(target_view.clone()),
                    }));
                }
            } else {
                tracing::debug!("Custom view '{}' removed", id);
                view_removals += 1;
                olap_changes.push(OlapChange::View(Change::Removed(Box::new(view.clone()))));
            }
        }

        for (id, view) in target_views {
            if !self_views.contains_key(id) {
                tracing::debug!("Custom view '{}' added", id);
                view_additions += 1;
                olap_changes.push(OlapChange::View(Change::Added(Box::new(view.clone()))));
            }
        }

        tracing::info!(
            "Custom view changes: {} added, {} removed, {} updated",
            view_additions,
            view_removals,
            view_updates
        );
    }

    /// Compare tables between two infrastructure maps and compute the differences
    ///
    /// This method identifies added, removed, and updated tables by comparing
    /// the source and target table maps. For updated tables, it performs a detailed
    /// analysis of column-level changes and uses the provided strategy to determine
    /// the appropriate operations based on database capabilities.
    ///
    /// Changes are collected in the provided changes vector with detailed logging
    /// of what has changed.
    ///
    /// # Arguments
    /// * `self_tables` - HashMap of source tables to compare from
    /// * `target_tables` - HashMap of target tables to compare against
    /// * `olap_changes` - Mutable vector to collect the identified changes
    /// * `filtered_changes` - Mutable vector to collect changes blocked by lifecycle policies
    /// * `strategy` - Strategy for handling database-specific table diffing logic
    /// * `default_database` - The configured default database name
    /// * `ignore_ops` - Operations to ignore during comparison (e.g., ModifyPartitionBy)
    #[allow(clippy::too_many_arguments)]
    fn diff_tables_with_strategy(
        self_tables: &HashMap<String, Table>,
        target_tables: &HashMap<String, Table>,
        olap_changes: &mut Vec<OlapChange>,
        filtered_changes: &mut Vec<FilteredChange>,
        strategy: &dyn TableDiffStrategy,
        respect_life_cycle: bool,
        default_database: &str,
        ignore_ops: &[crate::infrastructure::olap::clickhouse::IgnorableOperation],
    ) {
        tracing::info!(
            "Analyzing table differences between {} source tables and {} target tables",
            self_tables.len(),
            target_tables.len()
        );

        // Normalize tables for comparison if ignore_ops is provided
        let (normalized_self, normalized_target) = if !ignore_ops.is_empty() {
            tracing::info!(
                "Normalizing tables before comparison. Ignore list: {:?}",
                ignore_ops
            );
            let normalized_self: HashMap<String, Table> = self_tables
                .iter()
                .map(|(name, table)| {
                    (
                        name.clone(),
                        crate::infrastructure::olap::clickhouse::normalize_table_for_diff(
                            table, ignore_ops,
                        ),
                    )
                })
                .collect();
            let normalized_target: HashMap<String, Table> = target_tables
                .iter()
                .map(|(name, table)| {
                    (
                        name.clone(),
                        crate::infrastructure::olap::clickhouse::normalize_table_for_diff(
                            table, ignore_ops,
                        ),
                    )
                })
                .collect();
            (normalized_self, normalized_target)
        } else {
            (self_tables.clone(), target_tables.clone())
        };

        let mut table_updates = 0;
        let mut table_removals = 0;
        let mut table_additions = 0;

        // Use normalized tables for comparison, but original tables for changes
        // Iterate over key-value pairs to preserve the HashMap key for lookups
        for (key, normalized_table) in normalized_self.iter() {
            // self_tables can be from remote where the keys are IDs with another database prefix
            // but they are then the default database,
            //   the `database` field is None and we build the ID ourselves
            if let Some(normalized_target) =
                normalized_target.get(&normalized_table.id(default_database))
            {
                if !tables_equal_ignore_metadata(normalized_table, normalized_target) {
                    // Get original tables for use in changes using the HashMap key
                    // not the computed ID, since remote keys may differ from computed IDs
                    let table = self_tables
                        .get(key)
                        .expect("normalized_self and self_tables should have same keys");
                    let target_table = target_tables
                        .get(&normalized_target.id(default_database))
                        .expect("normalized_target exists, so target_table should too");

                    // Respect lifecycle: ExternallyManaged tables are never modified
                    if target_table.life_cycle == LifeCycle::ExternallyManaged && respect_life_cycle
                    {
                        tracing::debug!(
                            "Table '{}' has changes but is externally managed - skipping update",
                            table.name
                        );
                        // Record the blocked update in filtered_changes for user visibility
                        let column_changes = compute_table_columns_diff(table, target_table, ignore_ops);
                        let order_by_change = OrderByChange {
                            before: table.order_by.clone(),
                            after: target_table.order_by.clone(),
                        };
                        let partition_by_change = PartitionByChange {
                            before: normalized_table.partition_by.clone(),
                            after: normalized_target.partition_by.clone(),
                        };
                        filtered_changes.push(FilteredChange {
                            change: OlapChange::Table(TableChange::Updated {
                                name: table.name.clone(),
                                column_changes,
                                order_by_change,
                                partition_by_change,
                                before: table.clone(),
                                after: target_table.clone(),
                            }),
                            reason: format!(
                                "Table '{}' has ExternallyManaged lifecycle - update blocked",
                                table.display_name()
                            ),
                        });
                    } else {
                        // Compute the basic diff components
                        let column_changes =
                            compute_table_columns_diff(table, target_table, ignore_ops);

                        // Compute PARTITION BY changes from normalized tables to respect ignore_ops
                        // Using normalized tables ensures that ignored operations don't incorrectly
                        // trigger drop+create when only non-ignored changes exist
                        let partition_by_changed =
                            normalized_table.partition_by != normalized_target.partition_by;
                        let partition_by_change = PartitionByChange {
                            before: normalized_table.partition_by.clone(),
                            after: normalized_target.partition_by.clone(),
                        };
                        let order_by_changed = !table.order_by_equals(target_table);

                        // Detect engine change (e.g., MergeTree -> ReplacingMergeTree)
                        let engine_changed = table.engine != target_table.engine;

                        // Note: We intentionally do NOT check for cluster_name changes here.
                        // cluster_name is a deployment directive (how to run DDL), not a schema property.
                        // The inframap will be updated with the new cluster_name value, and future DDL
                        // operations will use it, but changing cluster_name doesn't trigger operations.

                        let order_by_change = if order_by_changed {
                            OrderByChange {
                                before: table.order_by.clone(),
                                after: target_table.order_by.clone(),
                            }
                        } else {
                            OrderByChange {
                                before: OrderBy::Fields(vec![]),
                                after: OrderBy::Fields(vec![]),
                            }
                        };

                        // Detect index changes (secondary/data-skipping indexes)
                        let indexes_changed = table.indexes != target_table.indexes;

                        // Detect and emit table-level TTL changes
                        // Use normalized comparison to avoid false positives from ClickHouse's TTL normalization
                        if !ttl_expressions_are_equivalent(
                            &normalized_table.table_ttl_setting,
                            &normalized_target.table_ttl_setting,
                        ) {
                            tracing::debug!(
                                "Table '{}' has table-level TTL change: {:?} -> {:?}",
                                table.name,
                                table.table_ttl_setting,
                                target_table.table_ttl_setting
                            );
                            olap_changes.push(OlapChange::Table(TableChange::TtlChanged {
                                name: table.name.clone(),
                                before: table.table_ttl_setting.clone(),
                                after: target_table.table_ttl_setting.clone(),
                                table: target_table.clone(),
                            }));
                            table_updates += 1;
                        }

                        // Column-level TTL changes are handled as regular column modifications
                        // since ClickHouse requires the full column definition when modifying TTL

                        let table_settings_changed =
                            table.table_settings != target_table.table_settings;

                        // Only process changes if there are actual differences to report
                        // Note: cluster_name changes are intentionally excluded - they don't trigger operations
                        if !column_changes.is_empty()
                            || order_by_changed
                            || partition_by_changed
                            || engine_changed
                            || indexes_changed
                            || table_settings_changed
                        {
                            // Use the strategy to determine the appropriate changes
                            let strategy_changes = strategy.diff_table_update(
                                table,
                                target_table,
                                column_changes,
                                order_by_change,
                                partition_by_change,
                                default_database,
                            );

                            // Apply lifecycle filtering to respect lifecycle constraints
                            // This handles both:
                            // 1. Strategies that convert updates to drop+create (blocks both Removed AND Added for protected tables)
                            // 2. Strategies that return Updated (filters out column removals for DeletionProtected tables)
                            let applied_changes: Vec<OlapChange> = if respect_life_cycle {
                                let filter_result = lifecycle_filter::apply_lifecycle_filter(
                                    strategy_changes,
                                    target_table,
                                    default_database,
                                );
                                filtered_changes.extend(filter_result.filtered);
                                filter_result.applied
                            } else {
                                strategy_changes
                            };

                            // Only count as a table update if the strategy returned actual operations
                            if !applied_changes.is_empty() {
                                table_updates += 1;
                                olap_changes.extend(applied_changes);
                            }
                        }
                    }
                }
            } else {
                // Get original table for removal using the HashMap key
                let table = self_tables
                    .get(key)
                    .expect("normalized_self and self_tables should have same keys");
                // Respect lifecycle: DeletionProtected and ExternallyManaged tables are never removed
                match (table.life_cycle, respect_life_cycle) {
                    (LifeCycle::FullyManaged, _) | (_, false) => {
                        tracing::debug!("Table '{}' removed", table.name);
                        table_removals += 1;
                        olap_changes.push(OlapChange::Table(TableChange::Removed(table.clone())));
                    }
                    (LifeCycle::DeletionProtected, true) => {
                        tracing::debug!(
                            "Table '{}' marked for removal but is deletion-protected - skipping removal",
                            table.display_name()
                        );
                        filtered_changes.push(FilteredChange {
                            change: OlapChange::Table(TableChange::Removed(table.clone())),
                            reason: format!(
                                "Table '{}' has DeletionProtected lifecycle - removal blocked",
                                table.display_name()
                            ),
                        });
                    }
                    (LifeCycle::ExternallyManaged, true) => {
                        tracing::debug!(
                            "Table '{}' marked for removal but is externally managed - skipping removal",
                            table.display_name()
                        );
                        filtered_changes.push(FilteredChange {
                            change: OlapChange::Table(TableChange::Removed(table.clone())),
                            reason: format!(
                                "Table '{}' has ExternallyManaged lifecycle - removal blocked",
                                table.display_name()
                            ),
                        });
                    }
                }
            }
        }

        // Check for additions using normalized tables for comparison, but add original tables
        for table in target_tables.values() {
            if find_table_from_infra_map(table, &normalized_self, default_database).is_none() {
                // Respect lifecycle: ExternallyManaged tables are never added automatically
                if table.life_cycle == LifeCycle::ExternallyManaged && respect_life_cycle {
                    tracing::debug!(
                        "Table '{}' marked for addition but is externally managed - skipping addition",
                        table.name
                    );
                    // Record the blocked addition in filtered_changes for user visibility
                    filtered_changes.push(FilteredChange {
                        change: OlapChange::Table(TableChange::Added(table.clone())),
                        reason: format!(
                            "Table '{}' has ExternallyManaged lifecycle - addition blocked",
                            table.display_name()
                        ),
                    });
                } else {
                    tracing::debug!(
                        "Table '{}' added with {} columns",
                        table.name,
                        table.columns.len()
                    );
                    for col in &table.columns {
                        tracing::trace!("  - Column: {} ({})", col.name, col.data_type);
                    }
                    table_additions += 1;
                    olap_changes.push(OlapChange::Table(TableChange::Added(table.clone())));
                }
            }
        }

        tracing::info!(
            "Table changes: {} added, {} removed, {} updated",
            table_additions,
            table_removals,
            table_updates
        );
    }

    // TODO: this function is only used for single-table `HashMap`s in check_reality
    // we should clean up the interface
    /// Compare tables between two infrastructure maps and compute the differences
    ///
    /// This is a backward-compatible version that uses the default table diff strategy.
    /// For database-specific behavior, use `diff_tables_with_strategy` instead.
    ///
    /// # Arguments
    /// * `self_tables` - HashMap of source tables to compare from
    /// * `target_tables` - HashMap of target tables to compare against
    /// * `olap_changes` - Mutable vector to collect the identified changes
    /// * `default_database` - The configured default database name
    pub fn diff_tables(
        self_tables: &HashMap<String, Table>,
        target_tables: &HashMap<String, Table>,
        olap_changes: &mut Vec<OlapChange>,
        respect_life_cycle: bool,
        default_database: &str,
    ) {
        let default_strategy = DefaultTableDiffStrategy;
        // Dummy filtered object to call the function
        // unused, see TODO note above
        let mut filtered = Vec::new();
        Self::diff_tables_with_strategy(
            self_tables,
            target_tables,
            olap_changes,
            &mut filtered,
            &default_strategy,
            respect_life_cycle,
            default_database,
            &[], // No ignore operations for backward compatibility
        );
    }

    /// Simple table comparison for backward compatibility
    ///
    /// Returns None if tables are identical, Some(TableChange) if they differ.
    /// This is a simplified version of the old diff_table method for use in
    /// places that just need to check if two tables are the same.
    ///
    /// # Arguments
    /// * `table` - The first table to compare
    /// * `target_table` - The second table to compare
    ///
    /// # Returns
    /// * `Option<TableChange>` - None if identical, Some(change) if different
    pub fn simple_table_diff(table: &Table, target_table: &Table) -> Option<TableChange> {
        if table == target_table {
            return None;
        }

        let column_changes = compute_table_columns_diff(table, target_table, &[]);
        let order_by_changed = !table.order_by_equals(target_table);

        let order_by_change = if order_by_changed {
            OrderByChange {
                before: table.order_by.clone(),
                after: target_table.order_by.clone(),
            }
        } else {
            OrderByChange {
                before: OrderBy::Fields(vec![]),
                after: OrderBy::Fields(vec![]),
            }
        };

        let partition_by_changed = table.partition_by != target_table.partition_by;
        let partition_by_change = PartitionByChange {
            before: table.partition_by.clone(),
            after: target_table.partition_by.clone(),
        };

        // Only return changes if there are actual differences to report
        // Detect index changes
        let indexes_changed = table.indexes != target_table.indexes;

        // Detect table-level TTL changes - use normalized comparison
        let ttl_changed = !ttl_expressions_are_equivalent(
            &table.table_ttl_setting,
            &target_table.table_ttl_setting,
        );

        if !column_changes.is_empty()
            || order_by_changed
            || partition_by_changed
            || indexes_changed
            || ttl_changed
        {
            Some(TableChange::Updated {
                name: table.name.clone(),
                column_changes,
                order_by_change,
                partition_by_change,
                before: table.clone(),
                after: target_table.clone(),
            })
        } else {
            None
        }
    }

    /// Simple table comparison with lifecycle-aware filtering for backward compatibility
    ///
    /// This method replicates the old diff_table_with_lifecycle behavior for tests.
    /// For DeletionProtected tables, it filters out destructive changes like column removals.
    ///
    /// # Arguments
    /// * `table` - The first table to compare
    /// * `target_table` - The second table to compare
    ///
    /// # Returns
    /// * `Option<TableChange>` - None if identical, Some(change) if different
    #[cfg(test)]
    fn simple_table_diff_with_lifecycle(
        table: &Table,
        target_table: &Table,
    ) -> Option<TableChange> {
        if table == target_table {
            return None;
        }

        let mut column_changes = compute_table_columns_diff(table, target_table, &[]);

        // For DeletionProtected tables, filter out destructive column changes
        if target_table.life_cycle == LifeCycle::DeletionProtected {
            let original_len = column_changes.len();
            column_changes.retain(|change| match change {
                ColumnChange::Removed(_) => {
                    tracing::debug!(
                        "Filtering out column removal for deletion-protected table '{}'",
                        table.name
                    );
                    false // Remove destructive column removals
                }
                ColumnChange::Added { .. } => true, // Allow additive changes
                ColumnChange::Updated { .. } => true, // Allow column updates
            });

            if original_len != column_changes.len() {
                tracing::info!(
                    "Filtered {} destructive column changes for deletion-protected table '{}'",
                    original_len - column_changes.len(),
                    table.name
                );
            }
        }

        let order_by_changed = !table.order_by_equals(target_table);

        let order_by_change = if order_by_changed {
            OrderByChange {
                before: table.order_by.clone(),
                after: target_table.order_by.clone(),
            }
        } else {
            OrderByChange {
                before: OrderBy::Fields(vec![]),
                after: OrderBy::Fields(vec![]),
            }
        };

        let partition_by_changed = table.partition_by != target_table.partition_by;
        let partition_by_change = PartitionByChange {
            before: table.partition_by.clone(),
            after: target_table.partition_by.clone(),
        };

        // Detect index changes
        let indexes_changed = table.indexes != target_table.indexes;

        // Detect table-level TTL changes - use normalized comparison
        let ttl_changed = !ttl_expressions_are_equivalent(
            &table.table_ttl_setting,
            &target_table.table_ttl_setting,
        );

        // Only return changes if there are actual differences to report
        if !column_changes.is_empty()
            || order_by_changed
            || partition_by_changed
            || indexes_changed
            || ttl_changed
        {
            Some(TableChange::Updated {
                name: table.name.clone(),
                column_changes,
                order_by_change,
                partition_by_change,
                before: table.clone(),
                after: target_table.clone(),
            })
        } else {
            None
        }
    }

    /// Serializes the infrastructure map to JSON and saves it to a file
    ///
    /// # Arguments
    /// * `path` - The path where the JSON file should be saved
    ///
    /// # Returns
    /// A Result indicating success or an IO error
    pub fn save_to_json(&self, path: &Path) -> Result<(), std::io::Error> {
        let json = serde_json::to_string(self)?;
        fs::write(path, json)
    }

    /// Loads an infrastructure map from a JSON file
    ///
    /// Canonicalizes tables to handle backward compatibility with JSON files
    /// created by older CLI versions (e.g., Docker images built before canonicalization).
    ///
    /// # Arguments
    /// * `path` - The path to the JSON file
    ///
    /// # Returns
    /// A Result containing either the loaded map or an IO error
    pub fn load_from_json(path: &Path) -> Result<Self, std::io::Error> {
        let json = fs::read_to_string(path)?;
        let infra_map: InfrastructureMap = serde_json::from_str(&json)?;
        Ok(infra_map.canonicalize_tables())
    }

    /// Resolves runtime environment variables for engine credentials and table settings.
    ///
    /// Must be called at runtime (dev/prod mode) rather than build time to avoid
    /// baking credentials into Docker images.
    pub fn resolve_runtime_credentials_from_env(&mut self) -> Result<(), String> {
        use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
        use crate::utilities::secrets::resolve_optional_runtime_env;

        for table in self.tables.values_mut() {
            let mut should_recalc_hash = false;

            // Helper closure to resolve AWS credentials for S3-based engines
            let resolve_aws_credentials = |access_key: &mut Option<String>,
                                           secret_key: &mut Option<String>,
                                           engine_name: &str|
             -> Result<(), String> {
                let resolved_access_key = resolve_optional_runtime_env(access_key).map_err(
                    |e| {
                        format!(
                            "Failed to resolve runtime environment variable for table '{}' field 'awsAccessKeyId': {}",
                            table.name, e
                        )
                    },
                )?;

                let resolved_secret_key = resolve_optional_runtime_env(secret_key).map_err(
                    |e| {
                        format!(
                            "Failed to resolve runtime environment variable for table '{}' field 'awsSecretAccessKey': {}",
                            table.name, e
                        )
                    },
                )?;

                *access_key = resolved_access_key;
                *secret_key = resolved_secret_key;

                tracing::debug!(
                    "Resolved {} credentials for table '{}' at runtime",
                    engine_name,
                    table.name
                );

                Ok(())
            };

            match &mut table.engine {
                ClickhouseEngine::S3Queue {
                    aws_access_key_id,
                    aws_secret_access_key,
                    ..
                } => {
                    resolve_aws_credentials(aws_access_key_id, aws_secret_access_key, "S3Queue")?;
                    should_recalc_hash = true;
                }
                ClickhouseEngine::S3 {
                    aws_access_key_id,
                    aws_secret_access_key,
                    ..
                } => {
                    resolve_aws_credentials(aws_access_key_id, aws_secret_access_key, "S3")?;
                    should_recalc_hash = true;
                }
                ClickhouseEngine::IcebergS3 {
                    aws_access_key_id,
                    aws_secret_access_key,
                    ..
                } => {
                    resolve_aws_credentials(aws_access_key_id, aws_secret_access_key, "IcebergS3")?;
                    should_recalc_hash = true;
                }
                _ => {
                    // No credentials to resolve for other engine types
                    // Kafka credentials are now in table_settings, not engine config
                }
            }

            // Recalculate engine_params_hash after resolving credentials
            if should_recalc_hash {
                table.engine_params_hash = Some(table.engine.non_alterable_params_hash());
                tracing::debug!(
                    "Recalculated engine_params_hash for table '{}' after credential resolution",
                    table.name
                );
            }

            // Resolve runtime environment variables in table_settings (e.g., Kafka security settings)
            let mut settings_changed = false;
            if let Some(ref mut settings) = table.table_settings {
                for (key, value) in settings.iter_mut() {
                    let resolved_value = resolve_optional_runtime_env(&Some(value.clone()))
                        .map_err(|e| {
                            format!(
                                "Failed to resolve runtime environment variable for table '{}' setting '{}': {}",
                                table.name, key, e
                            )
                        })?;

                    if let Some(new_value) = resolved_value {
                        if new_value != *value {
                            *value = new_value;
                            settings_changed = true;
                            tracing::debug!(
                                "Resolved setting '{}' for table '{}' from runtime environment",
                                key,
                                table.name
                            );
                        }
                    }
                }
            }

            // Recalculate table_settings_hash after resolving credentials (same as engine_params_hash)
            if settings_changed {
                table.table_settings_hash = table.compute_table_settings_hash();
                tracing::debug!(
                    "Recalculated table_settings_hash for table '{}' after credential resolution",
                    table.name
                );
            }
        }

        Ok(())
    }

    /// Stores the infrastructure map in Redis for persistence and sharing
    ///
    /// Serializes the map to protocol buffers and stores it in Redis using
    /// a service-specific prefix.
    ///
    /// # Arguments
    /// * `redis_client` - The Redis client to use for storage
    ///
    /// # Returns
    /// A Result indicating success or an error
    pub async fn store_in_redis(&self, redis_client: &RedisClient) -> Result<()> {
        let encoded: Vec<u8> = self.to_proto().write_to_bytes()?;
        redis_client
            .set_with_service_prefix("infrastructure_map", &encoded)
            .await
            .context("Failed to store InfrastructureMap in Redis")?;

        Ok(())
    }

    /// Loads an infrastructure map from Redis
    ///
    /// Attempts to retrieve the map from Redis and deserialize it from
    /// protocol buffers.
    ///
    /// # Arguments
    /// * `redis_client` - The Redis client to use for retrieval
    ///
    /// # Returns
    /// A Result containing either the loaded map (if found) or None (if not found),
    /// or an error if retrieval or deserialization failed
    pub async fn load_from_redis(redis_client: &RedisClient) -> Result<Option<Self>> {
        let encoded = redis_client
            .get_with_service_prefix("infrastructure_map")
            .await
            .context("Failed to get InfrastructureMap from Redis")?;

        if let Some(encoded) = encoded {
            // Canonicalize tables to handle backward compatibility with data saved by older CLI versions
            let decoded = InfrastructureMap::from_proto(encoded)
                .map_err(|e| {
                    anyhow::anyhow!("Failed to decode InfrastructureMap from proto: {}", e)
                })?
                .canonicalize_tables();
            Ok(Some(decoded))
        } else {
            Ok(None)
        }
    }

    /// Loads an infrastructure map using the last deployment's Redis key prefix.
    pub async fn load_from_last_redis_prefix(redis_client: &RedisClient) -> Result<Option<Self>> {
        let last_prefix = &redis_client.config.last_key_prefix;

        tracing::info!(
            "Loading InfrastructureMap from last Redis prefix: {}",
            last_prefix
        );

        let encoded = redis_client
            .get_with_explicit_prefix(last_prefix, "infrastructure_map")
            .await
            .context("Failed to get InfrastructureMap from Redis using LAST_KEY_PREFIX");

        if let Err(e) = encoded {
            tracing::error!("{}", e);
            return Ok(None);
        }

        if let Ok(Some(encoded)) = encoded {
            // Canonicalize tables to handle backward compatibility with data saved by older CLI versions
            let decoded = InfrastructureMap::from_proto(encoded)
                .map_err(|e| {
                    anyhow::anyhow!("Failed to decode InfrastructureMap from proto: {}", e)
                })?
                .canonicalize_tables();
            Ok(Some(decoded))
        } else {
            Ok(None)
        }
    }

    /// Converts the infrastructure map to its protocol buffer representation
    ///
    /// This creates a complete protocol buffer representation of the map
    /// for serialization and transport.
    ///
    /// # Returns
    /// A protocol buffer representation of the infrastructure map
    pub fn to_proto(&self) -> ProtoInfrastructureMap {
        ProtoInfrastructureMap {
            default_database: self.default_database.clone(),
            topics: self
                .topics
                .iter()
                .map(|(k, v)| (k.clone(), v.to_proto()))
                .collect(),
            api_endpoints: self
                .api_endpoints
                .iter()
                .map(|(k, v)| (k.clone(), v.to_proto()))
                .collect(),
            tables: self
                .tables
                .iter()
                .map(|(k, v)| (k.clone(), v.to_proto()))
                .collect(),
            dmv1_views: self
                .dmv1_views
                .iter()
                .map(|(k, v)| (k.clone(), v.to_proto()))
                .collect(),
            topic_to_table_sync_processes: self
                .topic_to_table_sync_processes
                .iter()
                .map(|(k, v)| (k.clone(), v.to_proto()))
                .collect(),
            topic_to_topic_sync_processes: self
                .topic_to_topic_sync_processes
                .iter()
                .map(|(k, v)| (k.clone(), v.to_proto()))
                .collect(),
            function_processes: self
                .function_processes
                .iter()
                .map(|(k, v)| (k.clone(), v.to_proto()))
                .collect(),
            // Still here for reverse compatibility
            initial_data_loads: HashMap::new(),
            orchestration_workers: self
                .orchestration_workers
                .iter()
                .map(|(k, v)| (k.clone(), v.to_proto()))
                .collect(),
            sql_resources: self
                .sql_resources
                .iter()
                .map(|(k, v)| (k.clone(), v.to_proto()))
                .collect(),
            web_apps: self
                .web_apps
                .iter()
                .map(|(k, v)| (k.clone(), v.to_proto()))
                .collect(),
            materialized_views: self
                .materialized_views
                .iter()
                .map(|(k, v)| (k.clone(), v.to_proto()))
                .collect(),
            views: self
                .views
                .iter()
                .map(|(k, v)| (k.clone(), v.to_proto()))
                .collect(),
            workflows: self
                .workflows
                .iter()
                .map(|(k, v)| (k.clone(), v.to_proto()))
                .collect(),
            moose_version: self.moose_version.clone().unwrap_or_default(),
            special_fields: Default::default(),
        }
    }

    /// Serializes the infrastructure map to protocol buffer bytes
    ///
    /// # Returns
    /// A byte vector containing the serialized map
    pub fn to_proto_bytes(&self) -> Vec<u8> {
        self.to_proto().write_to_bytes().unwrap()
    }

    /// Creates an infrastructure map from its protocol buffer representation
    ///
    /// # Arguments
    /// * `bytes` - The byte vector containing the serialized map
    ///
    /// # Returns
    /// A Result containing either the deserialized map or a proto error
    pub fn from_proto(bytes: Vec<u8>) -> Result<Self, InfraMapProtoError> {
        let proto = ProtoInfrastructureMap::parse_from_bytes(&bytes)?;
        let default_database = proto.default_database.clone();

        // Load sql_resources first, then migrate any that are MVs/Views to new format
        let all_sql_resources: HashMap<String, SqlResource> = proto
            .sql_resources
            .into_iter()
            .map(|(k, v)| (k, SqlResource::from_proto(v)))
            .collect();

        // Load existing materialized_views and views from proto
        let mut materialized_views: HashMap<String, MaterializedView> = proto
            .materialized_views
            .into_iter()
            .map(|(k, v)| (k, MaterializedView::from_proto(v)))
            .collect();

        let mut views: HashMap<String, View> = proto
            .views
            .into_iter()
            .map(|(k, v)| (k, View::from_proto(v)))
            .collect();

        // Migrate old SqlResources that are actually MVs or Views to new format
        // Keep track of which ones we migrate so we can remove them from sql_resources
        let mut migrated_keys = std::collections::HashSet::new();

        for (key, sql_resource) in &all_sql_resources {
            // Skip if already in new format maps (shouldn't happen but be safe)
            if materialized_views.contains_key(&sql_resource.name)
                || views.contains_key(&sql_resource.name)
            {
                continue;
            }

            // Try to migrate to MaterializedView
            if let Some(mv) = Self::try_migrate_sql_resource_to_mv(sql_resource, &default_database)
            {
                tracing::debug!(
                    "Migrating SqlResource '{}' to MaterializedView format",
                    sql_resource.name
                );
                materialized_views.insert(mv.name.clone(), mv);
                migrated_keys.insert(key.clone());
                continue;
            }

            // Try to migrate to View
            if let Some(view) =
                Self::try_migrate_sql_resource_to_view(sql_resource, &default_database)
            {
                tracing::debug!(
                    "Migrating SqlResource '{}' to View format",
                    sql_resource.name
                );
                views.insert(view.name.clone(), view);
                migrated_keys.insert(key.clone());
            }
        }

        // Remove migrated resources from sql_resources
        let sql_resources: HashMap<String, SqlResource> = all_sql_resources
            .into_iter()
            .filter(|(k, _)| !migrated_keys.contains(k))
            .collect();

        if !migrated_keys.is_empty() {
            tracing::info!(
                "Migrated {} SqlResources to structured MV/View format",
                migrated_keys.len()
            );
        }

        Ok(InfrastructureMap {
            default_database,
            topics: proto
                .topics
                .into_iter()
                .map(|(k, v)| (k, Topic::from_proto(v)))
                .collect(),
            api_endpoints: proto
                .api_endpoints
                .into_iter()
                .map(|(k, v)| (k, ApiEndpoint::from_proto(v)))
                .collect(),
            tables: proto
                .tables
                .into_iter()
                .map(|(k, v)| (k, Table::from_proto(v)))
                .collect(),
            dmv1_views: proto
                .dmv1_views
                .into_iter()
                .map(|(k, v)| (k, Dmv1View::from_proto(v)))
                .collect(),
            topic_to_table_sync_processes: proto
                .topic_to_table_sync_processes
                .into_iter()
                .map(|(k, v)| (k, TopicToTableSyncProcess::from_proto(v)))
                .collect(),
            topic_to_topic_sync_processes: proto
                .topic_to_topic_sync_processes
                .into_iter()
                .map(|(k, v)| (k, TopicToTopicSyncProcess::from_proto(v)))
                .collect(),
            function_processes: proto
                .function_processes
                .into_iter()
                .map(|(k, v)| (k, FunctionProcess::from_proto(v)))
                .collect(),
            orchestration_workers: proto
                .orchestration_workers
                .into_iter()
                .map(|(k, v)| (k, OrchestrationWorker::from_proto(v)))
                .collect(),
            consumption_api_web_server: ConsumptionApiWebServer {},
            sql_resources,
            workflows: proto
                .workflows
                .into_iter()
                .map(|(k, v)| (k, Workflow::from_proto(v)))
                .collect(),
            web_apps: proto
                .web_apps
                .into_iter()
                .map(|(k, v)| (k, super::infrastructure::web_app::WebApp::from_proto(&v)))
                .collect(),
            materialized_views,
            views,
            moose_version: if proto.moose_version.is_empty() {
                None // Backward compat: empty string = not set
            } else {
                Some(proto.moose_version)
            },
        })
    }

    /// Attempts to migrate a SqlResource to a MaterializedView.
    /// Returns None if the SqlResource is not a moose-lib generated materialized view.
    pub fn try_migrate_sql_resource_to_mv(
        sql_resource: &SqlResource,
        default_database: &str,
    ) -> Option<MaterializedView> {
        use crate::infrastructure::olap::clickhouse::sql_parser::parse_create_materialized_view;

        // Must have exactly one setup and one teardown statement
        if sql_resource.setup.len() != 1 || sql_resource.teardown.len() != 1 {
            return None;
        }

        let setup_sql = sql_resource.setup.first()?;
        let teardown_sql = sql_resource.teardown.first()?;

        // Check teardown matches moose-lib pattern
        if !teardown_sql.starts_with("DROP VIEW IF EXISTS") {
            return None;
        }

        // Check setup matches moose-lib MV pattern
        if !setup_sql.starts_with("CREATE MATERIALIZED VIEW IF NOT EXISTS") {
            return None;
        }
        if !setup_sql.contains(" TO ") {
            return None;
        }

        // Parse the CREATE MATERIALIZED VIEW statement
        let parsed = parse_create_materialized_view(setup_sql).ok()?;

        // Convert source tables to unqualified names for consistency
        let source_tables: Vec<String> = parsed
            .source_tables
            .iter()
            .map(|t| t.table.clone())
            .collect();

        // Migrate source_file to metadata.source.file
        let metadata =
            sql_resource
                .source_file
                .as_ref()
                .map(|file| super::infrastructure::table::Metadata {
                    description: None,
                    source: Some(super::infrastructure::table::SourceLocation {
                        file: file.clone(),
                    }),
                });

        Some(MaterializedView {
            name: sql_resource.name.clone(),
            database: Some(default_database.to_string()),
            select_sql: parsed.select_statement,
            source_tables,
            target_table: parsed.target_table,
            target_database: parsed.target_database,
            metadata,
        })
    }

    /// Attempts to migrate a SqlResource to a View.
    /// Returns None if the SqlResource is not a moose-lib generated custom view.
    pub fn try_migrate_sql_resource_to_view(
        sql_resource: &SqlResource,
        default_database: &str,
    ) -> Option<View> {
        use crate::infrastructure::olap::clickhouse::sql_parser::{
            extract_source_tables_from_query, extract_source_tables_from_query_regex,
        };

        // Must have exactly one setup and one teardown statement
        if sql_resource.setup.len() != 1 || sql_resource.teardown.len() != 1 {
            return None;
        }

        let setup_sql = sql_resource.setup.first()?;
        let teardown_sql = sql_resource.teardown.first()?;

        // Check teardown matches moose-lib pattern
        if !teardown_sql.starts_with("DROP VIEW IF EXISTS") {
            return None;
        }

        // Check setup matches moose-lib View pattern (not MV)
        if !setup_sql.starts_with("CREATE VIEW IF NOT EXISTS") {
            return None;
        }

        // Extract the SELECT part after AS
        let upper = setup_sql.to_uppercase();
        let as_pos = upper.find(" AS ")?;
        let select_sql = setup_sql[(as_pos + 4)..].trim().to_string();

        // Extract source tables (use unqualified names for consistency)
        // Try AST parser first (same approach as MaterializedView migration),
        // fall back to regex if it fails on ClickHouse-specific syntax
        let source_tables: Vec<String> = match extract_source_tables_from_query(&select_sql) {
            Ok(tables) => tables.iter().map(|t| t.table.clone()).collect(),
            Err(e) => {
                tracing::debug!(
                    "AST parser failed to extract source tables from view '{}' SELECT query: {}. \
                     Falling back to regex parser.",
                    sql_resource.name,
                    e
                );
                match extract_source_tables_from_query_regex(&select_sql, default_database) {
                    Ok(tables) => tables.iter().map(|t| t.table.clone()).collect(),
                    Err(e) => {
                        tracing::debug!(
                            "Regex parser also failed to extract source tables from view '{}' SELECT query: {}. \
                             Source table dependency tracking may be incomplete.",
                            sql_resource.name,
                            e
                        );
                        Vec::new()
                    }
                }
            }
        };

        // Migrate source_file to metadata.source.file
        let metadata =
            sql_resource
                .source_file
                .as_ref()
                .map(|file| super::infrastructure::table::Metadata {
                    description: None,
                    source: Some(super::infrastructure::table::SourceLocation {
                        file: file.clone(),
                    }),
                });

        Some(View {
            name: sql_resource.name.clone(),
            database: Some(default_database.to_string()),
            select_sql,
            source_tables,
            metadata,
        })
    }

    /// Adds a table to the infrastructure map
    ///
    /// # Arguments
    /// * `table` - The table to add
    pub fn add_table(&mut self, table: Table) {
        self.tables.insert(table.id(&self.default_database), table);
    }

    /// Finds a table by name
    ///
    /// # Arguments
    /// * `name` - The name of the table to find
    ///
    /// # Returns
    /// An Option containing a reference to the table if found
    pub fn find_table_by_name(&self, name: &str) -> Option<&Table> {
        self.tables.values().find(|table| table.name == name)
    }

    /// Returns EXTERNALLY_MANAGED tables that support SELECT operations
    ///
    /// Filters tables to find those marked as EXTERNALLY_MANAGED and have engines
    /// that support SELECT queries (excludes Kafka, S3Queue which are write-only).
    /// Useful for operations like mirroring, seeding, and creating local copies.
    pub fn get_mirrorable_external_tables(&self) -> Vec<&Table> {
        let mut tables: Vec<&Table> = self
            .tables
            .values()
            .filter(|t| t.life_cycle == LifeCycle::ExternallyManaged)
            .filter(|t| t.engine.supports_select())
            .collect();
        tables.sort_by_key(|t| &t.name);
        tables
    }

    /// Masks sensitive credentials before exporting to JSON migration files.
    pub fn mask_credentials_for_json_export(mut self) -> Self {
        for table in self.tables.values_mut() {
            match &mut table.engine {
                ClickhouseEngine::S3Queue {
                    aws_access_key_id,
                    aws_secret_access_key,
                    ..
                }
                | ClickhouseEngine::S3 {
                    aws_access_key_id,
                    aws_secret_access_key,
                    ..
                }
                | ClickhouseEngine::IcebergS3 {
                    aws_access_key_id,
                    aws_secret_access_key,
                    ..
                } => {
                    if aws_access_key_id.is_some() {
                        *aws_access_key_id = Some(CREDENTIAL_PLACEHOLDER.to_string());
                    }
                    if aws_secret_access_key.is_some() {
                        *aws_secret_access_key = Some(CREDENTIAL_PLACEHOLDER.to_string());
                    }
                }
                _ => {}
            }

            // Mask engine-specific sensitive settings (e.g., Kafka credentials)
            if let Some(ref mut settings) = table.table_settings {
                for key in table.engine.sensitive_settings() {
                    if let Some(value) = settings.get_mut(*key) {
                        *value = CREDENTIAL_PLACEHOLDER.to_string();
                    }
                }
            }
        }

        self
    }

    /// Normalizes the infrastructure map by converting old-style SqlResource entries
    /// that are actually materialized views or regular views into structured types.
    ///
    /// This handles backward compatibility with older moose-lib versions that emitted
    /// MVs and views as generic SqlResource objects.
    ///
    /// Old moose-lib generated these exact patterns:
    /// - MV setup: "CREATE MATERIALIZED VIEW IF NOT EXISTS <name> TO <target> AS <select>"
    /// - View setup: "CREATE VIEW IF NOT EXISTS <name> AS <select>"
    /// - Both teardown: "DROP VIEW IF EXISTS <name>"
    /// - Both have exactly 1 setup statement and 1 teardown statement
    ///
    /// This method is idempotent - calling it multiple times produces the same result.
    ///
    /// # Returns
    /// A new infrastructure map with SqlResource entries converted to MaterializedView
    /// or View where applicable
    pub fn normalize(self) -> Self {
        // Delegate to canonicalize_tables which contains the conversion logic
        self.canonicalize_tables()
    }

    /// Canonicalizes all tables in the infrastructure map.
    ///
    /// This ensures all tables satisfy ClickHouse-specific invariants:
    /// - MergeTree tables have an ORDER BY clause (falls back to primary key)
    /// - Arrays are non-nullable (required=true)
    /// - Engines that don't support PRIMARY KEY don't have primary_key flags on columns
    ///
    /// This method should be called after loading an infrastructure map from storage
    /// to handle backward compatibility with data saved by older CLI versions.
    ///
    /// This method is idempotent - calling it multiple times produces the same result.
    pub fn canonicalize_tables(mut self) -> Self {
        self.tables = self
            .tables
            .into_iter()
            .map(|(k, t)| (k, t.canonicalize()))
            .collect();

        // Convert old SqlResource entries that are actually MVs or Views to structured types.
        // This handles backward compatibility with older moose-lib versions.
        //
        // Old moose-lib generated these exact patterns:
        // - MV setup: "CREATE MATERIALIZED VIEW IF NOT EXISTS <name> TO <target> AS <select>"
        // - View setup: "CREATE VIEW IF NOT EXISTS <name> AS <select>"
        // - Both teardown: "DROP VIEW IF EXISTS <name>"
        // - Both have exactly 1 setup statement and 1 teardown statement
        let mut sql_resources_to_remove = Vec::new();

        for (key, sql_resource) in &self.sql_resources {
            // Try to migrate to MaterializedView using shared helper
            if let Some(mv) =
                Self::try_migrate_sql_resource_to_mv(sql_resource, &self.default_database)
            {
                tracing::debug!(
                    "Migrating SqlResource '{}' to MaterializedView in canonicalize_tables",
                    sql_resource.name
                );
                self.materialized_views.insert(mv.name.clone(), mv);
                sql_resources_to_remove.push(key.clone());
                continue;
            }

            // Try to migrate to View using shared helper
            if let Some(view) =
                Self::try_migrate_sql_resource_to_view(sql_resource, &self.default_database)
            {
                tracing::debug!(
                    "Migrating SqlResource '{}' to View in canonicalize_tables",
                    sql_resource.name
                );
                self.views.insert(view.name.clone(), view);
                sql_resources_to_remove.push(key.clone());
            }
        }

        // Remove converted SqlResources
        for key in sql_resources_to_remove {
            self.sql_resources.remove(&key);
        }

        self
    }

    /// Adds a topic to the infrastructure map
    ///
    /// # Arguments
    /// * `topic` - The topic to add
    pub fn add_topic(&mut self, topic: Topic) {
        self.topics.insert(topic.id(), topic);
    }

    /// Loads an infrastructure map from user code
    ///
    /// # Arguments
    /// * `project` - The project to load the infrastructure map from
    /// * `resolve_credentials` - Whether to resolve credentials from environment variables.
    ///   Set to `false` for build-time operations like `moose check` to avoid baking credentials
    ///   into Docker images. Set to `true` for runtime operations that need to interact with infrastructure.
    ///
    /// # Returns
    /// A Result containing the infrastructure map or an error
    pub async fn load_from_user_code(
        project: &Project,
        resolve_credentials: bool,
    ) -> anyhow::Result<Self> {
        let partial = if project.language == SupportedLanguages::Typescript {
            let process = crate::framework::typescript::export_collectors::collect_from_index(
                project,
                &project.project_location,
            )?;

            PartialInfrastructureMap::from_subprocess(process, "index.ts").await?
        } else {
            load_main_py(project, &project.project_location).await?
        };

        // Warn about unloaded files in dev mode
        if !project.is_production && !partial.unloaded_files.is_empty() {
            let file_list = if partial.unloaded_files.len() <= 5 {
                partial.unloaded_files.join(", ")
            } else {
                let first_five = partial
                    .unloaded_files
                    .iter()
                    .take(5)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "{} and {} more",
                    first_five,
                    partial.unloaded_files.len() - 5,
                )
            };

            let advice = if project.language == SupportedLanguages::Typescript {
                format!(
                    "Make sure they're imported or re-exported in {}/{}.",
                    project.source_dir, TYPESCRIPT_MAIN_FILE
                )
            } else {
                format!(
                    "Make sure they're imported in {}/{}.",
                    project.source_dir, PYTHON_MAIN_FILE
                )
            };

            show_message_wrapper(
                MessageType::Warning,
                Message {
                    action: "Unloaded Files".to_string(),
                    details: format!(
                        "Found {} source file(s) that weren't loaded: {}. These files may contain resources that won't be registered. {}",
                        partial.unloaded_files.len(),
                        file_list,
                        advice
                    ),
                },
            );
        }

        let mut infra_map = partial.into_infra_map(
            project.language,
            &project.main_file(),
            &project.clickhouse_config.db_name,
            &project.project_location,
        )?;

        // Resolve runtime credentials at runtime if requested
        if resolve_credentials {
            infra_map
                .resolve_runtime_credentials_from_env()
                .map_err(|e| anyhow::anyhow!("Failed to resolve runtime credentials: {}", e))?;
        }

        // Provide explicit feedback when streams are defined but streaming engine is disabled
        if !project.features.streaming_engine && infra_map.uses_streaming() {
            show_message_wrapper(
                MessageType::Error,
                Message {
                    action: "Disabled".to_string(),
                    details: format!(
                        "Streaming is disabled but {} stream(s) found. Enable it by setting [features].streaming_engine = true in moose.config.toml",
                        infra_map.topics.len()
                    ),
                },
            );
        }

        // Provide explicit feedback when consumption APIs are defined but APIs feature is disabled
        if !project.features.apis && infra_map.has_consumption_apis() {
            let consumption_api_count = infra_map
                .api_endpoints
                .values()
                .filter(|endpoint| matches!(endpoint.api_type, APIType::EGRESS { .. }))
                .count();

            show_message_wrapper(
                MessageType::Error,
                Message {
                    action: "Disabled".to_string(),
                    details: format!(
                        "Analytics APIs feature is disabled but {} API endpoint(s) found. Enable it by setting [features].apis = true in moose.config.toml",
                        consumption_api_count
                    ),
                },
            );
        }

        Ok(infra_map)
    }

    /// Gets a topic by its ID
    ///
    /// # Arguments
    /// * `id` - The ID of the topic to get
    ///
    /// # Returns
    /// An Option containing a reference to the topic if found
    pub fn find_topic_by_id(&self, id: &str) -> Option<&Topic> {
        self.topics.get(id)
    }

    /// Gets a topic by its ID, returning an error if not found
    ///
    /// This method is similar to `find_topic_by_id` but returns a Result
    /// instead of an Option, making it more suitable for contexts where
    /// a missing topic should be treated as an error.
    ///
    /// # Arguments
    /// * `id` - The ID of the topic to get
    ///
    /// # Returns
    /// A Result containing a reference to the topic if found, or an InfraMapError if not found
    ///
    /// # Errors
    /// Returns `InfraMapError::TopicNotFound` if no topic with the given ID exists
    pub fn get_topic(&self, id: &str) -> Result<&Topic, InfraMapError> {
        self.find_topic_by_id(id)
            .ok_or(InfraMapError::TopicNotFound {
                topic_id: id.to_string(),
            })
    }

    /// Gets a table by its ID, returning an error if not found
    ///
    /// This method is similar to `find_table_by_id` but returns a Result
    /// instead of an Option, making it more suitable for contexts where
    /// a missing table should be treated as an error.
    ///
    /// # Arguments
    /// * `id` - The ID of the table to get
    ///
    /// # Returns
    /// A Result containing a reference to the table if found, or an InfraMapError if not found
    ///
    /// # Errors
    /// Returns `InfraMapError::TableNotFound` if no table with the given ID exists
    ///
    pub fn get_table(&self, id: &str) -> Result<&Table, InfraMapError> {
        self.find_table_by_id(id)
            .ok_or(InfraMapError::TableNotFound {
                table_id: id.to_string(),
            })
    }

    /// Finds a table by its ID
    ///
    /// # Arguments
    /// * `id` - The ID of the table to find
    ///
    /// # Returns
    /// An Option containing a reference to the table if found
    pub fn find_table_by_id(&self, id: &str) -> Option<&Table> {
        self.tables.get(id)
    }

    /// Gets a topic by its name
    ///
    /// # Arguments
    /// * `name` - The name of the topic to get
    ///
    /// # Returns
    /// An Option containing a reference to the topic if found
    pub fn find_topic_by_name(&self, name: &str) -> Option<&Topic> {
        self.topics.values().find(|topic| topic.name == name)
    }

    pub fn uses_olap(&self) -> bool {
        !self.tables.is_empty()
            || !self.dmv1_views.is_empty()
            || !self.topic_to_table_sync_processes.is_empty()
            || !self.sql_resources.is_empty()
            || !self.materialized_views.is_empty()
            || !self.views.is_empty()
    }

    pub fn uses_streaming(&self) -> bool {
        !self.topics.is_empty()
            || !self.topic_to_table_sync_processes.is_empty()
            || !self.topic_to_topic_sync_processes.is_empty()
            || !self.function_processes.is_empty()
            || self
                .api_endpoints
                .iter()
                .any(|(_, api)| matches!(&api.api_type, APIType::INGRESS { .. }))
    }

    pub fn has_consumption_apis(&self) -> bool {
        self.api_endpoints
            .values()
            .any(|endpoint| matches!(endpoint.api_type, APIType::EGRESS { .. }))
    }

    pub fn fixup_default_db(&mut self, db_name: &str) {
        self.default_database = db_name.to_string();
        if self.tables.iter().any(|(id, t)| id != &t.id(db_name)) {
            // fix up IDs where the default_database might be "local",
            // or old versions which does not include DB name
            let existing_tables = mem::take(&mut self.tables);

            let mut table_id_mapping: HashMap<String, String> = HashMap::new();

            for (old_id, t) in existing_tables {
                let new_id = t.id(db_name);
                self.tables.insert(new_id.clone(), t);
                table_id_mapping.insert(old_id, new_id);
            }

            let syncs = mem::take(&mut self.topic_to_table_sync_processes);
            for (_, mut sync) in syncs {
                if let Some(new_id) = table_id_mapping.get(&sync.target_table_id) {
                    sync.target_table_id = new_id.clone();
                }
                self.topic_to_table_sync_processes.insert(sync.id(), sync);
            }
        }
    }
}

/// Compare two optional TTL expressions for equivalence, accounting for ClickHouse normalization.
///
/// ClickHouse normalizes "INTERVAL N DAY" to "toIntervalDay(N)", so direct string comparison
/// will always detect false differences. This function normalizes both expressions first.
///
/// # Arguments
/// * `before` - The first TTL expression (or None)
/// * `after` - The second TTL expression (or None)
///
/// # Returns
/// `true` if the TTL expressions are semantically equivalent, `false` otherwise
fn ttl_expressions_are_equivalent(before: &Option<String>, after: &Option<String>) -> bool {
    use crate::infrastructure::olap::clickhouse::normalize_ttl_expression;
    match (before, after) {
        (None, None) => true,
        (Some(before_ttl), Some(after_ttl)) => {
            normalize_ttl_expression(before_ttl) == normalize_ttl_expression(after_ttl)
        }
        _ => false, // One has TTL, the other doesn't
    }
}

/// Check if two columns are semantically equivalent
///
/// This handles special cases like enum types where ClickHouse's representation
/// may differ from the source TypeScript but is semantically the same.
/// Also handles TTL expressions where ClickHouse normalizes INTERVAL syntax to toInterval* functions.
///
/// # Arguments
/// * `before` - The first column to compare
/// * `after` - The second column to compare
///
/// # Returns
/// `true` if the columns are semantically equivalent, `false` otherwise
fn columns_are_equivalent(
    before: &Column,
    after: &Column,
    ignore_ops: &[crate::infrastructure::olap::clickhouse::IgnorableOperation],
) -> bool {
    use crate::infrastructure::olap::clickhouse::{
        diff_strategy::{column_types_are_equivalent, normalize_column_for_low_cardinality_ignore},
        IgnorableOperation,
    };

    // Check if we should ignore LowCardinality differences
    let ignore_low_cardinality =
        ignore_ops.contains(&IgnorableOperation::IgnoreStringLowCardinalityDifferences);

    // Normalize columns if ignore flag is set
    let normalized_before =
        normalize_column_for_low_cardinality_ignore(before, ignore_low_cardinality);
    let normalized_after =
        normalize_column_for_low_cardinality_ignore(after, ignore_low_cardinality);

    // Check all non-data_type and non-ttl fields first
    if normalized_before.name != normalized_after.name
        || normalized_before.required != normalized_after.required
        || normalized_before.unique != normalized_after.unique
        // primary_key change is handled at the table level
        || normalized_before.default != normalized_after.default
        || normalized_before.materialized != normalized_after.materialized
        || normalized_before.annotations != normalized_after.annotations
        || normalized_before.comment != normalized_after.comment
    {
        return false;
    }

    // Special handling for TTL comparison: normalize both expressions before comparing
    if !ttl_expressions_are_equivalent(&normalized_before.ttl, &normalized_after.ttl) {
        return false;
    }

    // Special handling for codec comparison: normalize both expressions before comparing
    // This handles cases where ClickHouse adds default parameters (e.g., Delta → Delta(4))
    if !codec_expressions_are_equivalent(&before.codec, &after.codec) {
        return false;
    }

    // Use ClickHouse-specific semantic comparison for data types
    // This handles special cases like enums and JSON types with order-independent typed_paths
    column_types_are_equivalent(
        &normalized_before.data_type,
        &normalized_after.data_type,
        ignore_low_cardinality,
    )
}

/// Check if two topics are equal, ignoring metadata
///
/// Metadata changes (like source file location) should not trigger redeployments.
///
/// # Arguments
/// * `a` - The first topic to compare
/// * `b` - The second topic to compare
///
/// # Returns
/// `true` if the topics are equal ignoring metadata, `false` otherwise
fn topics_equal_ignore_metadata(a: &Topic, b: &Topic) -> bool {
    let mut a = a.clone();
    let mut b = b.clone();
    a.metadata = None;
    b.metadata = None;
    a == b
}

/// Check if two tables are equal, ignoring metadata
///
/// Metadata changes (like source file location) should not trigger redeployments.
///
/// # Arguments
/// * `a` - The first table to compare
/// * `b` - The second table to compare
///
/// # Returns
/// `true` if the tables are equal ignoring metadata, `false` otherwise
fn tables_equal_ignore_metadata(a: &Table, b: &Table) -> bool {
    let mut a = a.clone();
    let mut b = b.clone();
    a.metadata = None;
    b.metadata = None;
    a == b
}

/// Check if two API endpoints are equal, ignoring metadata
///
/// Metadata changes (like source file location) should not trigger redeployments.
///
/// # Arguments
/// * `a` - The first API endpoint to compare
/// * `b` - The second API endpoint to compare
///
/// # Returns
/// `true` if the API endpoints are equal ignoring metadata, `false` otherwise
fn api_endpoints_equal_ignore_metadata(a: &ApiEndpoint, b: &ApiEndpoint) -> bool {
    let mut a = a.clone();
    let mut b = b.clone();
    a.metadata = None;
    b.metadata = None;
    a == b
}

/// Check if two workflow configurations are equal
///
/// Compares the schedule, retries, and timeout settings between two workflows.
/// These are the configuration values that affect how Temporal runs the workflow.
///
/// # Arguments
/// * `a` - The first workflow to compare
/// * `b` - The second workflow to compare
///
/// # Returns
/// `true` if the configurations are equal, `false` otherwise
fn workflows_config_equal(a: &Workflow, b: &Workflow) -> bool {
    a.config().schedule == b.config().schedule
        && a.config().retries == b.config().retries
        && a.config().timeout == b.config().timeout
}

/// Computes the detailed differences between two table versions
///
/// This function performs a column-by-column comparison between two tables
/// and identifies added, removed, and modified columns. For modified columns,
/// it logs the specific attributes that have changed.
///
/// # Arguments
/// * `before` - The original table
/// * `after` - The modified table
///
/// # Returns
/// A vector of `ColumnChange` objects describing the differences
pub fn compute_table_columns_diff(
    before: &Table,
    after: &Table,
    ignore_ops: &[crate::infrastructure::olap::clickhouse::IgnorableOperation],
) -> Vec<ColumnChange> {
    let mut diff = Vec::new();

    // Create a HashMap of the 'before' columns: O(n)
    let before_columns: HashMap<&String, &Column> =
        before.columns.iter().map(|col| (&col.name, col)).collect();

    // Create a HashMap of the 'after' columns: O(n)
    let after_columns: HashMap<&String, &Column> =
        after.columns.iter().map(|col| (&col.name, col)).collect();

    // Process additions and updates: O(n)
    for (i, after_col) in after.columns.iter().enumerate() {
        if let Some(&before_col) = before_columns.get(&after_col.name) {
            if !columns_are_equivalent(before_col, after_col, ignore_ops) {
                tracing::debug!(
                    "Column '{}' modified from {:?} to {:?}",
                    after_col.name,
                    before_col,
                    after_col
                );
                diff.push(ColumnChange::Updated {
                    before: before_col.clone(),
                    after: after_col.clone(),
                });
            } else {
                tracing::debug!("Column '{}' unchanged", after_col.name);
            }
        } else {
            diff.push(ColumnChange::Added {
                column: after_col.clone(),
                position_after: if i == 0 {
                    None
                } else {
                    Some(after.columns[i - 1].name.clone())
                },
            });
        }
    }

    // Process removals: O(n)
    for before_col in &before.columns {
        if !after_columns.contains_key(&before_col.name) {
            tracing::debug!("Column '{}' has been removed", before_col.name);
            diff.push(ColumnChange::Removed(before_col.clone()));
        }
    }

    diff
}

#[cfg(test)]
impl Default for InfrastructureMap {
    /// Creates a default empty infrastructure map
    ///
    /// This creates an infrastructure map with empty collections for all component types.
    /// Useful for testing or as a starting point for building a map programmatically.
    ///
    /// # Returns
    /// An empty infrastructure map
    fn default() -> Self {
        Self {
            default_database: default_database_name(),
            topics: HashMap::new(),
            api_endpoints: HashMap::new(),
            tables: HashMap::new(),
            dmv1_views: HashMap::new(),
            topic_to_table_sync_processes: HashMap::new(),
            topic_to_topic_sync_processes: HashMap::new(),
            function_processes: HashMap::new(),
            consumption_api_web_server: ConsumptionApiWebServer {},
            orchestration_workers: HashMap::new(),
            sql_resources: HashMap::new(),
            workflows: HashMap::new(),
            web_apps: HashMap::new(),
            materialized_views: HashMap::new(),
            views: HashMap::new(),
            moose_version: None, // Not set until storage
        }
    }
}

impl serde::Serialize for InfrastructureMap {
    /// Custom serialization with sorted keys for deterministic output.
    ///
    /// Migration files are version-controlled, so we need consistent output.
    /// Without sorted keys, HashMap serialization order is random, causing noisy diffs.
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        // We need to temporarily derive Serialize on a shadow type to avoid infinite recursion
        // Create a JSON value using the derived Serialize, then sort keys
        #[derive(serde::Serialize)]
        struct InfrastructureMapForSerialization<'a> {
            #[serde(skip_serializing_if = "Option::is_none")]
            default_database: Option<&'a String>,
            topics: &'a HashMap<String, Topic>,
            api_endpoints: &'a HashMap<String, ApiEndpoint>,
            tables: &'a HashMap<String, Table>,
            dmv1_views: &'a HashMap<String, Dmv1View>,
            topic_to_table_sync_processes: &'a HashMap<String, TopicToTableSyncProcess>,
            topic_to_topic_sync_processes: &'a HashMap<String, TopicToTopicSyncProcess>,
            function_processes: &'a HashMap<String, FunctionProcess>,
            consumption_api_web_server: &'a ConsumptionApiWebServer,
            orchestration_workers: &'a HashMap<String, OrchestrationWorker>,
            sql_resources: &'a HashMap<String, SqlResource>,
            workflows: &'a HashMap<String, Workflow>,
            web_apps: &'a HashMap<String, super::infrastructure::web_app::WebApp>,
            materialized_views:
                &'a HashMap<String, super::infrastructure::materialized_view::MaterializedView>,
            views: &'a HashMap<String, super::infrastructure::view::View>,
            #[serde(skip_serializing_if = "Option::is_none")]
            moose_version: &'a Option<String>,
        }

        // Mask credentials before serialization (for JSON migration files)
        // This is done automatically in the Serialize impl so all JSON exports are safe
        let masked_inframap = self.clone().mask_credentials_for_json_export();

        let shadow_map = InfrastructureMapForSerialization {
            default_database: Some(&masked_inframap.default_database),
            topics: &masked_inframap.topics,
            api_endpoints: &masked_inframap.api_endpoints,
            tables: &masked_inframap.tables,
            dmv1_views: &masked_inframap.dmv1_views,
            topic_to_table_sync_processes: &masked_inframap.topic_to_table_sync_processes,
            topic_to_topic_sync_processes: &masked_inframap.topic_to_topic_sync_processes,
            function_processes: &masked_inframap.function_processes,
            consumption_api_web_server: &masked_inframap.consumption_api_web_server,
            orchestration_workers: &masked_inframap.orchestration_workers,
            sql_resources: &masked_inframap.sql_resources,
            workflows: &masked_inframap.workflows,
            web_apps: &masked_inframap.web_apps,
            materialized_views: &masked_inframap.materialized_views,
            views: &masked_inframap.views,
            moose_version: &masked_inframap.moose_version,
        };

        // Serialize to JSON value, sort keys, then serialize that
        let json_value = serde_json::to_value(&shadow_map).map_err(serde::ser::Error::custom)?;
        let sorted_value = crate::utilities::json::sort_json_keys(json_value);
        sorted_value.serialize(serializer)
    }
}

#[cfg(test)]
mod tests {
    use crate::framework::core::infrastructure::table::IntType;
    use crate::framework::core::infrastructure_map::DefaultTableDiffStrategy;
    use crate::framework::core::infrastructure_map::{
        Change, InfrastructureMap, OlapChange, OrderBy, StreamingChange, TableChange,
    };
    use crate::framework::core::{
        infrastructure::table::{Column, ColumnType, Table},
        infrastructure_map::{
            compute_table_columns_diff, ColumnChange, PrimitiveSignature, PrimitiveTypes,
        },
        partial_infrastructure_map::LifeCycle,
    };
    use crate::framework::versions::Version;
    use crate::infrastructure::olap::clickhouse::config::DEFAULT_DATABASE_NAME;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

    #[test]
    fn test_compute_table_diff() {
        let before = Table {
            name: "test_table".to_string(),
            engine: ClickhouseEngine::MergeTree,
            columns: vec![
                Column {
                    name: "id".to_string(),
                    data_type: ColumnType::Int(IntType::Int64),
                    required: true,
                    unique: true,
                    primary_key: true,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                    codec: None,
                    materialized: None,
                },
                Column {
                    name: "name".to_string(),
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
                Column {
                    name: "to_be_removed".to_string(),
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
            ],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            version: Some(Version::from_string("1.0".to_string())),
            source_primitive: PrimitiveSignature {
                name: "test_primitive".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings_hash: None,
            table_settings: None,
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
        };

        let after = Table {
            name: "test_table".to_string(),
            engine: ClickhouseEngine::MergeTree,
            columns: vec![
                Column {
                    name: "id".to_string(),
                    data_type: ColumnType::BigInt, // Changed type
                    required: true,
                    unique: true,
                    primary_key: true,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                    codec: None,
                    materialized: None,
                },
                Column {
                    name: "name".to_string(),
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
                Column {
                    name: "age".to_string(), // New column
                    data_type: ColumnType::Int(IntType::Int64),
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
            ],
            order_by: OrderBy::Fields(vec!["id".to_string(), "name".to_string()]), // Changed order_by
            partition_by: None,
            sample_by: None,
            version: Some(Version::from_string("1.1".to_string())),
            source_primitive: PrimitiveSignature {
                name: "test_primitive".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings_hash: None,
            table_settings: None,
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
        };

        let diff = compute_table_columns_diff(&before, &after, &[]);

        assert_eq!(diff.len(), 3);
        assert!(
            matches!(&diff[0], ColumnChange::Updated { before, after } if before.name == "id" && matches!(after.data_type, ColumnType::BigInt))
        );
        assert!(
            matches!(&diff[1], ColumnChange::Added{column, position_after: Some(pos) } if column.name == "age" && pos == "name")
        );
        assert!(matches!(&diff[2], ColumnChange::Removed(col) if col.name == "to_be_removed"));
    }

    #[test]
    fn test_lifecycle_aware_table_diff() {
        // Test DeletionProtected table filtering out column removals
        let mut before_table = super::diff_tests::create_test_table("test_table", "1.0");
        before_table.life_cycle = LifeCycle::DeletionProtected;
        before_table.columns = vec![
            Column {
                name: "id".to_string(),
                data_type: ColumnType::Int(IntType::Int64),
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
                name: "to_remove".to_string(),
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
        ];

        let mut after_table = super::diff_tests::create_test_table("test_table", "1.0");
        after_table.life_cycle = LifeCycle::DeletionProtected;
        after_table.columns = vec![
            Column {
                name: "id".to_string(),
                data_type: ColumnType::Int(IntType::Int64),
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
                name: "new_column".to_string(),
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
        ];

        // Test normal diff (should show removal and addition)
        let normal_diff = InfrastructureMap::simple_table_diff(&before_table, &after_table);
        assert!(normal_diff.is_some());
        if let Some(TableChange::Updated { column_changes, .. }) = normal_diff {
            assert_eq!(column_changes.len(), 2); // One removal, one addition
            assert!(column_changes
                .iter()
                .any(|c| matches!(c, ColumnChange::Removed(_))));
            assert!(column_changes
                .iter()
                .any(|c| matches!(c, ColumnChange::Added { .. })));
        }

        // Test lifecycle-aware diff (should filter out removal, keep addition)
        let lifecycle_diff =
            InfrastructureMap::simple_table_diff_with_lifecycle(&before_table, &after_table);
        assert!(lifecycle_diff.is_some());
        if let Some(TableChange::Updated { column_changes, .. }) = lifecycle_diff {
            assert_eq!(column_changes.len(), 1); // Only addition, removal filtered out
            assert!(column_changes
                .iter()
                .all(|c| matches!(c, ColumnChange::Added { .. })));
            assert!(!column_changes
                .iter()
                .any(|c| matches!(c, ColumnChange::Removed(_))));
        }
    }

    #[test]
    fn test_externally_managed_diff_filtering() {
        let mut map1 = InfrastructureMap::default();
        let mut map2 = InfrastructureMap::default();

        // Create externally managed table that would normally be removed
        let mut externally_managed_table =
            super::diff_tests::create_test_table("external_table", "1.0");
        externally_managed_table.life_cycle = LifeCycle::ExternallyManaged;
        map1.tables.insert(
            externally_managed_table.id(DEFAULT_DATABASE_NAME),
            externally_managed_table.clone(),
        );

        // Create externally managed topic that would normally be added
        let mut externally_managed_topic =
            super::diff_topic_tests::create_test_topic("external_topic", "1.0");
        externally_managed_topic.life_cycle = LifeCycle::ExternallyManaged;
        map2.add_topic(externally_managed_topic.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);

        // Should have no OLAP changes (table removal filtered out)
        let table_removals = changes
            .olap_changes
            .iter()
            .filter(|c| matches!(c, OlapChange::Table(TableChange::Removed(_))))
            .count();
        assert_eq!(
            table_removals, 0,
            "Externally managed table should not be removed"
        );

        // Should have no streaming changes (topic addition filtered out)
        let topic_additions = changes
            .streaming_engine_changes
            .iter()
            .filter(|c| matches!(c, StreamingChange::Topic(Change::Added(_))))
            .count();
        assert_eq!(
            topic_additions, 0,
            "Externally managed topic should not be added"
        );
    }

    /// Mock strategy that converts all updates to drop+create operations
    /// This simulates ClickHouse behavior for ORDER BY changes
    struct DropCreateStrategy;

    impl super::TableDiffStrategy for DropCreateStrategy {
        fn diff_table_update(
            &self,
            before: &Table,
            after: &Table,
            _column_changes: Vec<super::ColumnChange>,
            _order_by_change: super::OrderByChange,
            _partition_by_change: super::PartitionByChange,
            _default_database: &str,
        ) -> Vec<OlapChange> {
            // Simulate strategy converting update to drop+create
            vec![
                OlapChange::Table(TableChange::Removed(before.clone())),
                OlapChange::Table(TableChange::Added(after.clone())),
            ]
        }
    }

    #[test]
    fn test_deletion_protected_table_blocks_strategy_drop() {
        // Test that deletion protection works even when strategy converts update to drop+create
        let mut map1 = InfrastructureMap::default();
        let mut map2 = InfrastructureMap::default();

        // Create a DeletionProtected table that will be "updated"
        let mut before_table = super::diff_tests::create_test_table("protected_table", "1.0");
        before_table.life_cycle = LifeCycle::DeletionProtected;
        before_table.order_by = OrderBy::Fields(vec!["id".to_string()]);
        before_table.columns = vec![Column {
            name: "id".to_string(),
            data_type: ColumnType::Int(IntType::Int64),
            required: true,
            unique: false,
            primary_key: true,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        }];

        let mut after_table = before_table.clone();
        after_table.order_by = OrderBy::Fields(vec!["id".to_string(), "name".to_string()]);
        after_table.columns.push(Column {
            name: "name".to_string(),
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
        });

        map1.tables
            .insert(before_table.id(DEFAULT_DATABASE_NAME), before_table.clone());
        map2.tables
            .insert(after_table.id(DEFAULT_DATABASE_NAME), after_table.clone());

        // Use the DropCreateStrategy which will try to emit drop+create
        let changes = map1.diff_with_table_strategy(
            &map2,
            &DropCreateStrategy,
            true, // respect_life_cycle = true
            false,
            &[],
        );

        // Verify the drop operation was filtered out
        let table_removals = changes
            .olap_changes
            .iter()
            .filter(|c| matches!(c, OlapChange::Table(TableChange::Removed(_))))
            .count();
        assert_eq!(
            table_removals, 0,
            "DeletionProtected table should block strategy-generated drop operation"
        );

        // The orphan addition should also be blocked to avoid "table already exists" errors
        let table_additions = changes
            .olap_changes
            .iter()
            .filter(|c| matches!(c, OlapChange::Table(TableChange::Added(_))))
            .count();
        assert_eq!(
            table_additions, 0,
            "Orphan CREATE should be blocked when DROP is blocked for DeletionProtected tables"
        );
    }

    #[test]
    fn test_externally_managed_table_blocks_strategy_drop() {
        // Test that ExternallyManaged tables also block strategy-generated drops
        let mut map1 = InfrastructureMap::default();
        let mut map2 = InfrastructureMap::default();

        let mut before_table = super::diff_tests::create_test_table("external_table", "1.0");
        before_table.life_cycle = LifeCycle::ExternallyManaged;
        before_table.order_by = OrderBy::Fields(vec!["id".to_string()]);
        before_table.columns = vec![Column {
            name: "id".to_string(),
            data_type: ColumnType::Int(IntType::Int64),
            required: true,
            unique: false,
            primary_key: true,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        }];

        let mut after_table = before_table.clone();
        after_table.order_by = OrderBy::Fields(vec!["id".to_string(), "name".to_string()]);

        map1.tables
            .insert(before_table.id(DEFAULT_DATABASE_NAME), before_table.clone());
        map2.tables
            .insert(after_table.id(DEFAULT_DATABASE_NAME), after_table.clone());

        let changes = map1.diff_with_table_strategy(
            &map2,
            &DropCreateStrategy,
            true, // respect_life_cycle = true
            false,
            &[],
        );

        // Verify the drop operation was filtered out
        let table_removals = changes
            .olap_changes
            .iter()
            .filter(|c| matches!(c, OlapChange::Table(TableChange::Removed(_))))
            .count();
        assert_eq!(
            table_removals, 0,
            "ExternallyManaged table should block strategy-generated drop operation"
        );
    }

    #[test]
    fn test_fully_managed_table_allows_strategy_drop() {
        // Test that FullyManaged tables allow strategy-generated drops
        let mut map1 = InfrastructureMap::default();
        let mut map2 = InfrastructureMap::default();

        let mut before_table = super::diff_tests::create_test_table("managed_table", "1.0");
        before_table.life_cycle = LifeCycle::FullyManaged;
        before_table.order_by = OrderBy::Fields(vec!["id".to_string()]);
        before_table.columns = vec![Column {
            name: "id".to_string(),
            data_type: ColumnType::Int(IntType::Int64),
            required: true,
            unique: false,
            primary_key: true,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        }];

        let mut after_table = before_table.clone();
        after_table.order_by = OrderBy::Fields(vec!["id".to_string(), "name".to_string()]);

        map1.tables
            .insert(before_table.id(DEFAULT_DATABASE_NAME), before_table.clone());
        map2.tables
            .insert(after_table.id(DEFAULT_DATABASE_NAME), after_table.clone());

        let changes = map1.diff_with_table_strategy(
            &map2,
            &DropCreateStrategy,
            true, // respect_life_cycle = true
            false,
            &[],
        );

        // Verify both drop and create operations are present
        let table_removals = changes
            .olap_changes
            .iter()
            .filter(|c| matches!(c, OlapChange::Table(TableChange::Removed(_))))
            .count();
        assert_eq!(
            table_removals, 1,
            "FullyManaged table should allow strategy-generated drop operation"
        );

        let table_additions = changes
            .olap_changes
            .iter()
            .filter(|c| matches!(c, OlapChange::Table(TableChange::Added(_))))
            .count();
        assert_eq!(table_additions, 1, "Table addition should be present");
    }

    #[test]
    fn test_lifecycle_transition_to_protected() {
        // Test that lifecycle protection works when transitioning FROM FullyManaged TO DeletionProtected
        // This is a critical edge case: the table starts as FullyManaged but should be protected
        // because the TARGET state is DeletionProtected
        let mut map1 = InfrastructureMap::default();
        let mut map2 = InfrastructureMap::default();

        let mut before_table = super::diff_tests::create_test_table("table", "1.0");
        before_table.life_cycle = LifeCycle::FullyManaged; // START as FullyManaged
        before_table.order_by = OrderBy::Fields(vec!["id".to_string()]);
        before_table.columns = vec![Column {
            name: "id".to_string(),
            data_type: ColumnType::Int(IntType::Int64),
            required: true,
            unique: false,
            primary_key: true,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        }];

        let mut after_table = before_table.clone();
        after_table.life_cycle = LifeCycle::DeletionProtected; // TRANSITION to DeletionProtected
        after_table.order_by = OrderBy::Fields(vec!["id".to_string(), "name".to_string()]);

        map1.tables
            .insert(before_table.id(DEFAULT_DATABASE_NAME), before_table.clone());
        map2.tables
            .insert(after_table.id(DEFAULT_DATABASE_NAME), after_table.clone());

        let changes = map1.diff_with_table_strategy(
            &map2,
            &DropCreateStrategy,
            true, // respect_life_cycle = true
            false,
            &[],
        );

        // The drop should be blocked because TARGET lifecycle is DeletionProtected
        let table_removals = changes
            .olap_changes
            .iter()
            .filter(|c| matches!(c, OlapChange::Table(TableChange::Removed(_))))
            .count();
        assert_eq!(
            table_removals, 0,
            "DROP should be blocked when transitioning TO DeletionProtected lifecycle"
        );

        // The orphan CREATE should also be blocked
        let table_additions = changes
            .olap_changes
            .iter()
            .filter(|c| matches!(c, OlapChange::Table(TableChange::Added(_))))
            .count();
        assert_eq!(
            table_additions, 0,
            "Orphan CREATE should be blocked when DROP is blocked during lifecycle transition"
        );
    }

    #[test]
    fn test_lifecycle_protection_can_be_disabled() {
        // Test that lifecycle protection can be disabled with respect_life_cycle=false
        let mut map1 = InfrastructureMap::default();
        let mut map2 = InfrastructureMap::default();

        let mut before_table = super::diff_tests::create_test_table("protected_table", "1.0");
        before_table.life_cycle = LifeCycle::DeletionProtected;
        before_table.order_by = OrderBy::Fields(vec!["id".to_string()]);
        before_table.columns = vec![Column {
            name: "id".to_string(),
            data_type: ColumnType::Int(IntType::Int64),
            required: true,
            unique: false,
            primary_key: true,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        }];

        let mut after_table = before_table.clone();
        after_table.order_by = OrderBy::Fields(vec!["id".to_string(), "name".to_string()]);

        map1.tables
            .insert(before_table.id(DEFAULT_DATABASE_NAME), before_table.clone());
        map2.tables
            .insert(after_table.id(DEFAULT_DATABASE_NAME), after_table.clone());

        let changes = map1.diff_with_table_strategy(
            &map2,
            &DropCreateStrategy,
            false, // respect_life_cycle = false
            false,
            &[],
        );

        // When lifecycle protection is disabled, drops should go through
        let table_removals = changes
            .olap_changes
            .iter()
            .filter(|c| matches!(c, OlapChange::Table(TableChange::Removed(_))))
            .count();
        assert_eq!(
            table_removals, 1,
            "When respect_life_cycle=false, drops should not be blocked"
        );
    }
}

#[cfg(test)]
mod diff_tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, FloatType, IntType};
    use crate::framework::versions::Version;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
    use serde_json::Value as JsonValue;

    // Helper function to create a basic test table
    pub fn create_test_table(name: &str, version: &str) -> Table {
        Table {
            name: name.to_string(),
            engine: ClickhouseEngine::MergeTree,
            columns: vec![],
            order_by: OrderBy::Fields(vec![]),
            partition_by: None,
            sample_by: None,
            version: Some(Version::from_string(version.to_string())),
            source_primitive: PrimitiveSignature {
                name: "test_primitive".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings_hash: None,
            table_settings: None,
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
        }
    }

    #[test]
    fn test_empty_tables_no_changes() {
        let table1 = create_test_table("test", "1.0");
        let table2 = create_test_table("test", "1.0");

        let diff = compute_table_columns_diff(&table1, &table2, &[]);
        assert!(diff.is_empty(), "Expected no changes between empty tables");
    }

    #[test]
    fn test_column_addition() {
        let before = create_test_table("test", "1.0");
        let mut after = create_test_table("test", "1.0");

        after.columns.push(Column {
            name: "new_column".to_string(),
            data_type: ColumnType::Int(IntType::Int64),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        });

        let diff = compute_table_columns_diff(&before, &after, &[]);
        assert_eq!(diff.len(), 1, "Expected one change");
        match &diff[0] {
            ColumnChange::Added {
                column: col,
                position_after: None,
            } => {
                assert_eq!(col.name, "new_column");
                assert_eq!(col.data_type, ColumnType::Int(IntType::Int64));
            }
            _ => panic!("Expected Added change"),
        }
    }

    #[test]
    fn test_column_removal() {
        let mut before = create_test_table("test", "1.0");
        let after = create_test_table("test", "1.0");

        before.columns.push(Column {
            name: "to_remove".to_string(),
            data_type: ColumnType::Int(IntType::Int64),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        });

        let diff = compute_table_columns_diff(&before, &after, &[]);
        assert_eq!(diff.len(), 1, "Expected one change");
        match &diff[0] {
            ColumnChange::Removed(col) => {
                assert_eq!(col.name, "to_remove");
                assert_eq!(col.data_type, ColumnType::Int(IntType::Int64));
            }
            _ => panic!("Expected Removed change"),
        }
    }

    #[test]
    fn test_column_type_change() {
        let mut before = create_test_table("test", "1.0");
        let mut after = create_test_table("test", "1.0");

        before.columns.push(Column {
            name: "age".to_string(),
            data_type: ColumnType::Int(IntType::Int64),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        });

        after.columns.push(Column {
            name: "age".to_string(),
            data_type: ColumnType::BigInt,
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        });

        let diff = compute_table_columns_diff(&before, &after, &[]);
        assert_eq!(diff.len(), 1, "Expected one change");
        match &diff[0] {
            ColumnChange::Updated {
                before: b,
                after: a,
            } => {
                assert_eq!(b.name, "age");
                assert_eq!(b.data_type, ColumnType::Int(IntType::Int64));
                assert_eq!(a.data_type, ColumnType::BigInt);
            }
            _ => panic!("Expected Updated change"),
        }
    }

    #[test]
    fn test_multiple_changes() {
        let mut before = create_test_table("test", "1.0");
        let mut after = create_test_table("test", "1.0");

        // Add columns to before table
        before.columns.extend(vec![
            Column {
                name: "id".to_string(),
                data_type: ColumnType::Int(IntType::Int64),
                required: true,
                unique: true,
                primary_key: true,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
                codec: None,
                materialized: None,
            },
            Column {
                name: "to_remove".to_string(),
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
            Column {
                name: "to_modify".to_string(),
                data_type: ColumnType::Int(IntType::Int64),
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
        ]);

        // Add columns to after table
        after.columns.extend(vec![
            Column {
                name: "id".to_string(), // unchanged
                data_type: ColumnType::Int(IntType::Int64),
                required: true,
                unique: true,
                primary_key: true,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
                codec: None,
                materialized: None,
            },
            Column {
                name: "to_modify".to_string(), // modified
                data_type: ColumnType::Int(IntType::Int64),
                required: true, // changed
                unique: true,   // changed
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
                codec: None,
                materialized: None,
            },
            Column {
                name: "new_column".to_string(), // added
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
        ]);

        let diff = compute_table_columns_diff(&before, &after, &[]);
        assert_eq!(diff.len(), 3, "Expected three changes");

        // Count each type of change
        let mut added = 0;
        let mut removed = 0;
        let mut updated = 0;

        for change in diff {
            match change {
                ColumnChange::Added {
                    column: col,
                    position_after,
                } => {
                    assert_eq!(col.name, "new_column");
                    assert_eq!(position_after.as_deref(), Some("to_modify"));
                    added += 1;
                }
                ColumnChange::Removed(col) => {
                    assert_eq!(col.name, "to_remove");
                    removed += 1;
                }
                ColumnChange::Updated {
                    before: b,
                    after: a,
                } => {
                    assert_eq!(b.name, "to_modify");
                    assert_eq!(a.name, "to_modify");
                    assert!(!b.required && a.required);
                    assert!(!b.unique && a.unique);
                    updated += 1;
                }
            }
        }

        assert_eq!(added, 1, "Expected one addition");
        assert_eq!(removed, 1, "Expected one removal");
        assert_eq!(updated, 1, "Expected one update");
    }

    #[test]
    fn test_order_by_changes() {
        let mut before = create_test_table("test", "1.0");
        let mut after = create_test_table("test", "1.0");

        before.order_by = OrderBy::Fields(vec!["id".to_string()]);
        after.order_by = OrderBy::Fields(vec!["id".to_string(), "name".to_string()]);

        // Set database field for both tables
        before.database = Some(DEFAULT_DATABASE_NAME.to_string());
        after.database = Some(DEFAULT_DATABASE_NAME.to_string());

        let before_id = before.id(DEFAULT_DATABASE_NAME);
        let after_id = after.id(DEFAULT_DATABASE_NAME);

        let mut changes = Vec::new();
        InfrastructureMap::diff_tables(
            &HashMap::from([(before_id.clone(), before)]),
            &HashMap::from([(after_id, after)]),
            &mut changes,
            true,
            DEFAULT_DATABASE_NAME,
        );

        assert_eq!(changes.len(), 1, "Expected one change");
        match &changes[0] {
            OlapChange::Table(TableChange::Updated {
                order_by_change, ..
            }) => {
                assert_eq!(
                    order_by_change.before,
                    OrderBy::Fields(vec!["id".to_string(),])
                );
                assert_eq!(
                    order_by_change.after,
                    OrderBy::Fields(vec!["id".to_string(), "name".to_string(),])
                );
            }
            _ => panic!("Expected Updated change with order_by modification"),
        }
    }

    #[test]
    fn test_engine_change_detects_update() {
        let mut before = create_test_table("test", "1.0");
        let mut after = create_test_table("test", "1.0");

        before.engine = ClickhouseEngine::MergeTree;
        after.engine = ClickhouseEngine::ReplacingMergeTree {
            ver: None,
            is_deleted: None,
        };

        // Set database field for both tables
        before.database = Some(DEFAULT_DATABASE_NAME.to_string());
        after.database = Some(DEFAULT_DATABASE_NAME.to_string());

        let before_id = before.id(DEFAULT_DATABASE_NAME);
        let after_id = after.id(DEFAULT_DATABASE_NAME);

        let mut changes = Vec::new();
        InfrastructureMap::diff_tables(
            &HashMap::from([(before_id.clone(), before)]),
            &HashMap::from([(after_id, after)]),
            &mut changes,
            true,
            DEFAULT_DATABASE_NAME,
        );

        assert_eq!(changes.len(), 1, "Expected one change");
        match &changes[0] {
            OlapChange::Table(TableChange::Updated {
                before: b,
                after: a,
                ..
            }) => {
                assert!(matches!(&b.engine, ClickhouseEngine::MergeTree));
                assert!(matches!(
                    &a.engine,
                    ClickhouseEngine::ReplacingMergeTree { .. }
                ));
            }
            _ => panic!("Expected Updated change with engine modification"),
        }
    }

    #[test]
    fn test_column_default_value_change() {
        let mut before = create_test_table("test", "1.0");
        let mut after = create_test_table("test", "1.0");

        before.columns.push(Column {
            name: "count".to_string(),
            data_type: ColumnType::Int(IntType::Int64),
            required: true,
            unique: false,
            primary_key: false,
            default: Some("auto_increment".to_string()),
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        });

        after.columns.push(Column {
            name: "count".to_string(),
            data_type: ColumnType::Int(IntType::Int64),
            required: true,
            unique: false,
            primary_key: false,
            default: Some("now()".to_string()),
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        });

        let diff = compute_table_columns_diff(&before, &after, &[]);
        assert_eq!(diff.len(), 1, "Expected one change");
        match &diff[0] {
            ColumnChange::Updated {
                before: b,
                after: a,
            } => {
                assert_eq!(b.default.as_deref(), Some("auto_increment"));
                assert_eq!(a.default.as_deref(), Some("now()"));
            }
            _ => panic!("Expected Updated change"),
        }
    }

    #[test]
    fn test_no_changes_with_reordered_columns() {
        let mut before = create_test_table("test", "1.0");
        let mut after = create_test_table("test", "1.0");

        // Add columns in one order
        before.columns.extend(vec![
            Column {
                name: "id".to_string(),
                data_type: ColumnType::Int(IntType::Int64),
                required: true,
                unique: true,
                primary_key: true,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
                codec: None,
                materialized: None,
            },
            Column {
                name: "name".to_string(),
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
        ]);

        // Add same columns in different order
        after.columns.extend(vec![
            Column {
                name: "name".to_string(),
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
            Column {
                name: "id".to_string(),
                data_type: ColumnType::Int(IntType::Int64),
                required: true,
                unique: true,
                primary_key: true,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
                codec: None,
                materialized: None,
            },
        ]);

        let diff = compute_table_columns_diff(&before, &after, &[]);
        assert!(
            diff.is_empty(),
            "Expected no changes despite reordered columns"
        );
    }

    #[test]
    fn test_large_table_performance() {
        let mut before = create_test_table("test", "1.0");
        let mut after = create_test_table("test", "1.0");

        // Add 1000 columns to both tables
        for i in 0..1000 {
            let col = Column {
                name: format!("col_{i}"),
                data_type: ColumnType::Int(IntType::Int64),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
                codec: None,
                materialized: None,
            };
            before.columns.push(col.clone());
            after.columns.push(col);
        }

        // Add one change in the middle
        if let Some(col) = after.columns.get_mut(500) {
            col.data_type = ColumnType::BigInt;
        }

        let diff = compute_table_columns_diff(&before, &after, &[]);
        assert_eq!(diff.len(), 1, "Expected one change in large table");
    }

    #[test]
    fn test_all_column_types() {
        let mut before = create_test_table("test", "1.0");
        let mut after = create_test_table("test", "1.0");

        let column_types = [
            ColumnType::Int(IntType::Int64),
            ColumnType::BigInt,
            ColumnType::Float(FloatType::Float64),
            ColumnType::String,
            ColumnType::Boolean,
            ColumnType::DateTime { precision: None },
            ColumnType::Json(Default::default()),
            ColumnType::Uuid,
        ];

        for (i, col_type) in column_types.iter().enumerate() {
            before.columns.push(Column {
                name: format!("col_{i}"),
                data_type: col_type.clone(),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
                codec: None,
                materialized: None,
            });

            // Change every other column type in the after table
            let after_type = if i % 2 == 0 {
                col_type.clone()
            } else {
                // For odd-numbered columns, always change the type
                match col_type {
                    ColumnType::Int(IntType::Int64) => ColumnType::BigInt,
                    ColumnType::BigInt => ColumnType::Int(IntType::Int64),
                    ColumnType::Float(FloatType::Float64) => ColumnType::Decimal {
                        precision: 10,
                        scale: 0,
                    },
                    ColumnType::String => ColumnType::Json(Default::default()),
                    ColumnType::Boolean => ColumnType::Int(IntType::Int64),
                    ColumnType::DateTime { precision: None } => ColumnType::String,
                    ColumnType::Json(_) => ColumnType::String,
                    ColumnType::Uuid => ColumnType::String,
                    _ => ColumnType::String, // Fallback for any other types
                }
            };

            after.columns.push(Column {
                name: format!("col_{i}"),
                data_type: after_type,
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
                codec: None,
                materialized: None,
            });
        }

        let diff = compute_table_columns_diff(&before, &after, &[]);

        assert_eq!(
            diff.len(),
            column_types.len() / 2,
            "Expected changes for half of the columns"
        );
    }

    #[test]
    fn test_complex_annotation_changes() {
        let mut before = create_test_table("test", "1.0");
        let mut after = create_test_table("test", "1.0");

        before.columns.push(Column {
            name: "annotated_col".to_string(),
            data_type: ColumnType::Int(IntType::Int64),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![
                ("index".to_string(), JsonValue::Bool(true)),
                ("deprecated".to_string(), JsonValue::Bool(true)),
            ],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        });

        after.columns.push(Column {
            name: "annotated_col".to_string(),
            data_type: ColumnType::Int(IntType::Int64),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![
                ("index".to_string(), JsonValue::Bool(true)),
                ("new_annotation".to_string(), JsonValue::Bool(true)),
            ],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        });

        let diff = compute_table_columns_diff(&before, &after, &[]);
        assert_eq!(
            diff.len(),
            1,
            "Expected one change for annotation modification"
        );
        match &diff[0] {
            ColumnChange::Updated {
                before: b,
                after: a,
            } => {
                assert_eq!(b.annotations.len(), 2);
                assert_eq!(a.annotations.len(), 2);
                assert_eq!(b.annotations[0].0, "index");
                assert_eq!(b.annotations[1].0, "deprecated");
                assert_eq!(a.annotations[0].0, "index");
                assert_eq!(a.annotations[1].0, "new_annotation");
            }
            _ => panic!("Expected Updated change"),
        }
    }

    #[test]
    fn test_edge_cases() {
        let mut before = create_test_table("test", "1.0");
        let mut after = create_test_table("test", "1.0");

        // Test empty string column name
        before.columns.push(Column {
            name: "".to_string(),
            data_type: ColumnType::Int(IntType::Int64),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        });

        after.columns.push(Column {
            name: "".to_string(),
            data_type: ColumnType::BigInt,
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        });

        // Test special characters in column name
        before.columns.push(Column {
            name: "special!@#$%^&*()".to_string(),
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
        });

        after.columns.push(Column {
            name: "special!@#$%^&*()".to_string(),
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
        });

        let diff = compute_table_columns_diff(&before, &after, &[]);
        assert_eq!(diff.len(), 2, "Expected changes for edge case columns");
    }

    #[test]
    fn test_columns_are_equivalent_with_enums() {
        use crate::framework::core::infrastructure::table::IntType;
        use crate::framework::core::infrastructure::table::{
            Column, ColumnType, DataEnum, EnumMember, EnumValue,
        };

        // Test 1: Identical columns should be equivalent
        let col1 = Column {
            name: "status".to_string(),
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
        };
        let col2 = col1.clone();
        assert!(columns_are_equivalent(&col1, &col2, &[]));

        // Test 2: Different names should not be equivalent
        let mut col3 = col1.clone();
        col3.name = "different".to_string();
        assert!(!columns_are_equivalent(&col1, &col3, &[]));

        // Test 2b: Different comments should not be equivalent
        let mut col_with_comment = col1.clone();
        col_with_comment.comment = Some("User documentation".to_string());
        assert!(!columns_are_equivalent(&col1, &col_with_comment, &[]));

        // Test 3: String enum from TypeScript vs integer enum from ClickHouse
        let typescript_enum_col = Column {
            name: "record_type".to_string(),
            data_type: ColumnType::Enum(DataEnum {
                name: "RecordType".to_string(),
                values: vec![
                    EnumMember {
                        name: "TEXT".to_string(),
                        value: EnumValue::String("text".to_string()),
                    },
                    EnumMember {
                        name: "EMAIL".to_string(),
                        value: EnumValue::String("email".to_string()),
                    },
                ],
            }),
            required: true,
            unique: false,
            primary_key: true,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        let clickhouse_enum_col = Column {
            name: "record_type".to_string(),
            data_type: ColumnType::Enum(DataEnum {
                name: "Enum8".to_string(),
                values: vec![
                    EnumMember {
                        name: "text".to_string(),
                        value: EnumValue::Int(1),
                    },
                    EnumMember {
                        name: "email".to_string(),
                        value: EnumValue::Int(2),
                    },
                ],
            }),
            required: true,
            unique: false,
            primary_key: true,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        // These should be equivalent due to the enum semantic comparison
        assert!(columns_are_equivalent(
            &clickhouse_enum_col,
            &typescript_enum_col,
            &[]
        ));

        // Test 4: Different enum values should not be equivalent
        let different_enum_col = Column {
            name: "record_type".to_string(),
            data_type: ColumnType::Enum(DataEnum {
                name: "RecordType".to_string(),
                values: vec![EnumMember {
                    name: "TEXT".to_string(),
                    value: EnumValue::String("different".to_string()),
                }],
            }),
            required: true,
            unique: false,
            primary_key: true,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        assert!(!columns_are_equivalent(
            &typescript_enum_col,
            &different_enum_col,
            &[]
        ));

        // Test 5: Non-enum types should use standard equality
        let int_col1 = Column {
            name: "count".to_string(),
            data_type: ColumnType::Int(IntType::Int64),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        let int_col2 = Column {
            name: "count".to_string(),
            data_type: ColumnType::Int(IntType::Int32),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        assert!(!columns_are_equivalent(&int_col1, &int_col2, &[]));
    }

    #[test]
    fn test_columns_are_equivalent_with_json_typed_paths() {
        use crate::framework::core::infrastructure::table::IntType;
        use crate::framework::core::infrastructure::table::{Column, ColumnType, JsonOptions};

        // Test: JSON columns with typed_paths in different order should be equivalent
        let json_col1 = Column {
            name: "data".to_string(),
            data_type: ColumnType::Json(JsonOptions {
                max_dynamic_paths: Some(10),
                max_dynamic_types: Some(5),
                typed_paths: vec![
                    ("path1".to_string(), ColumnType::Int(IntType::Int64)),
                    ("path2".to_string(), ColumnType::String),
                    ("path3".to_string(), ColumnType::Boolean),
                ],
                skip_paths: vec!["skip1".to_string()],
                skip_regexps: vec!["^temp".to_string()],
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        let json_col2 = Column {
            name: "data".to_string(),
            data_type: ColumnType::Json(JsonOptions {
                max_dynamic_paths: Some(10),
                max_dynamic_types: Some(5),
                typed_paths: vec![
                    ("path3".to_string(), ColumnType::Boolean),
                    ("path1".to_string(), ColumnType::Int(IntType::Int64)),
                    ("path2".to_string(), ColumnType::String),
                ],
                skip_paths: vec!["skip1".to_string()],
                skip_regexps: vec!["^temp".to_string()],
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        // These should be equivalent - order of typed_paths doesn't matter
        assert!(columns_are_equivalent(&json_col1, &json_col2, &[]));

        // Test: Different typed_paths should not be equivalent
        let json_col3 = Column {
            name: "data".to_string(),
            data_type: ColumnType::Json(JsonOptions {
                max_dynamic_paths: Some(10),
                max_dynamic_types: Some(5),
                typed_paths: vec![
                    ("path1".to_string(), ColumnType::Int(IntType::Int64)),
                    ("path2".to_string(), ColumnType::Int(IntType::Int32)), // Different type
                ],
                skip_paths: vec!["skip1".to_string()],
                skip_regexps: vec!["^temp".to_string()],
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        assert!(!columns_are_equivalent(&json_col1, &json_col3, &[]));

        // Test: Different max_dynamic_paths should not be equivalent
        let json_col4 = Column {
            name: "data".to_string(),
            data_type: ColumnType::Json(JsonOptions {
                max_dynamic_paths: Some(20), // Different value
                max_dynamic_types: Some(5),
                typed_paths: vec![
                    ("path1".to_string(), ColumnType::Int(IntType::Int64)),
                    ("path2".to_string(), ColumnType::String),
                    ("path3".to_string(), ColumnType::Boolean),
                ],
                skip_paths: vec!["skip1".to_string()],
                skip_regexps: vec!["^temp".to_string()],
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        assert!(!columns_are_equivalent(&json_col1, &json_col4, &[]));
    }

    #[test]
    fn test_columns_are_equivalent_with_nested_json() {
        use crate::framework::core::infrastructure::table::IntType;
        use crate::framework::core::infrastructure::table::{Column, ColumnType, JsonOptions};

        // Test: Nested JSON columns with typed_paths in different order should be equivalent
        let nested_json_col1 = Column {
            name: "data".to_string(),
            data_type: ColumnType::Json(JsonOptions {
                max_dynamic_paths: None,
                max_dynamic_types: None,
                typed_paths: vec![
                    (
                        "nested".to_string(),
                        ColumnType::Json(JsonOptions {
                            max_dynamic_paths: None,
                            max_dynamic_types: None,
                            typed_paths: vec![
                                ("a".to_string(), ColumnType::Int(IntType::Int64)),
                                ("b".to_string(), ColumnType::String),
                            ],
                            skip_paths: vec![],
                            skip_regexps: vec![],
                        }),
                    ),
                    ("simple".to_string(), ColumnType::Boolean),
                ],
                skip_paths: vec![],
                skip_regexps: vec![],
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        let nested_json_col2 = Column {
            name: "data".to_string(),
            data_type: ColumnType::Json(JsonOptions {
                max_dynamic_paths: None,
                max_dynamic_types: None,
                typed_paths: vec![
                    ("simple".to_string(), ColumnType::Boolean),
                    (
                        "nested".to_string(),
                        ColumnType::Json(JsonOptions {
                            max_dynamic_paths: None,
                            max_dynamic_types: None,
                            typed_paths: vec![
                                ("b".to_string(), ColumnType::String),
                                ("a".to_string(), ColumnType::Int(IntType::Int64)),
                            ],
                            skip_paths: vec![],
                            skip_regexps: vec![],
                        }),
                    ),
                ],
                skip_paths: vec![],
                skip_regexps: vec![],
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        // These should be equivalent - order doesn't matter at any level
        assert!(columns_are_equivalent(
            &nested_json_col1,
            &nested_json_col2,
            &[]
        ));
    }

    #[test]
    fn test_columns_are_equivalent_with_nested_types() {
        use crate::framework::core::infrastructure::table::IntType;
        use crate::framework::core::infrastructure::table::{Column, ColumnType, Nested};

        // Test: Nested types with different names but same structure should be equivalent
        // This simulates ClickHouse returning "nested_3" while user code defines "Metadata"
        let col_with_generated_name = Column {
            name: "metadata".to_string(),
            data_type: ColumnType::Nested(Nested {
                name: "nested_3".to_string(), // ClickHouse-generated name
                columns: vec![
                    Column {
                        name: "tags".to_string(),
                        data_type: ColumnType::Array {
                            element_type: Box::new(ColumnType::String),
                            element_nullable: false,
                        },
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
                    Column {
                        name: "priority".to_string(),
                        data_type: ColumnType::Int(IntType::Int64),
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
                jwt: false,
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        let col_with_user_name = Column {
            name: "metadata".to_string(),
            data_type: ColumnType::Nested(Nested {
                name: "Metadata".to_string(), // User-defined name
                columns: vec![
                    Column {
                        name: "tags".to_string(),
                        data_type: ColumnType::Array {
                            element_type: Box::new(ColumnType::String),
                            element_nullable: false,
                        },
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
                    Column {
                        name: "priority".to_string(),
                        data_type: ColumnType::Int(IntType::Int64),
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
                jwt: false,
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        // These should be equivalent - name difference doesn't matter if structure matches
        assert!(columns_are_equivalent(
            &col_with_generated_name,
            &col_with_user_name,
            &[]
        ));

        // Test: Different column structures should not be equivalent
        let col_different_structure = Column {
            name: "metadata".to_string(),
            data_type: ColumnType::Nested(Nested {
                name: "Metadata".to_string(),
                columns: vec![Column {
                    name: "tags".to_string(),
                    data_type: ColumnType::Array {
                        element_type: Box::new(ColumnType::String),
                        element_nullable: false,
                    },
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                    codec: None,
                    materialized: None,
                }], // Missing priority column
                jwt: false,
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        assert!(!columns_are_equivalent(
            &col_with_user_name,
            &col_different_structure,
            &[]
        ));
    }

    #[test]
    fn test_columns_are_equivalent_with_deeply_nested_types() {
        use crate::framework::core::infrastructure::table::{Column, ColumnType, Nested};

        // Test deeply nested structures with different names at each level
        let col_generated = Column {
            name: "metadata".to_string(),
            data_type: ColumnType::Nested(Nested {
                name: "nested_3".to_string(),
                columns: vec![Column {
                    name: "config".to_string(),
                    data_type: ColumnType::Nested(Nested {
                        name: "nested_2".to_string(),
                        columns: vec![Column {
                            name: "settings".to_string(),
                            data_type: ColumnType::Nested(Nested {
                                name: "nested_1".to_string(),
                                columns: vec![
                                    Column {
                                        name: "theme".to_string(),
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
                                    Column {
                                        name: "notifications".to_string(),
                                        data_type: ColumnType::Boolean,
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
                                jwt: false,
                            }),
                            required: true,
                            unique: false,
                            primary_key: false,
                            default: None,
                            annotations: vec![],
                            comment: None,
                            ttl: None,
                            codec: None,
                            materialized: None,
                        }],
                        jwt: false,
                    }),
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                    codec: None,
                    materialized: None,
                }],
                jwt: false,
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        let col_user = Column {
            name: "metadata".to_string(),
            data_type: ColumnType::Nested(Nested {
                name: "Metadata".to_string(),
                columns: vec![Column {
                    name: "config".to_string(),
                    data_type: ColumnType::Nested(Nested {
                        name: "Config".to_string(),
                        columns: vec![Column {
                            name: "settings".to_string(),
                            data_type: ColumnType::Nested(Nested {
                                name: "Settings".to_string(),
                                columns: vec![
                                    Column {
                                        name: "theme".to_string(),
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
                                    Column {
                                        name: "notifications".to_string(),
                                        data_type: ColumnType::Boolean,
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
                                jwt: false,
                            }),
                            required: true,
                            unique: false,
                            primary_key: false,
                            default: None,
                            annotations: vec![],
                            comment: None,
                            ttl: None,
                            codec: None,
                            materialized: None,
                        }],
                        jwt: false,
                    }),
                    required: true,
                    unique: false,
                    primary_key: false,
                    default: None,
                    annotations: vec![],
                    comment: None,
                    ttl: None,
                    codec: None,
                    materialized: None,
                }],
                jwt: false,
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        // These should be equivalent - name differences at all levels don't matter
        assert!(columns_are_equivalent(&col_generated, &col_user, &[]));
    }

    #[test]
    fn test_columns_are_equivalent_with_codec() {
        use crate::framework::core::infrastructure::table::{Column, ColumnType};

        let base_col = Column {
            name: "data".to_string(),
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
        };

        // Test 1: Columns with same codec should be equivalent
        let col_with_codec1 = Column {
            codec: Some("ZSTD(3)".to_string()),
            ..base_col.clone()
        };
        let col_with_codec2 = Column {
            codec: Some("ZSTD(3)".to_string()),
            ..base_col.clone()
        };
        assert!(columns_are_equivalent(
            &col_with_codec1,
            &col_with_codec2,
            &[]
        ));

        // Test 2: Columns with different codecs should not be equivalent
        let col_with_different_codec = Column {
            codec: Some("LZ4".to_string()),
            ..base_col.clone()
        };
        assert!(!columns_are_equivalent(
            &col_with_codec1,
            &col_with_different_codec,
            &[]
        ));

        // Test 3: Column with codec vs column without codec should not be equivalent
        assert!(!columns_are_equivalent(&col_with_codec1, &base_col, &[]));

        // Test 4: Columns with codec chains should be detected as different
        let col_with_chain1 = Column {
            codec: Some("Delta, LZ4".to_string()),
            ..base_col.clone()
        };
        let col_with_chain2 = Column {
            codec: Some("Delta, ZSTD".to_string()),
            ..base_col.clone()
        };
        assert!(!columns_are_equivalent(
            &col_with_chain1,
            &col_with_chain2,
            &[]
        ));

        // Test 5: Codec with different compression levels should be detected as different
        let col_zstd3 = Column {
            codec: Some("ZSTD(3)".to_string()),
            ..base_col.clone()
        };
        let col_zstd9 = Column {
            codec: Some("ZSTD(9)".to_string()),
            ..base_col.clone()
        };
        assert!(!columns_are_equivalent(&col_zstd3, &col_zstd9, &[]));

        // Test 6: Normalized codec comparison - user "Delta" vs ClickHouse "Delta(4)"
        let col_user_delta = Column {
            codec: Some("Delta".to_string()),
            ..base_col.clone()
        };
        let col_ch_delta = Column {
            codec: Some("Delta(4)".to_string()),
            ..base_col.clone()
        };
        assert!(columns_are_equivalent(&col_user_delta, &col_ch_delta, &[]));

        // Test 7: Normalized codec comparison - user "Gorilla" vs ClickHouse "Gorilla(8)"
        let col_user_gorilla = Column {
            codec: Some("Gorilla".to_string()),
            ..base_col.clone()
        };
        let col_ch_gorilla = Column {
            codec: Some("Gorilla(8)".to_string()),
            ..base_col.clone()
        };
        assert!(columns_are_equivalent(
            &col_user_gorilla,
            &col_ch_gorilla,
            &[]
        ));

        // Test 8: Normalized chain comparison - "Delta, LZ4" vs "Delta(4), LZ4"
        let col_user_chain = Column {
            codec: Some("Delta, LZ4".to_string()),
            ..base_col.clone()
        };
        let col_ch_chain = Column {
            codec: Some("Delta(4), LZ4".to_string()),
            ..base_col.clone()
        };
        assert!(columns_are_equivalent(&col_user_chain, &col_ch_chain, &[]));
    }

    #[test]
    fn test_columns_are_equivalent_with_materialized() {
        use crate::framework::core::infrastructure::table::{Column, ColumnType};

        let base_col = Column {
            name: "event_date".to_string(),
            data_type: ColumnType::Date,
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        };

        // Test 1: Columns with same materialized expression should be equivalent
        let col_with_mat1 = Column {
            materialized: Some("toDate(timestamp)".to_string()),
            ..base_col.clone()
        };
        let col_with_mat2 = Column {
            materialized: Some("toDate(timestamp)".to_string()),
            ..base_col.clone()
        };
        assert!(columns_are_equivalent(&col_with_mat1, &col_with_mat2, &[]));

        // Test 2: Columns with different materialized expressions should not be equivalent
        let col_with_different_mat = Column {
            materialized: Some("toStartOfMonth(timestamp)".to_string()),
            ..base_col.clone()
        };
        assert!(!columns_are_equivalent(
            &col_with_mat1,
            &col_with_different_mat,
            &[]
        ));

        // Test 3: Column with materialized vs column without materialized should not be equivalent
        assert!(!columns_are_equivalent(&col_with_mat1, &base_col, &[]));

        // Test 4: Two columns without materialized (None) should be equivalent
        let base_col2 = base_col.clone();
        assert!(columns_are_equivalent(&base_col, &base_col2, &[]));

        // Test 5: Adding materialized to a column should be detected as a change
        let col_before = Column {
            materialized: None,
            ..base_col.clone()
        };
        let col_after = Column {
            materialized: Some("cityHash64(user_id)".to_string()),
            ..base_col.clone()
        };
        assert!(!columns_are_equivalent(&col_before, &col_after, &[]));

        // Test 6: Removing materialized from a column should be detected as a change
        let col_with_mat = Column {
            materialized: Some("cityHash64(user_id)".to_string()),
            ..base_col.clone()
        };
        let col_without_mat = Column {
            materialized: None,
            ..base_col.clone()
        };
        assert!(!columns_are_equivalent(&col_with_mat, &col_without_mat, &[]));
    }

    #[test]
    fn test_ignore_ttl_operations_with_other_changes() {
        let mut map1 = InfrastructureMap::default();
        let mut map2 = InfrastructureMap::default();

        let mut table_before = super::diff_tests::create_test_table("test", "1.0");
        table_before.table_ttl_setting = Some("ts + toIntervalDay(30)".to_string());

        let mut table_after = table_before.clone();
        table_after.table_ttl_setting = Some("ts + toIntervalDay(90)".to_string());
        table_after.columns.push(Column {
            name: "new_col".to_string(),
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
        });

        map1.tables
            .insert(table_before.id(DEFAULT_DATABASE_NAME), table_before);
        map2.tables
            .insert(table_after.id(DEFAULT_DATABASE_NAME), table_after);

        // With ignore: should NOT see TTL change
        let changes_ignored = map1.diff_with_table_strategy(
            &map2,
            &DefaultTableDiffStrategy,
            false,
            false,
            &[IgnorableOperation::ModifyTableTtl],
        );
        let ttl_ignored = changes_ignored
            .olap_changes
            .iter()
            .filter(|c| matches!(c, OlapChange::Table(TableChange::TtlChanged { .. })))
            .count();
        assert_eq!(ttl_ignored, 0, "TTL should be ignored");

        // Without ignore: should see TTL change
        let changes_not_ignored =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, false, false, &[]);
        let ttl_not_ignored = changes_not_ignored
            .olap_changes
            .iter()
            .filter(|c| matches!(c, OlapChange::Table(TableChange::TtlChanged { .. })))
            .count();
        assert_eq!(ttl_not_ignored, 1, "TTL should be detected");
    }
}

#[cfg(test)]
mod diff_sql_resources_tests {
    use super::*;
    use crate::framework::core::infrastructure_map::Change;

    // Helper function to create a test SQL resource
    fn create_sql_resource(name: &str, setup: Vec<&str>, teardown: Vec<&str>) -> SqlResource {
        SqlResource {
            name: name.to_string(),
            database: None,
            source_file: None,
            source_line: None,
            source_column: None,
            setup: setup.iter().map(|s| s.to_string()).collect(),
            teardown: teardown.iter().map(|s| s.to_string()).collect(),
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        }
    }

    #[test]
    fn test_no_changes_empty() {
        let self_resources = HashMap::new();
        let target_resources = HashMap::new();
        let mut olap_changes = Vec::new();

        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &mut olap_changes,
        );
        assert!(olap_changes.is_empty());
    }

    #[test]
    fn test_no_changes_identical() {
        let resource1 = create_sql_resource("res1", vec!["setup1"], vec!["teardown1"]);
        let mut self_resources = HashMap::new();
        self_resources.insert(resource1.name.clone(), resource1.clone());

        let mut target_resources = HashMap::new();
        target_resources.insert(resource1.name.clone(), resource1);

        let mut olap_changes = Vec::new();
        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &mut olap_changes,
        );
        assert!(olap_changes.is_empty());
    }

    #[test]
    fn test_add_resource() {
        let self_resources = HashMap::new();
        let resource1 = create_sql_resource("res1", vec!["setup1"], vec!["teardown1"]);
        let mut target_resources = HashMap::new();
        target_resources.insert(resource1.name.clone(), resource1.clone());

        let mut olap_changes = Vec::new();
        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &mut olap_changes,
        );

        assert_eq!(olap_changes.len(), 1);
        match &olap_changes[0] {
            OlapChange::SqlResource(Change::Added(res)) => {
                assert_eq!(res.name, "res1");
            }
            _ => panic!("Expected Added change"),
        }
    }

    #[test]
    fn test_remove_resource() {
        let resource1 = create_sql_resource("res1", vec!["setup1"], vec!["teardown1"]);
        let mut self_resources = HashMap::new();
        self_resources.insert(resource1.name.clone(), resource1.clone());

        let target_resources = HashMap::new();
        let mut olap_changes = Vec::new();
        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &mut olap_changes,
        );

        assert_eq!(olap_changes.len(), 1);
        match &olap_changes[0] {
            OlapChange::SqlResource(Change::Removed(res)) => {
                assert_eq!(res.name, "res1");
            }
            _ => panic!("Expected Removed change"),
        }
    }

    #[test]
    fn test_update_resource_setup() {
        let before_resource = create_sql_resource("res1", vec!["old_setup"], vec!["teardown1"]);
        let after_resource = create_sql_resource("res1", vec!["new_setup"], vec!["teardown1"]);

        let mut self_resources = HashMap::new();
        self_resources.insert(before_resource.name.clone(), before_resource.clone());

        let mut target_resources = HashMap::new();
        target_resources.insert(after_resource.name.clone(), after_resource.clone());

        let mut olap_changes = Vec::new();
        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &mut olap_changes,
        );

        assert_eq!(olap_changes.len(), 1);
        match &olap_changes[0] {
            OlapChange::SqlResource(Change::Updated { before, after }) => {
                assert_eq!(before.name, "res1");
                assert_eq!(after.name, "res1");
                assert_eq!(before.setup, vec!["old_setup"]);
                assert_eq!(after.setup, vec!["new_setup"]);
                assert_eq!(before.teardown, vec!["teardown1"]);
                assert_eq!(after.teardown, vec!["teardown1"]);
            }
            _ => panic!("Expected Updated change"),
        }
    }

    #[test]
    fn test_update_resource_teardown() {
        let before_resource = create_sql_resource("res1", vec!["setup1"], vec!["old_teardown"]);
        let after_resource = create_sql_resource("res1", vec!["setup1"], vec!["new_teardown"]);

        let mut self_resources = HashMap::new();
        self_resources.insert(before_resource.name.clone(), before_resource.clone());

        let mut target_resources = HashMap::new();
        target_resources.insert(after_resource.name.clone(), after_resource.clone());

        let mut olap_changes = Vec::new();
        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &mut olap_changes,
        );

        assert_eq!(olap_changes.len(), 1);
        match &olap_changes[0] {
            OlapChange::SqlResource(Change::Updated { before, after }) => {
                assert_eq!(before.name, "res1");
                assert_eq!(after.name, "res1");
                assert_eq!(before.setup, vec!["setup1"]);
                assert_eq!(after.setup, vec!["setup1"]);
                assert_eq!(before.teardown, vec!["old_teardown"]);
                assert_eq!(after.teardown, vec!["new_teardown"]);
            }
            _ => panic!("Expected Updated change"),
        }
    }

    #[test]
    fn test_multiple_changes() {
        let res1_before = create_sql_resource("res1", vec!["setup1"], vec!["teardown1"]); // Unchanged
        let res2_before = create_sql_resource("res2", vec!["old_setup2"], vec!["teardown2"]); // Updated
        let res3_before = create_sql_resource("res3", vec!["setup3"], vec!["teardown3"]); // Removed

        let mut self_resources = HashMap::new();
        self_resources.insert(res1_before.name.clone(), res1_before.clone());
        self_resources.insert(res2_before.name.clone(), res2_before.clone());
        self_resources.insert(res3_before.name.clone(), res3_before.clone());

        let res1_after = create_sql_resource("res1", vec!["setup1"], vec!["teardown1"]); // Unchanged
        let res2_after = create_sql_resource("res2", vec!["new_setup2"], vec!["teardown2"]); // Updated
        let res4_after = create_sql_resource("res4", vec!["setup4"], vec!["teardown4"]); // Added

        let mut target_resources = HashMap::new();
        target_resources.insert(res1_after.name.clone(), res1_after.clone());
        target_resources.insert(res2_after.name.clone(), res2_after.clone());
        target_resources.insert(res4_after.name.clone(), res4_after.clone());

        let mut olap_changes = Vec::new();
        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &mut olap_changes,
        );

        assert_eq!(olap_changes.len(), 3); // 1 Update, 1 Remove, 1 Add

        let mut update_found = false;
        let mut remove_found = false;
        let mut add_found = false;

        for change in &olap_changes {
            match change {
                OlapChange::SqlResource(Change::Updated { before, after }) => {
                    assert_eq!(before.name, "res2");
                    assert_eq!(after.name, "res2");
                    assert_eq!(before.setup, vec!["old_setup2"]);
                    assert_eq!(after.setup, vec!["new_setup2"]);
                    update_found = true;
                }
                OlapChange::SqlResource(Change::Removed(res)) => {
                    assert_eq!(res.name, "res3");
                    remove_found = true;
                }
                OlapChange::SqlResource(Change::Added(res)) => {
                    assert_eq!(res.name, "res4");
                    add_found = true;
                }
                _ => panic!("Unexpected OlapChange variant"),
            }
        }

        assert!(update_found, "Update change not found");
        assert!(remove_found, "Remove change not found");
        assert!(add_found, "Add change not found");
    }

    #[test]
    fn test_update_materialized_view_emits_only_sql_resource_update() {
        use crate::framework::core::infrastructure::InfrastructureSignature;

        // Note: MV population is no longer triggered by SqlResource diff.
        // Moose-lib generated MVs are now emitted as structured MaterializedView types.
        // Old SqlResource MVs are converted by normalize() to MaterializedView.
        // Population is handled by diff_materialized_views().

        let mv_before = SqlResource {
            name: "events_summary_mv".to_string(),
            database: None,
            source_file: None,
            source_line: None,
            source_column: None,
            setup: vec!["CREATE MATERIALIZED VIEW events_summary_mv TO events_summary_table AS SELECT id, name FROM events".to_string()],
            teardown: vec!["DROP VIEW events_summary_mv".to_string()],
            pulls_data_from: vec![InfrastructureSignature::Table {
                id: "events".to_string(),
            }],
            pushes_data_to: vec![InfrastructureSignature::Table {
                id: "events_summary_table".to_string(),
            }],
        };

        let mv_after = SqlResource {
            name: "events_summary_mv".to_string(),
            database: None,
            source_file: None,
            source_line: None,
            source_column: None,
            setup: vec!["CREATE MATERIALIZED VIEW events_summary_mv TO events_summary_table AS SELECT id, name, timestamp FROM events".to_string()],
            teardown: vec!["DROP VIEW events_summary_mv".to_string()],
            pulls_data_from: vec![InfrastructureSignature::Table {
                id: "events".to_string(),
            }],
            pushes_data_to: vec![InfrastructureSignature::Table {
                id: "events_summary_table".to_string(),
            }],
        };

        let mut self_resources = HashMap::new();
        self_resources.insert(mv_before.name.clone(), mv_before.clone());

        let mut target_resources = HashMap::new();
        target_resources.insert(mv_after.name.clone(), mv_after.clone());

        let mut olap_changes = Vec::new();

        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &mut olap_changes,
        );

        // Only the Update change is expected - population is handled elsewhere
        assert_eq!(olap_changes.len(), 1);

        match &olap_changes[0] {
            OlapChange::SqlResource(Change::Updated { before, after }) => {
                assert_eq!(before.name, "events_summary_mv");
                assert_eq!(after.name, "events_summary_mv");
                assert!(before.setup[0].contains("SELECT id, name FROM"));
                assert!(after.setup[0].contains("SELECT id, name, timestamp FROM"));
            }
            _ => panic!("Expected Updated change, got {:?}", olap_changes[0]),
        }
    }
}

#[cfg(test)]
mod diff_topic_tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, IntType};
    use crate::framework::core::infrastructure::topic::Topic;
    use crate::framework::versions::Version;
    use std::time::Duration;

    // Helper function to create a test topic
    pub fn create_test_topic(name: &str, version_str: &str) -> Topic {
        let version = Version::from_string(version_str.to_string());
        Topic {
            name: name.to_string(),
            source_primitive: PrimitiveSignature {
                name: format!("dm_{name}"),
                primitive_type: PrimitiveTypes::DataModel,
            },
            retention_period: Duration::from_secs(86400), // Default duration
            partition_count: 1,                           // Default count
            version: Some(version.clone()),
            max_message_bytes: 1024 * 1024, // Default size
            columns: vec![Column {
                // Example column
                name: "value".to_string(),
                data_type: ColumnType::Int(IntType::Int64),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: Vec::new(),
                comment: None,
                ttl: None,
                codec: None,
                materialized: None,
            }],
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            schema_config: None,
        }
    }

    #[test]
    fn test_diff_topic_no_changes() {
        let mut map1 = InfrastructureMap::default();
        let mut map2 = InfrastructureMap::default();
        let topic = create_test_topic("topic1", "1.0");
        map1.add_topic(topic.clone());
        map2.add_topic(topic);

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        assert!(
            changes.streaming_engine_changes.is_empty(),
            "Expected no streaming changes"
        );
        // Check other change types are also empty to be sure
        assert!(changes.olap_changes.is_empty());
        assert!(changes.api_changes.is_empty());
        // Processes always update currently, so we don't check for empty
    }

    #[test]
    fn test_diff_topic_add() {
        let map1 = InfrastructureMap::default(); // Before state (empty)
        let mut map2 = InfrastructureMap::default(); // After state
        let topic = create_test_topic("topic1", "1.0");
        map2.add_topic(topic.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        assert_eq!(
            changes.streaming_engine_changes.len(),
            1,
            "Expected one streaming change"
        );
        match &changes.streaming_engine_changes[0] {
            StreamingChange::Topic(Change::Added(t)) => {
                assert_eq!(**t, topic, "Added topic does not match")
            }
            _ => panic!("Expected Topic Added change"),
        }
        // Ensure other change types are not affected (except processes)
        assert!(changes.olap_changes.is_empty());
        assert!(changes.api_changes.is_empty());
    }

    #[test]
    fn test_diff_topic_remove() {
        let mut map1 = InfrastructureMap::default(); // Before state
        let map2 = InfrastructureMap::default(); // After state (empty)
        let topic = create_test_topic("topic1", "1.0");
        map1.add_topic(topic.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        assert_eq!(
            changes.streaming_engine_changes.len(),
            1,
            "Expected one streaming change"
        );
        match &changes.streaming_engine_changes[0] {
            StreamingChange::Topic(Change::Removed(t)) => {
                assert_eq!(**t, topic, "Removed topic does not match")
            }
            _ => panic!("Expected Topic Removed change"),
        }
        // Ensure other change types are not affected (except processes)
        assert!(changes.olap_changes.is_empty());
        assert!(changes.api_changes.is_empty());
    }

    #[test]
    fn test_diff_topic_update() {
        let mut map1 = InfrastructureMap::default(); // Before state
        let mut map2 = InfrastructureMap::default(); // After state
        let topic_before = create_test_topic("topic1", "1.0");
        // Create a topic with the same ID-generating fields initially
        let mut topic_after = create_test_topic("topic1", "1.0"); // Keep name and version same

        // Change properties *not* involved in id() generation for DataModel topics
        // topic_after.name = "topic1_new_name".to_string(); // <-- DO NOT change name
        topic_after.partition_count = 5; // Change partition count - This IS okay
        topic_after.retention_period = Duration::from_secs(172800); // Change retention - This IS okay

        // Ensure IDs are the same before insertion
        assert_eq!(
            topic_before.id(),
            topic_after.id(),
            "Test setup error: IDs should be the same for update test"
        );

        // Use the id() method for insertion key
        map1.topics.insert(topic_before.id(), topic_before.clone());
        map2.topics.insert(topic_after.id(), topic_after.clone()); // Now uses the stable ID

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        assert_eq!(
            changes.streaming_engine_changes.len(),
            1,
            "Expected one streaming change"
        );
        match &changes.streaming_engine_changes[0] {
            StreamingChange::Topic(Change::Updated { before, after }) => {
                assert_eq!(**before, topic_before, "Before topic does not match");
                assert_eq!(**after, topic_after, "After topic does not match");
                assert_eq!(before.name, after.name, "Name should NOT have changed"); // Name is part of ID here
                assert_eq!(
                    before.version, after.version,
                    "Version should NOT have changed"
                ); // Version is part of ID here
                assert_ne!(
                    before.partition_count, after.partition_count,
                    "Partition count should have changed"
                );
                assert_ne!(
                    before.retention_period, after.retention_period,
                    "Retention period should have changed"
                );
            }
            _ => panic!("Expected Topic Updated change"),
        }
        // Ensure other change types are not affected (except processes)
        assert!(changes.olap_changes.is_empty());
        assert!(changes.api_changes.is_empty());
    }
}

#[cfg(test)]
mod diff_view_tests {
    use super::*;
    use crate::framework::core::infrastructure::view::{Dmv1View, ViewType};
    use crate::framework::versions::Version;

    // Helper function to create a test view
    fn create_test_view(name: &str, version_str: &str, source_table: &str) -> Dmv1View {
        let version = Version::from_string(version_str.to_string());
        Dmv1View {
            name: name.to_string(),
            version: version.clone(),
            view_type: ViewType::TableAlias {
                // Defaulting to TableAlias for simplicity
                source_table_name: source_table.to_string(),
            },
            // Assuming View struct does not store source_primitive directly based on previous reads
        }
    }

    #[test]
    fn test_diff_view_no_changes() {
        let mut map1 = InfrastructureMap::default();
        let mut map2 = InfrastructureMap::default();
        let view = create_test_view("view1", "1.0", "table1");
        map1.dmv1_views.insert(view.id(), view.clone());
        map2.dmv1_views.insert(view.id(), view);

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        assert!(changes.olap_changes.is_empty(), "Expected no OLAP changes");
        // Check other change types are also empty to be sure (except processes)
        assert!(changes.streaming_engine_changes.is_empty());
        assert!(changes.api_changes.is_empty());
    }

    #[test]
    fn test_diff_view_add() {
        let map1 = InfrastructureMap::default(); // Before state (empty)
        let mut map2 = InfrastructureMap::default(); // After state
        let view = create_test_view("view1", "1.0", "table1");
        map2.dmv1_views.insert(view.id(), view.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        assert_eq!(changes.olap_changes.len(), 1, "Expected one OLAP change");
        match &changes.olap_changes[0] {
            OlapChange::Dmv1View(Change::Added(v)) => {
                assert_eq!(**v, view, "Added view does not match")
            }
            _ => panic!("Expected Dmv1View Added change"),
        }
        // Ensure other change types are not affected (except processes)
        assert!(changes.streaming_engine_changes.is_empty());
        assert!(changes.api_changes.is_empty());
    }

    #[test]
    fn test_diff_view_remove() {
        let mut map1 = InfrastructureMap::default(); // Before state
        let map2 = InfrastructureMap::default(); // After state (empty)
        let view = create_test_view("view1", "1.0", "table1");
        map1.dmv1_views.insert(view.id(), view.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        assert_eq!(changes.olap_changes.len(), 1, "Expected one OLAP change");
        match &changes.olap_changes[0] {
            OlapChange::Dmv1View(Change::Removed(v)) => {
                assert_eq!(**v, view, "Removed view does not match")
            }
            _ => panic!("Expected Dmv1View Removed change"),
        }
        // Ensure other change types are not affected (except processes)
        assert!(changes.streaming_engine_changes.is_empty());
        assert!(changes.api_changes.is_empty());
    }

    #[test]
    fn test_diff_view_update() {
        let mut map1 = InfrastructureMap::default(); // Before state
        let mut map2 = InfrastructureMap::default(); // After state
        let view_before = create_test_view("view1", "1.0", "table1");
        // Create a view with the same ID (name + version) but different properties
        let mut view_after = create_test_view("view1", "1.0", "table1");
        view_after.view_type = ViewType::TableAlias {
            // Change view_type detail
            source_table_name: "table2".to_string(),
        };

        // Ensure IDs are the same before insertion
        assert_eq!(
            view_before.id(),
            view_after.id(),
            "Test setup error: IDs should be the same for update test"
        );

        map1.dmv1_views
            .insert(view_before.id(), view_before.clone());
        map2.dmv1_views.insert(view_after.id(), view_after.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        assert_eq!(changes.olap_changes.len(), 1, "Expected one OLAP change");
        match &changes.olap_changes[0] {
            OlapChange::Dmv1View(Change::Updated { before, after }) => {
                assert_eq!(**before, view_before, "Before view does not match");
                assert_eq!(**after, view_after, "After view does not match");
                assert_eq!(before.name, after.name, "Name should NOT have changed");
                assert_eq!(
                    before.version, after.version,
                    "Version should NOT have changed"
                );
                assert_ne!(
                    before.view_type, after.view_type,
                    "ViewType should have changed"
                );
            }
            _ => panic!("Expected Dmv1View Updated change"),
        }
        // Ensure other change types are not affected (except processes)
        assert!(changes.streaming_engine_changes.is_empty());
        assert!(changes.api_changes.is_empty());
    }
}

#[cfg(test)]
mod diff_topic_to_table_sync_process_tests {
    use serde_json::Value;

    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType};
    use crate::framework::core::infrastructure::topic_sync_process::TopicToTableSyncProcess;
    use crate::framework::versions::Version;

    // Helper function to create a test TopicToTableSyncProcess
    fn create_test_t2t_sync_process(
        source_topic_id: &str,
        target_table_id: &str,
        version_str: &str,
        primitive_name: &str,
    ) -> TopicToTableSyncProcess {
        let version = Version::from_string(version_str.to_string());
        TopicToTableSyncProcess {
            source_topic_id: source_topic_id.to_string(),
            target_table_id: target_table_id.to_string(),
            columns: vec![Column {
                // Basic column setup
                name: "data".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: Vec::new(),
                comment: None,
                ttl: None,
                codec: None,
                materialized: None,
            }],
            version: Some(version.clone()),
            source_primitive: PrimitiveSignature {
                // Source primitive info
                name: primitive_name.to_string(),
                primitive_type: PrimitiveTypes::DataModel, // Assuming source is DataModel
            },
        }
    }

    #[test]
    fn test_diff_t2t_sync_no_changes() {
        let mut map1 = InfrastructureMap::default();
        let mut map2 = InfrastructureMap::default();
        let process = create_test_t2t_sync_process("topic1_1.0", "table1_1.0", "1.0", "topic1");
        map1.topic_to_table_sync_processes
            .insert(process.id(), process.clone());
        map2.topic_to_table_sync_processes
            .insert(process.id(), process);

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        // Check only process changes, as others should be empty
        let process_change_found = changes
            .processes_changes
            .iter()
            .any(|c| matches!(c, ProcessChange::TopicToTableSyncProcess(_)));
        assert!(
            !process_change_found,
            "Expected no TopicToTableSyncProcess changes, found: {:?}",
            changes.processes_changes
        );
    }

    #[test]
    fn test_diff_t2t_sync_add() {
        let map1 = InfrastructureMap::default(); // Before state (empty)
        let mut map2 = InfrastructureMap::default(); // After state
        let process = create_test_t2t_sync_process("topic1_1.0", "table1_1.0", "1.0", "topic1");
        map2.topic_to_table_sync_processes
            .insert(process.id(), process.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        let process_change_found = changes
            .processes_changes
            .iter()
            .find(|c| matches!(c, ProcessChange::TopicToTableSyncProcess(_)));

        assert!(
            process_change_found.is_some(),
            "Expected one TopicToTableSyncProcess change"
        );
        match process_change_found.unwrap() {
            ProcessChange::TopicToTableSyncProcess(Change::Added(p)) => {
                assert_eq!(**p, process, "Added process does not match")
            }
            _ => panic!("Expected TopicToTableSyncProcess Added change"),
        }
    }

    #[test]
    fn test_diff_t2t_sync_remove() {
        let mut map1 = InfrastructureMap::default(); // Before state
        let map2 = InfrastructureMap::default(); // After state (empty)
        let process = create_test_t2t_sync_process("topic1_1.0", "table1_1.0", "1.0", "topic1");
        map1.topic_to_table_sync_processes
            .insert(process.id(), process.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        let process_change_found = changes
            .processes_changes
            .iter()
            .find(|c| matches!(c, ProcessChange::TopicToTableSyncProcess(_)));

        assert!(
            process_change_found.is_some(),
            "Expected one TopicToTableSyncProcess change"
        );
        match process_change_found.unwrap() {
            ProcessChange::TopicToTableSyncProcess(Change::Removed(p)) => {
                assert_eq!(**p, process, "Removed process does not match")
            }
            _ => panic!("Expected TopicToTableSyncProcess Removed change"),
        }
    }

    #[test]
    fn test_diff_t2t_sync_update() {
        let mut map1 = InfrastructureMap::default(); // Before state
        let mut map2 = InfrastructureMap::default(); // After state

        // ID depends on source_topic_id, target_table_id, version
        let source_topic_id = "topic1_1.0";
        let target_table_id = "table1_1.0";
        let version_str = "1.0";
        let primitive_name = "topic1";

        let process_before = create_test_t2t_sync_process(
            source_topic_id,
            target_table_id,
            version_str,
            primitive_name,
        );
        let mut process_after = create_test_t2t_sync_process(
            source_topic_id,
            target_table_id,
            version_str,
            primitive_name,
        );

        // Change a field *not* part of the ID, e.g., columns
        process_after.columns = vec![Column {
            name: "new_data".to_string(),
            data_type: ColumnType::BigInt,
            required: false,
            unique: true,
            primary_key: true,
            default: None,
            annotations: vec![("note".to_string(), Value::String("changed".to_string()))],
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        }];

        assert_eq!(
            process_before.id(),
            process_after.id(),
            "Test setup error: IDs should be the same for update test"
        );

        map1.topic_to_table_sync_processes
            .insert(process_before.id(), process_before.clone());
        map2.topic_to_table_sync_processes
            .insert(process_after.id(), process_after.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        let process_change_found = changes
            .processes_changes
            .iter()
            .find(|c| matches!(c, ProcessChange::TopicToTableSyncProcess(_)));

        assert!(
            process_change_found.is_some(),
            "Expected one TopicToTableSyncProcess change"
        );
        match process_change_found.unwrap() {
            ProcessChange::TopicToTableSyncProcess(Change::Updated { before, after }) => {
                assert_eq!(**before, process_before, "Before process does not match");
                assert_eq!(**after, process_after, "After process does not match");
                assert_eq!(
                    before.source_topic_id, after.source_topic_id,
                    "Source topic ID should NOT change"
                );
                assert_eq!(
                    before.target_table_id, after.target_table_id,
                    "Target table ID should NOT change"
                );
                assert_eq!(before.version, after.version, "Version should NOT change");
                assert_ne!(before.columns, after.columns, "Columns should have changed");
            }
            _ => panic!("Expected TopicToTableSyncProcess Updated change"),
        }
    }
}

#[cfg(test)]
mod diff_topic_to_topic_sync_process_tests {
    use super::*;
    use crate::framework::core::infrastructure::topic_sync_process::TopicToTopicSyncProcess;

    // Helper function to create a test TopicToTopicSyncProcess
    fn create_test_topic_topic_sync_process(
        source_topic_id: &str,
        target_topic_id: &str,
        primitive_name: &str,
    ) -> TopicToTopicSyncProcess {
        TopicToTopicSyncProcess {
            source_topic_id: source_topic_id.to_string(),
            target_topic_id: target_topic_id.to_string(), // This is the ID used for the map key
            source_primitive: PrimitiveSignature {
                name: primitive_name.to_string(),
                primitive_type: PrimitiveTypes::Function, // Assuming source is Function based on definition
            },
        }
    }

    #[test]
    fn test_diff_topic_topic_sync_no_changes() {
        let mut map1 = InfrastructureMap::default();
        let mut map2 = InfrastructureMap::default();
        let process = create_test_topic_topic_sync_process("source_t1", "target_t1", "func1");
        map1.topic_to_topic_sync_processes
            .insert(process.id(), process.clone());
        map2.topic_to_topic_sync_processes
            .insert(process.id(), process);

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        let process_change_found = changes
            .processes_changes
            .iter()
            .any(|c| matches!(c, ProcessChange::TopicToTopicSyncProcess(_)));
        assert!(
            !process_change_found,
            "Expected no TopicToTopicSyncProcess changes, found: {:?}",
            changes.processes_changes
        );
    }

    #[test]
    fn test_diff_topic_topic_sync_add() {
        let map1 = InfrastructureMap::default(); // Before state (empty)
        let mut map2 = InfrastructureMap::default(); // After state
        let process = create_test_topic_topic_sync_process("source_t1", "target_t1", "func1");
        map2.topic_to_topic_sync_processes
            .insert(process.id(), process.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        let process_change_found = changes
            .processes_changes
            .iter()
            .find(|c| matches!(c, ProcessChange::TopicToTopicSyncProcess(_)));

        assert!(
            process_change_found.is_some(),
            "Expected one TopicToTopicSyncProcess change"
        );
        match process_change_found.unwrap() {
            ProcessChange::TopicToTopicSyncProcess(Change::Added(p)) => {
                assert_eq!(**p, process, "Added process does not match")
            }
            _ => panic!("Expected TopicToTopicSyncProcess Added change"),
        }
    }

    #[test]
    fn test_diff_topic_topic_sync_remove() {
        let mut map1 = InfrastructureMap::default(); // Before state
        let map2 = InfrastructureMap::default(); // After state (empty)
        let process = create_test_topic_topic_sync_process("source_t1", "target_t1", "func1");
        map1.topic_to_topic_sync_processes
            .insert(process.id(), process.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        let process_change_found = changes
            .processes_changes
            .iter()
            .find(|c| matches!(c, ProcessChange::TopicToTopicSyncProcess(_)));

        assert!(
            process_change_found.is_some(),
            "Expected one TopicToTopicSyncProcess change"
        );
        match process_change_found.unwrap() {
            ProcessChange::TopicToTopicSyncProcess(Change::Removed(p)) => {
                assert_eq!(**p, process, "Removed process does not match")
            }
            _ => panic!("Expected TopicToTopicSyncProcess Removed change"),
        }
    }

    #[test]
    fn test_diff_topic_topic_sync_update() {
        let mut map1 = InfrastructureMap::default(); // Before state
        let mut map2 = InfrastructureMap::default(); // After state

        // ID is target_topic_id
        let target_topic_id = "target_t1";
        let primitive_name = "func1";

        let process_before =
            create_test_topic_topic_sync_process("source_t1", target_topic_id, primitive_name);
        let mut process_after =
            create_test_topic_topic_sync_process("source_t1", target_topic_id, primitive_name);

        // Change a field *not* part of the ID, e.g., source_topic_id or source_primitive
        process_after.source_topic_id = "source_t2".to_string();
        process_after.source_primitive.name = "func1_new".to_string();

        assert_eq!(
            process_before.id(),
            process_after.id(),
            "Test setup error: IDs should be the same for update test"
        );

        map1.topic_to_topic_sync_processes
            .insert(process_before.id(), process_before.clone());
        map2.topic_to_topic_sync_processes
            .insert(process_after.id(), process_after.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        let process_change_found = changes
            .processes_changes
            .iter()
            .find(|c| matches!(c, ProcessChange::TopicToTopicSyncProcess(_)));

        assert!(
            process_change_found.is_some(),
            "Expected one TopicToTopicSyncProcess change"
        );
        match process_change_found.unwrap() {
            ProcessChange::TopicToTopicSyncProcess(Change::Updated { before, after }) => {
                assert_eq!(**before, process_before, "Before process does not match");
                assert_eq!(**after, process_after, "After process does not match");
                assert_eq!(
                    before.target_topic_id, after.target_topic_id,
                    "Target topic ID (key) should NOT change"
                );
                assert_ne!(
                    before.source_topic_id, after.source_topic_id,
                    "Source topic ID should have changed"
                );
                assert_ne!(
                    before.source_primitive, after.source_primitive,
                    "Source primitive should have changed"
                );
            }
            _ => panic!("Expected TopicToTopicSyncProcess Updated change"),
        }
    }
}

#[cfg(test)]
mod diff_function_process_tests {
    use super::*;
    use crate::framework::core::infrastructure::function_process::FunctionProcess;
    use crate::framework::languages::SupportedLanguages;
    use crate::framework::versions::Version;
    use std::path::PathBuf;

    // Helper function to create a test FunctionProcess
    fn create_test_function_process(
        name: &str,
        source_topic_id: &str,
        target_topic_id: Option<&str>,
        version_str: &str,
    ) -> FunctionProcess {
        let version = Version::from_string(version_str.to_string());
        FunctionProcess {
            name: name.to_string(),
            source_topic_id: source_topic_id.to_string(),
            target_topic_id: target_topic_id.map(|s| s.to_string()),
            executable: PathBuf::from(format!("path/to/{name}.py")),
            parallel_process_count: 1,
            version: Some(version),               // Use Option<String>
            language: SupportedLanguages::Python, // Default language
            source_primitive: PrimitiveSignature {
                name: name.to_string(),
                primitive_type: PrimitiveTypes::Function,
            },
            metadata: None,
        }
    }

    #[test]
    fn test_diff_function_process_no_changes_triggers_update() {
        // NOTE: Current diff logic *always* treats existing function processes as UPDATED.
        // This test verifies that behavior.
        let mut map1 = InfrastructureMap::default();
        let mut map2 = InfrastructureMap::default();
        let process = create_test_function_process("func1", "t1_1.0", Some("t2_1.0"), "1.0");
        map1.function_processes
            .insert(process.id(), process.clone());
        map2.function_processes
            .insert(process.id(), process.clone()); // Identical process

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        let process_change_found = changes
            .processes_changes
            .iter()
            .find(|c| matches!(c, ProcessChange::FunctionProcess(_)));

        assert!(
            process_change_found.is_some(),
            "Expected one FunctionProcess change (even if identical)"
        );
        match process_change_found.unwrap() {
            ProcessChange::FunctionProcess(Change::Updated { before, after }) => {
                assert_eq!(**before, process, "Before process does not match");
                assert_eq!(**after, process, "After process does not match");
            }
            _ => panic!("Expected FunctionProcess Updated change due to current logic"),
        }
    }

    #[test]
    fn test_diff_function_process_add() {
        let map1 = InfrastructureMap::default(); // Before state (empty)
        let mut map2 = InfrastructureMap::default(); // After state
        let process = create_test_function_process("func1", "t1_1.0", Some("t2_1.0"), "1.0");
        map2.function_processes
            .insert(process.id(), process.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        let process_change_found = changes
            .processes_changes
            .iter()
            .find(|c| matches!(c, ProcessChange::FunctionProcess(_)));

        assert!(
            process_change_found.is_some(),
            "Expected one FunctionProcess change"
        );
        match process_change_found.unwrap() {
            ProcessChange::FunctionProcess(Change::Added(p)) => {
                assert_eq!(**p, process, "Added process does not match")
            }
            _ => panic!("Expected FunctionProcess Added change"),
        }
    }

    #[test]
    fn test_diff_function_process_remove() {
        let mut map1 = InfrastructureMap::default(); // Before state
        let map2 = InfrastructureMap::default(); // After state (empty)
        let process = create_test_function_process("func1", "t1_1.0", Some("t2_1.0"), "1.0");
        map1.function_processes
            .insert(process.id(), process.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        let process_change_found = changes
            .processes_changes
            .iter()
            .find(|c| matches!(c, ProcessChange::FunctionProcess(_)));

        assert!(
            process_change_found.is_some(),
            "Expected one FunctionProcess change"
        );
        match process_change_found.unwrap() {
            ProcessChange::FunctionProcess(Change::Removed(p)) => {
                assert_eq!(**p, process, "Removed process does not match")
            }
            _ => panic!("Expected FunctionProcess Removed change"),
        }
    }

    #[test]
    fn test_diff_function_process_update() {
        // Verifies that an actual change is still registered as Updated
        let mut map1 = InfrastructureMap::default(); // Before state
        let mut map2 = InfrastructureMap::default(); // After state

        let name = "func1";
        let source_topic_id = "t1_1.0";
        let target_topic_id = Some("t2_1.0");
        let version_str = "1.0";

        let process_before =
            create_test_function_process(name, source_topic_id, target_topic_id, version_str);
        let mut process_after =
            create_test_function_process(name, source_topic_id, target_topic_id, version_str);

        // Change a field
        process_after.parallel_process_count = 5;
        process_after.executable = PathBuf::from("path/to/new_func1.py");

        assert_eq!(
            process_before.id(),
            process_after.id(),
            "Test setup error: IDs should be the same for update test"
        );

        map1.function_processes
            .insert(process_before.id(), process_before.clone());
        map2.function_processes
            .insert(process_after.id(), process_after.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        let process_change_found = changes
            .processes_changes
            .iter()
            .find(|c| matches!(c, ProcessChange::FunctionProcess(_)));

        assert!(
            process_change_found.is_some(),
            "Expected one FunctionProcess change"
        );
        match process_change_found.unwrap() {
            ProcessChange::FunctionProcess(Change::Updated { before, after }) => {
                assert_eq!(**before, process_before, "Before process does not match");
                assert_eq!(**after, process_after, "After process does not match");
                assert_ne!(
                    before.parallel_process_count, after.parallel_process_count,
                    "Parallel count should have changed"
                );
                assert_ne!(
                    before.executable, after.executable,
                    "Executable path should have changed"
                );
            }
            _ => panic!("Expected FunctionProcess Updated change"),
        }
    }
}

#[cfg(test)]
mod diff_orchestration_worker_tests {
    use super::*;
    use crate::framework::core::infrastructure::orchestration_worker::OrchestrationWorker;
    use crate::framework::languages::SupportedLanguages;

    // Helper function to create a test OrchestrationWorker
    // Note: The ID is determined by the language
    fn create_test_orchestration_worker(lang: SupportedLanguages) -> OrchestrationWorker {
        OrchestrationWorker {
            supported_language: lang,
        }
    }

    #[test]
    fn test_diff_orchestration_worker_no_changes_triggers_update() {
        // NOTE: Current diff logic *always* treats existing workers as UPDATED.
        // This test verifies that behavior.
        let mut map1 = InfrastructureMap::default();
        let mut map2 = InfrastructureMap::default();
        let worker = create_test_orchestration_worker(SupportedLanguages::Python);
        let id = worker.id();
        map1.orchestration_workers
            .insert(id.clone(), worker.clone());
        map2.orchestration_workers
            .insert(id.clone(), worker.clone()); // Identical worker

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        let process_change_found = changes
            .processes_changes
            .iter()
            .find(|c| matches!(c, ProcessChange::OrchestrationWorker(_)));

        assert!(
            process_change_found.is_some(),
            "Expected one OrchestrationWorker change (even if identical)"
        );
        match process_change_found.unwrap() {
            ProcessChange::OrchestrationWorker(Change::Updated { before, after }) => {
                assert_eq!(before.id(), id, "Before worker ID does not match");
                assert_eq!(after.id(), id, "After worker ID does not match");
                // Can compare the workers directly if PartialEq is derived/implemented
                assert_eq!(**before, worker, "Before worker does not match expected");
                assert_eq!(**after, worker, "After worker does not match expected");
            }
            _ => panic!("Expected OrchestrationWorker Updated change due to current logic"),
        }
    }

    #[test]
    fn test_diff_orchestration_worker_add() {
        let map1 = InfrastructureMap::default(); // Before state (empty)
        let mut map2 = InfrastructureMap::default(); // After state
        let worker = create_test_orchestration_worker(SupportedLanguages::Python);
        let id = worker.id();
        map2.orchestration_workers
            .insert(id.clone(), worker.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        let process_change_found = changes
            .processes_changes
            .iter()
            .find(|c| matches!(c, ProcessChange::OrchestrationWorker(_)));

        assert!(
            process_change_found.is_some(),
            "Expected one OrchestrationWorker change"
        );
        match process_change_found.unwrap() {
            ProcessChange::OrchestrationWorker(Change::Added(w)) => {
                assert_eq!(w.id(), id, "Added worker ID does not match");
                assert_eq!(**w, worker, "Added worker does not match expected");
            }
            _ => panic!("Expected OrchestrationWorker Added change"),
        }
    }

    #[test]
    fn test_diff_orchestration_worker_remove() {
        let mut map1 = InfrastructureMap::default(); // Before state
        let map2 = InfrastructureMap::default(); // After state (empty)
        let worker = create_test_orchestration_worker(SupportedLanguages::Python);
        let id = worker.id();
        map1.orchestration_workers
            .insert(id.clone(), worker.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);
        let process_change_found = changes
            .processes_changes
            .iter()
            .find(|c| matches!(c, ProcessChange::OrchestrationWorker(_)));

        assert!(
            process_change_found.is_some(),
            "Expected one OrchestrationWorker change"
        );
        match process_change_found.unwrap() {
            ProcessChange::OrchestrationWorker(Change::Removed(w)) => {
                assert_eq!(w.id(), id, "Removed worker ID does not match");
                assert_eq!(**w, worker, "Removed worker does not match expected");
            }
            _ => panic!("Expected OrchestrationWorker Removed change"),
        }
    }

    #[test]
    fn test_diff_orchestration_worker_update_language() {
        // Current logic always updates, but this shows it handles different languages
        let mut map1 = InfrastructureMap::default();
        let mut map2 = InfrastructureMap::default();
        let worker_py = create_test_orchestration_worker(SupportedLanguages::Python);
        let worker_ts = create_test_orchestration_worker(SupportedLanguages::Typescript);

        // Scenario: Python worker removed, TS worker added
        map1.orchestration_workers
            .insert(worker_py.id(), worker_py.clone());
        map2.orchestration_workers
            .insert(worker_ts.id(), worker_ts.clone());

        let changes =
            map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false, &[]);

        let mut removed_found = false;
        let mut added_found = false;

        for change in changes.processes_changes {
            if let ProcessChange::OrchestrationWorker(Change::Removed(w)) = &change {
                if w.supported_language == SupportedLanguages::Python {
                    removed_found = true;
                }
            }
            if let ProcessChange::OrchestrationWorker(Change::Added(w)) = &change {
                if w.supported_language == SupportedLanguages::Typescript {
                    added_found = true;
                }
            }
        }

        assert!(removed_found, "Python worker removal not detected");
        assert!(added_found, "Typescript worker addition not detected");
    }


    #[test]
    fn test_mask_credentials_for_json_export() {
        let mut map = InfrastructureMap::default();

        // Add S3Queue table with credentials
        let s3queue_table = Table {
            name: "s3queue_test".to_string(),
            engine: ClickhouseEngine::S3Queue {
                s3_path: "s3://bucket/path".to_string(),
                format: "JSONEachRow".to_string(),
                compression: None,
                headers: None,
                aws_access_key_id: Some("AKIAIOSFODNN7EXAMPLE".to_string()),
                aws_secret_access_key: Some("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".to_string()),
            },
            columns: vec![],
            order_by: OrderBy::Fields(vec![]),
            partition_by: None,
            sample_by: None,
            version: None,
            table_settings: None,
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
            engine_params_hash: None,
            table_settings_hash: None,
            indexes: vec![],
            metadata: None,
            source_primitive: PrimitiveSignature {
                name: "s3queue_test".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            life_cycle: LifeCycle::FullyManaged,
            database: None,
        };

        let mut kafka_settings = std::collections::HashMap::new();
        kafka_settings.insert("kafka_sasl_password".to_string(), "secret123".to_string());
        kafka_settings.insert("kafka_sasl_username".to_string(), "user".to_string());
        kafka_settings.insert("kafka_num_consumers".to_string(), "2".to_string());

        let kafka_table = Table {
            name: "kafka_test".to_string(),
            engine: ClickhouseEngine::Kafka {
                broker_list: "kafka:9092".to_string(),
                topic_list: "events".to_string(),
                group_name: "consumer".to_string(),
                format: "JSONEachRow".to_string(),
            },
            columns: vec![],
            order_by: OrderBy::Fields(vec![]),
            partition_by: None,
            sample_by: None,
            version: None,
            table_settings: Some(kafka_settings),
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
            engine_params_hash: None,
            table_settings_hash: None,
            indexes: vec![],
            metadata: None,
            source_primitive: PrimitiveSignature {
                name: "kafka_test".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            life_cycle: LifeCycle::FullyManaged,
            database: None,
        };

        map.tables.insert("s3queue_test".to_string(), s3queue_table);
        map.tables.insert("kafka_test".to_string(), kafka_table);

        let masked_map = map.mask_credentials_for_json_export();

        let s3queue = masked_map.tables.get("s3queue_test").unwrap();
        if let ClickhouseEngine::S3Queue {
            aws_access_key_id,
            aws_secret_access_key,
            ..
        } = &s3queue.engine
        {
            assert_eq!(aws_access_key_id.as_deref(), Some("[HIDDEN]"));
            assert_eq!(aws_secret_access_key.as_deref(), Some("[HIDDEN]"));
        } else {
            panic!("Expected S3Queue engine");
        }

        let kafka = masked_map.tables.get("kafka_test").unwrap();
        let settings = kafka.table_settings.as_ref().unwrap();
        assert_eq!(settings.get("kafka_sasl_password").unwrap(), "[HIDDEN]");
        assert_eq!(settings.get("kafka_sasl_username").unwrap(), "[HIDDEN]");
        assert_eq!(settings.get("kafka_num_consumers").unwrap(), "2");
    }

    #[test]
    fn test_ignore_string_low_cardinality_differences_integration() {
        use crate::framework::core::infrastructure::table::{
            Column, ColumnType, IntType, OrderBy, Table,
        };
        use crate::framework::core::partial_infrastructure_map::LifeCycle;
        use crate::framework::versions::Version;
        use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
        use crate::infrastructure::olap::clickhouse::IgnorableOperation;

        let table_with_low_cardinality = Table {
            name: "test_table".to_string(),
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
                    annotations: vec![("LowCardinality".to_string(), serde_json::json!(true))],
                    comment: None,
                    ttl: None,
                    codec: None,
                    materialized: None,
                },
                Column {
                    name: "name".to_string(),
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
        };

        let table_without_low_cardinality = Table {
            name: "test_table".to_string(),
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
                    name: "name".to_string(),
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
        };

        // Test 1: Without ignore flag, should detect difference
        let diff_without_ignore = compute_table_columns_diff(
            &table_with_low_cardinality,
            &table_without_low_cardinality,
            &[],
        );
        assert_eq!(
            diff_without_ignore.len(),
            1,
            "Expected one column change without ignore flag"
        );

        // Test 2: With ignore flag, should detect no difference
        let ignore_ops = vec![IgnorableOperation::IgnoreStringLowCardinalityDifferences];
        let diff_with_ignore = compute_table_columns_diff(
            &table_with_low_cardinality,
            &table_without_low_cardinality,
            &ignore_ops,
        );
        assert_eq!(
            diff_with_ignore.len(),
            0,
            "Expected no column changes with ignore flag"
        );

        // Test 3: Test with columns_are_equivalent directly
        assert!(!columns_are_equivalent(
            &table_with_low_cardinality.columns[0],
            &table_without_low_cardinality.columns[0],
            &[]
        ));
        assert!(columns_are_equivalent(
            &table_with_low_cardinality.columns[0],
            &table_without_low_cardinality.columns[0],
            &ignore_ops
        ));

        // Test 4: Ensure other differences are still detected
        let mut table_with_different_type = table_without_low_cardinality.clone();
        table_with_different_type.columns[0].data_type = ColumnType::Int(IntType::Int64);

        let diff_different_type = compute_table_columns_diff(
            &table_with_low_cardinality,
            &table_with_different_type,
            &ignore_ops,
        );
        assert_eq!(
            diff_different_type.len(),
            1,
            "Should still detect actual type differences even with ignore flag"
        );
    }
}
#[cfg(test)]
mod normalize_tests {
    use super::*;
    use crate::framework::core::infrastructure::sql_resource::SqlResource;
    use crate::framework::core::infrastructure::InfrastructureSignature;

    #[test]
    fn test_normalize_converts_materialized_view_sql_resource() {
        let mut map = InfrastructureMap::default();

        // Add an old-style SqlResource that's actually a materialized view
        let mv_sql_resource = SqlResource {
            name: "events_summary_mv".to_string(),
            database: None,
            source_file: Some("app/sql/events.ts".to_string()),
            source_line: None,
            source_column: None,
            setup: vec![
                "CREATE MATERIALIZED VIEW IF NOT EXISTS events_summary_mv TO events_summary AS SELECT user_id, count(*) as cnt FROM events GROUP BY user_id".to_string(),
            ],
            teardown: vec!["DROP VIEW IF EXISTS events_summary_mv".to_string()],
            pulls_data_from: vec![InfrastructureSignature::Table {
                id: "events".to_string(),
            }],
            pushes_data_to: vec![InfrastructureSignature::Table {
                id: "events_summary".to_string(),
            }],
        };

        map.sql_resources
            .insert("events_summary_mv".to_string(), mv_sql_resource);

        // Normalize should convert this to a MaterializedView
        let normalized = map.normalize();

        // SqlResource should be removed
        assert!(
            normalized.sql_resources.is_empty(),
            "SqlResource should have been removed"
        );

        // MaterializedView should be added
        assert_eq!(
            normalized.materialized_views.len(),
            1,
            "Should have one materialized view"
        );

        let mv = normalized
            .materialized_views
            .values()
            .next()
            .expect("Should have a materialized view");
        assert_eq!(mv.name, "events_summary_mv");
        assert_eq!(mv.target_table, "events_summary");
        assert!(mv.select_sql.contains("SELECT user_id"));
        assert_eq!(
            mv.metadata
                .as_ref()
                .and_then(|m| m.source.as_ref())
                .map(|s| s.file.clone()),
            Some("app/sql/events.ts".to_string())
        );
    }

    #[test]
    fn test_normalize_converts_view_sql_resource() {
        let mut map = InfrastructureMap::default();

        // Add an old-style SqlResource that's actually a view
        let view_sql_resource = SqlResource {
            name: "active_users".to_string(),
            database: None,
            source_file: Some("app/sql/views.ts".to_string()),
            source_line: None,
            source_column: None,
            setup: vec![
                "CREATE VIEW IF NOT EXISTS active_users AS SELECT * FROM users WHERE status = 'active'"
                    .to_string(),
            ],
            teardown: vec!["DROP VIEW IF EXISTS active_users".to_string()],
            pulls_data_from: vec![InfrastructureSignature::Table {
                id: "users".to_string(),
            }],
            pushes_data_to: vec![],
        };

        map.sql_resources
            .insert("active_users".to_string(), view_sql_resource);

        // Normalize should convert this to a View
        let normalized = map.normalize();

        // SqlResource should be removed
        assert!(
            normalized.sql_resources.is_empty(),
            "SqlResource should have been removed"
        );

        // View should be added
        assert_eq!(normalized.views.len(), 1, "Should have one view");

        let view = normalized
            .views
            .values()
            .next()
            .expect("Should have a view");
        assert_eq!(view.name, "active_users");
        assert!(view.select_sql.contains("SELECT * FROM users"));
        assert_eq!(
            view.metadata
                .as_ref()
                .and_then(|m| m.source.as_ref())
                .map(|s| s.file.clone()),
            Some("app/sql/views.ts".to_string())
        );
    }

    #[test]
    fn test_normalize_preserves_non_view_sql_resources() {
        let mut map = InfrastructureMap::default();

        // Add an SqlResource that's not a view (e.g., custom DDL)
        let custom_sql_resource = SqlResource {
            name: "custom_function".to_string(),
            database: None,
            source_file: None,
            source_line: None,
            source_column: None,
            setup: vec!["CREATE FUNCTION my_func AS () -> 42".to_string()],
            teardown: vec!["DROP FUNCTION my_func".to_string()],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };

        map.sql_resources
            .insert("custom_function".to_string(), custom_sql_resource);

        // Normalize should NOT convert this
        let normalized = map.normalize();

        // SqlResource should remain
        assert_eq!(
            normalized.sql_resources.len(),
            1,
            "Custom function SqlResource should be preserved"
        );
        assert!(
            normalized.materialized_views.is_empty(),
            "Should not have materialized views"
        );
        assert!(normalized.views.is_empty(), "Should not have views");
    }

    #[test]
    fn test_normalize_requires_matching_teardown() {
        let mut map = InfrastructureMap::default();

        // Add an SqlResource that looks like a MV but has wrong teardown
        // This should NOT be converted
        let wrong_teardown = SqlResource {
            name: "fake_mv".to_string(),
            database: None,
            source_file: None,
            source_line: None,
            source_column: None,
            setup: vec![
                "CREATE MATERIALIZED VIEW IF NOT EXISTS fake_mv TO target AS SELECT * FROM source"
                    .to_string(),
            ],
            // Wrong teardown - not moose-lib generated
            teardown: vec!["DROP TABLE fake_mv".to_string()],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };

        map.sql_resources
            .insert("fake_mv".to_string(), wrong_teardown);

        // Normalize should NOT convert this because teardown doesn't match
        let normalized = map.normalize();

        assert_eq!(
            normalized.sql_resources.len(),
            1,
            "SqlResource with wrong teardown should be preserved"
        );
        assert!(
            normalized.materialized_views.is_empty(),
            "Should not convert MV with wrong teardown"
        );
    }

    #[test]
    fn test_normalize_requires_exact_prefix() {
        let mut map = InfrastructureMap::default();

        // Add an SqlResource with lowercase CREATE (not moose-lib generated)
        let lowercase_sql = SqlResource {
            name: "lowercase_mv".to_string(),
            database: None,
            source_file: None,
            source_line: None,
            source_column: None,
            setup: vec![
                "create materialized view if not exists lowercase_mv TO target AS SELECT * FROM source"
                    .to_string(),
            ],
            teardown: vec!["DROP VIEW IF EXISTS lowercase_mv".to_string()],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };

        map.sql_resources
            .insert("lowercase_mv".to_string(), lowercase_sql);

        // Normalize should NOT convert this because it doesn't match exact moose-lib format
        let normalized = map.normalize();

        assert_eq!(
            normalized.sql_resources.len(),
            1,
            "SqlResource with lowercase SQL should be preserved"
        );
        assert!(
            normalized.materialized_views.is_empty(),
            "Should not convert MV with lowercase prefix"
        );
    }

    #[test]
    fn test_normalize_requires_single_statement() {
        let mut map = InfrastructureMap::default();

        // Add an SqlResource with multiple setup statements (not moose-lib generated)
        let multi_setup = SqlResource {
            name: "multi_mv".to_string(),
            database: None,
            source_file: None,
            source_line: None,
            source_column: None,
            setup: vec![
                "CREATE MATERIALIZED VIEW IF NOT EXISTS multi_mv TO target AS SELECT * FROM source"
                    .to_string(),
                "INSERT INTO target SELECT * FROM source".to_string(), // extra statement
            ],
            teardown: vec!["DROP VIEW IF EXISTS multi_mv".to_string()],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };

        map.sql_resources
            .insert("multi_mv".to_string(), multi_setup);

        // Normalize should NOT convert this because moose-lib only generates 1 setup statement
        let normalized = map.normalize();

        assert_eq!(
            normalized.sql_resources.len(),
            1,
            "SqlResource with multiple setup statements should be preserved"
        );
        assert!(
            normalized.materialized_views.is_empty(),
            "Should not convert MV with multiple setup statements"
        );
    }

    #[test]
    fn test_normalize_mv_requires_to_clause() {
        let mut map = InfrastructureMap::default();

        // Add an SqlResource that's a MV but missing TO clause (malformed)
        let missing_to = SqlResource {
            name: "no_to_mv".to_string(),
            database: None,
            source_file: None,
            source_line: None,
            source_column: None,
            setup: vec![
                "CREATE MATERIALIZED VIEW IF NOT EXISTS no_to_mv AS SELECT * FROM source"
                    .to_string(),
            ],
            teardown: vec!["DROP VIEW IF EXISTS no_to_mv".to_string()],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };

        map.sql_resources.insert("no_to_mv".to_string(), missing_to);

        // Normalize should NOT convert this because MV must have TO clause
        let normalized = map.normalize();

        assert_eq!(
            normalized.sql_resources.len(),
            1,
            "SqlResource MV without TO clause should be preserved"
        );
        assert!(
            normalized.materialized_views.is_empty(),
            "Should not convert MV without TO clause"
        );
    }
}

#[cfg(test)]
mod diff_workflow_tests {
    use super::*;
    use crate::framework::languages::SupportedLanguages;
    use crate::framework::scripts::Workflow;

    fn create_test_workflow(name: &str, schedule: &str, retries: u32, timeout: &str) -> Workflow {
        Workflow::from_user_code(
            name.to_string(),
            SupportedLanguages::Typescript,
            Some(retries),
            Some(timeout.to_string()),
            if schedule.is_empty() {
                None
            } else {
                Some(schedule.to_string())
            },
        )
        .unwrap()
    }

    #[test]
    fn test_workflow_added() {
        let current: HashMap<String, Workflow> = HashMap::new();
        let mut target: HashMap<String, Workflow> = HashMap::new();

        let workflow = create_test_workflow("my_workflow", "1h", 3, "30s");
        target.insert("my_workflow".to_string(), workflow);

        let mut changes = vec![];
        InfrastructureMap::diff_workflows(&current, &target, &mut changes);

        assert_eq!(changes.len(), 1);
        match &changes[0] {
            WorkflowChange::Workflow(Change::Added(w)) => {
                assert_eq!(w.name(), "my_workflow");
            }
            _ => panic!("Expected Added change"),
        }
    }

    #[test]
    fn test_workflow_removed() {
        let mut current: HashMap<String, Workflow> = HashMap::new();
        let target: HashMap<String, Workflow> = HashMap::new();

        let workflow = create_test_workflow("my_workflow", "1h", 3, "30s");
        current.insert("my_workflow".to_string(), workflow);

        let mut changes = vec![];
        InfrastructureMap::diff_workflows(&current, &target, &mut changes);

        assert_eq!(changes.len(), 1);
        match &changes[0] {
            WorkflowChange::Workflow(Change::Removed(w)) => {
                assert_eq!(w.name(), "my_workflow");
            }
            _ => panic!("Expected Removed change"),
        }
    }

    #[test]
    fn test_workflow_schedule_change_triggers_update() {
        let mut current: HashMap<String, Workflow> = HashMap::new();
        let mut target: HashMap<String, Workflow> = HashMap::new();

        let workflow_v1 = create_test_workflow("my_workflow", "1h", 3, "30s");
        let workflow_v2 = create_test_workflow("my_workflow", "2h", 3, "30s");

        current.insert("my_workflow".to_string(), workflow_v1);
        target.insert("my_workflow".to_string(), workflow_v2);

        let mut changes = vec![];
        InfrastructureMap::diff_workflows(&current, &target, &mut changes);

        assert_eq!(changes.len(), 1);
        match &changes[0] {
            WorkflowChange::Workflow(Change::Updated { before, after }) => {
                assert_eq!(before.config().schedule, "1h");
                assert_eq!(after.config().schedule, "2h");
            }
            _ => panic!("Expected Updated change"),
        }
    }

    #[test]
    fn test_workflow_retries_change_triggers_update() {
        let mut current: HashMap<String, Workflow> = HashMap::new();
        let mut target: HashMap<String, Workflow> = HashMap::new();

        let workflow_v1 = create_test_workflow("my_workflow", "1h", 3, "30s");
        let workflow_v2 = create_test_workflow("my_workflow", "1h", 5, "30s");

        current.insert("my_workflow".to_string(), workflow_v1);
        target.insert("my_workflow".to_string(), workflow_v2);

        let mut changes = vec![];
        InfrastructureMap::diff_workflows(&current, &target, &mut changes);

        assert_eq!(changes.len(), 1);
        match &changes[0] {
            WorkflowChange::Workflow(Change::Updated { before, after }) => {
                assert_eq!(before.config().retries, 3);
                assert_eq!(after.config().retries, 5);
            }
            _ => panic!("Expected Updated change"),
        }
    }

    #[test]
    fn test_workflow_timeout_change_triggers_update() {
        let mut current: HashMap<String, Workflow> = HashMap::new();
        let mut target: HashMap<String, Workflow> = HashMap::new();

        let workflow_v1 = create_test_workflow("my_workflow", "1h", 3, "30s");
        let workflow_v2 = create_test_workflow("my_workflow", "1h", 3, "60s");

        current.insert("my_workflow".to_string(), workflow_v1);
        target.insert("my_workflow".to_string(), workflow_v2);

        let mut changes = vec![];
        InfrastructureMap::diff_workflows(&current, &target, &mut changes);

        assert_eq!(changes.len(), 1);
        match &changes[0] {
            WorkflowChange::Workflow(Change::Updated { before, after }) => {
                assert_eq!(before.config().timeout, "30s");
                assert_eq!(after.config().timeout, "60s");
            }
            _ => panic!("Expected Updated change"),
        }
    }

    #[test]
    fn test_workflow_no_change_when_identical() {
        let mut current: HashMap<String, Workflow> = HashMap::new();
        let mut target: HashMap<String, Workflow> = HashMap::new();

        let workflow_v1 = create_test_workflow("my_workflow", "1h", 3, "30s");
        let workflow_v2 = create_test_workflow("my_workflow", "1h", 3, "30s");

        current.insert("my_workflow".to_string(), workflow_v1);
        target.insert("my_workflow".to_string(), workflow_v2);

        let mut changes = vec![];
        InfrastructureMap::diff_workflows(&current, &target, &mut changes);

        assert!(
            changes.is_empty(),
            "No changes expected for identical workflows"
        );
    }

    #[test]
    fn test_workflow_schedule_added_triggers_update() {
        let mut current: HashMap<String, Workflow> = HashMap::new();
        let mut target: HashMap<String, Workflow> = HashMap::new();

        // Workflow without schedule
        let workflow_v1 = create_test_workflow("my_workflow", "", 3, "30s");
        // Same workflow with schedule added
        let workflow_v2 = create_test_workflow("my_workflow", "@hourly", 3, "30s");

        current.insert("my_workflow".to_string(), workflow_v1);
        target.insert("my_workflow".to_string(), workflow_v2);

        let mut changes = vec![];
        InfrastructureMap::diff_workflows(&current, &target, &mut changes);

        assert_eq!(changes.len(), 1);
        match &changes[0] {
            WorkflowChange::Workflow(Change::Updated { before, after }) => {
                assert!(before.config().schedule.is_empty());
                assert_eq!(after.config().schedule, "@hourly");
            }
            _ => panic!("Expected Updated change when schedule is added"),
        }
    }

    #[test]
    fn test_workflow_schedule_removed_triggers_update() {
        let mut current: HashMap<String, Workflow> = HashMap::new();
        let mut target: HashMap<String, Workflow> = HashMap::new();

        // Workflow with schedule
        let workflow_v1 = create_test_workflow("my_workflow", "@hourly", 3, "30s");
        // Same workflow with schedule removed
        let workflow_v2 = create_test_workflow("my_workflow", "", 3, "30s");

        current.insert("my_workflow".to_string(), workflow_v1);
        target.insert("my_workflow".to_string(), workflow_v2);

        let mut changes = vec![];
        InfrastructureMap::diff_workflows(&current, &target, &mut changes);

        assert_eq!(changes.len(), 1);
        match &changes[0] {
            WorkflowChange::Workflow(Change::Updated { before, after }) => {
                assert_eq!(before.config().schedule, "@hourly");
                assert!(after.config().schedule.is_empty());
            }
            _ => panic!("Expected Updated change when schedule is removed"),
        }
    }

    #[test]
    fn test_workflow_upgrade_scenario_all_added() {
        // Simulates upgrade from old Moose where inframap has no workflows
        let current: HashMap<String, Workflow> = HashMap::new();
        let mut target: HashMap<String, Workflow> = HashMap::new();

        let workflow1 = create_test_workflow("workflow_a", "@hourly", 3, "30s");
        let workflow2 = create_test_workflow("workflow_b", "", 5, "60s");
        target.insert("workflow_a".to_string(), workflow1);
        target.insert("workflow_b".to_string(), workflow2);

        let mut changes = vec![];
        InfrastructureMap::diff_workflows(&current, &target, &mut changes);

        assert_eq!(changes.len(), 2);
        let added_names: Vec<_> = changes
            .iter()
            .filter_map(|c| match c {
                WorkflowChange::Workflow(Change::Added(w)) => Some(w.name()),
                _ => None,
            })
            .collect();
        assert!(added_names.contains(&"workflow_a"));
        assert!(added_names.contains(&"workflow_b"));
    }
}

#[cfg(test)]
mod version_tests {
    use super::*;

    #[test]
    fn test_proto_roundtrip_with_version() {
        let map = InfrastructureMap {
            moose_version: Some("0.3.45".to_string()),
            ..Default::default()
        };

        let bytes = map.to_proto_bytes();
        let decoded = InfrastructureMap::from_proto(bytes).unwrap();

        assert_eq!(decoded.moose_version, Some("0.3.45".to_string()));
    }

    #[test]
    fn test_proto_roundtrip_without_version() {
        let map = InfrastructureMap {
            moose_version: None,
            ..Default::default()
        };

        let bytes = map.to_proto_bytes();
        let decoded = InfrastructureMap::from_proto(bytes).unwrap();

        assert_eq!(decoded.moose_version, None);
    }

    #[test]
    fn test_backward_compatibility_json() {
        let old_json = r#"{
            "default_database": "test_db",
            "topics": {},
            "tables": {},
            "api_endpoints": {},
            "dmv1_views": {},
            "topic_to_table_sync_processes": {},
            "topic_to_topic_sync_processes": {},
            "function_processes": {},
            "consumption_api_web_server": {},
            "orchestration_workers": {},
            "sql_resources": {},
            "workflows": {},
            "web_apps": {},
            "materialized_views": {},
            "views": {}
        }"#;

        let map: InfrastructureMap = serde_json::from_str(old_json).unwrap();
        assert_eq!(map.moose_version, None);
    }

    #[test]
    fn test_version_serialization_skips_none() {
        let map = InfrastructureMap {
            moose_version: None,
            ..Default::default()
        };

        let json = serde_json::to_string(&map).unwrap();
        assert!(!json.contains("moose_version"), "None should be skipped");
    }

    #[test]
    fn test_version_serialization_includes_some() {
        let map = InfrastructureMap {
            moose_version: Some("1.2.3".to_string()),
            ..Default::default()
        };

        let json = serde_json::to_string(&map).unwrap();
        assert!(json.contains("\"moose_version\":\"1.2.3\""));
    }
}

#[cfg(test)]
mod mirrorable_external_tables_tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{Column, ColumnType, IntType};
    use crate::framework::versions::Version;
    use crate::infrastructure::olap::clickhouse::config::DEFAULT_DATABASE_NAME;

    #[test]
    fn test_get_mirrorable_external_tables() {
        let mut map = InfrastructureMap::default();

        // 1. ExternallyManaged table with MergeTree engine (supports SELECT) - SHOULD be returned
        let external_mergetree = Table {
            name: "external_mergetree".to_string(),
            engine: ClickhouseEngine::MergeTree,
            columns: vec![Column {
                name: "id".to_string(),
                data_type: ColumnType::Int(IntType::Int64),
                required: true,
                unique: false,
                primary_key: true,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
                codec: None,
                materialized: None,
            }],
            order_by: OrderBy::Fields(vec!["id".to_string()]),
            partition_by: None,
            sample_by: None,
            version: Some(Version::from_string("1.0".to_string())),
            source_primitive: PrimitiveSignature {
                name: "test".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::ExternallyManaged,
            engine_params_hash: None,
            table_settings_hash: None,
            table_settings: None,
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
        };

        // 2. ExternallyManaged table with Kafka engine (write-only) - should NOT be returned
        let external_kafka = Table {
            name: "external_kafka".to_string(),
            engine: ClickhouseEngine::Kafka {
                broker_list: "localhost:9092".to_string(),
                topic_list: "test_topic".to_string(),
                group_name: "test_group".to_string(),
                format: "JSONEachRow".to_string(),
            },
            columns: vec![Column {
                name: "id".to_string(),
                data_type: ColumnType::Int(IntType::Int64),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
                codec: None,
                materialized: None,
            }],
            order_by: OrderBy::Fields(vec![]),
            partition_by: None,
            sample_by: None,
            version: Some(Version::from_string("1.0".to_string())),
            source_primitive: PrimitiveSignature {
                name: "test".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::ExternallyManaged,
            engine_params_hash: None,
            table_settings_hash: None,
            table_settings: None,
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
        };

        // 3. FullyManaged table with MergeTree (supports SELECT but wrong lifecycle) - should NOT be returned
        let mut managed_mergetree = external_mergetree.clone();
        managed_mergetree.name = "managed_mergetree".to_string();
        managed_mergetree.life_cycle = LifeCycle::FullyManaged;

        // Insert tables into the map
        map.tables.insert(
            external_mergetree.id(DEFAULT_DATABASE_NAME),
            external_mergetree.clone(),
        );
        map.tables.insert(
            external_kafka.id(DEFAULT_DATABASE_NAME),
            external_kafka.clone(),
        );
        map.tables.insert(
            managed_mergetree.id(DEFAULT_DATABASE_NAME),
            managed_mergetree.clone(),
        );

        // Call the method under test
        let mirrorable = map.get_mirrorable_external_tables();

        // Assert: should only return the ExternallyManaged MergeTree table
        assert_eq!(
            mirrorable.len(),
            1,
            "Should return exactly 1 mirrorable table"
        );
        assert_eq!(
            mirrorable[0].name, "external_mergetree",
            "Should return the ExternallyManaged MergeTree table"
        );

        // Verify the Kafka table (write-only engine) is NOT included
        assert!(
            !mirrorable.iter().any(|t| t.name == "external_kafka"),
            "Kafka table should not be mirrorable (write-only engine)"
        );

        // Verify the FullyManaged table is NOT included
        assert!(
            !mirrorable.iter().any(|t| t.name == "managed_mergetree"),
            "FullyManaged table should not be mirrorable (wrong lifecycle)"
        );
    }
}
