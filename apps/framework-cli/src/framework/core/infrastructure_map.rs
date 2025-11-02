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
use super::infrastructure::olap_process::OlapProcess;
use super::infrastructure::orchestration_worker::OrchestrationWorker;
use super::infrastructure::sql_resource::SqlResource;
use super::infrastructure::table::{Column, OrderBy, Table};
use super::infrastructure::topic::Topic;
use super::infrastructure::topic_sync_process::{TopicToTableSyncProcess, TopicToTopicSyncProcess};
use super::infrastructure::view::View;
use super::partial_infrastructure_map::LifeCycle;
use super::partial_infrastructure_map::PartialInfrastructureMap;
use super::primitive_map::PrimitiveMap;
use crate::cli::display::{show_message_wrapper, Message, MessageType};
use crate::framework::core::infra_reality_checker::find_table_from_infra_map;
use crate::framework::core::infrastructure_map::Change::Added;
use crate::framework::languages::SupportedLanguages;
use crate::framework::python::datamodel_config::load_main_py;
use crate::framework::scripts::Workflow;
use crate::infrastructure::olap::clickhouse::config::DEFAULT_DATABASE_NAME;
use crate::infrastructure::redis::redis_client::RedisClient;
use crate::project::Project;
use crate::proto::infrastructure_map::InfrastructureMap as ProtoInfrastructureMap;
use anyhow::{Context, Result};
use protobuf::{EnumOrUnknown, Message as ProtoMessage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

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
        _default_database: &str,
    ) -> Vec<OlapChange> {
        // Most databases can handle all changes via ALTER TABLE operations
        // Return the standard table update change
        vec![OlapChange::Table(TableChange::Updated {
            name: before.name.clone(),
            column_changes,
            order_by_change,
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

/// Signature that uniquely identifies a primitive component
///
/// This combines the name and type of a primitive to provide a consistent
/// way to reference primitives throughout the system.
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
    /// Change to a database view
    View(Change<View>),
    SqlResource(Change<SqlResource>),
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
    /// Change to an OLAP process
    OlapProcess(Change<OlapProcess>),
    /// Change to a consumption API web server
    ConsumptionApiWebServer(Change<ConsumptionApiWebServer>),
    /// Change to an orchestration worker
    OrchestrationWorker(Change<OrchestrationWorker>),
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
}

impl InfraChanges {
    /// Checks if there are any changes in this collection
    ///
    /// Returns true if all change vectors are empty, false otherwise.
    pub fn is_empty(&self) -> bool {
        self.olap_changes.is_empty()
            && self.processes_changes.is_empty()
            && self.api_changes.is_empty()
            && self.web_app_changes.is_empty()
            && self.streaming_engine_changes.is_empty()
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InfrastructureMap {
    #[serde(default = "default_database_name")]
    pub default_database: String,
    /// Collection of topics indexed by topic ID
    pub topics: HashMap<String, Topic>,

    /// Collection of API endpoints indexed by endpoint ID
    pub api_endpoints: HashMap<String, ApiEndpoint>,

    /// Collection of database tables indexed by table name
    pub tables: HashMap<String, Table>,

    /// Collection of database views indexed by view name
    pub views: HashMap<String, View>,

    /// Processes that sync data from topics to tables
    pub topic_to_table_sync_processes: HashMap<String, TopicToTableSyncProcess>,

    /// Processes that sync data between topics
    #[serde(default = "HashMap::new")]
    pub topic_to_topic_sync_processes: HashMap<String, TopicToTopicSyncProcess>,

    /// Collection of function processes that transform data
    pub function_processes: HashMap<String, FunctionProcess>,

    /// Process handling OLAP database operations
    // TODO change to a hashmap of processes when we have several
    pub block_db_processes: OlapProcess,

    /// Web server handling consumption API endpoints
    // Not sure if we will want to change that or not in the future to be able to tell
    // the new consumption endpoints that were added or removed.
    pub consumption_api_web_server: ConsumptionApiWebServer,

    /// Collection of orchestration workers indexed by worker ID
    #[serde(default = "HashMap::new")]
    pub orchestration_workers: HashMap<String, OrchestrationWorker>,

    /// resources that have setup and teardown
    #[serde(default)]
    pub sql_resources: HashMap<String, SqlResource>,

    /// Collection of workflows indexed by workflow name
    #[serde(default)]
    pub workflows: HashMap<String, Workflow>,

    /// Collection of web applications indexed by name
    #[serde(default)]
    pub web_apps: HashMap<String, super::infrastructure::web_app::WebApp>,
}

impl InfrastructureMap {
    /// Creates a new infrastructure map from a project and primitive map
    ///
    /// This is the primary constructor for creating an infrastructure map. It transforms
    /// the high-level primitives (data models, functions, blocks, etc.) into concrete
    /// infrastructure components and their relationships.
    ///
    /// The method handles complex logic like:
    /// - Processing data models with version changes first
    /// - Creating appropriate infrastructure for each primitive type
    /// - Setting up relationships between components
    /// - Handling special cases for unchanged components with version changes
    ///
    /// # Arguments
    /// * `project` - The project context with configuration and features
    /// * `primitive_map` - The map of primitives to transform into infrastructure
    ///
    /// # Returns
    /// A complete infrastructure map with all components and their relationships
    pub fn new(project: &Project, primitive_map: PrimitiveMap) -> InfrastructureMap {
        // Get the default database name from the project configuration
        let default_database = &project.clickhouse_config.db_name;
        let mut tables = HashMap::new();
        let mut views = HashMap::new();
        let mut topics = HashMap::new();
        let mut api_endpoints = HashMap::new();
        let mut topic_to_table_sync_processes = HashMap::new();
        let topic_to_topic_sync_processes = HashMap::new();
        let mut function_processes = HashMap::new();

        // Process data models that have changes in their latest version
        // This ensures we create new infrastructure for updated data models first
        let mut data_models_that_have_not_changed_with_new_version = vec![];

        // Iterate through data models and process those that have changes
        for data_model in primitive_map.data_models_iter() {
            // Check if the data model has changed compared to its previous version
            if primitive_map
                .datamodels
                .has_data_model_changed_with_previous_version(
                    &data_model.name,
                    data_model.version.as_str(),
                )
            {
                let topic = Topic::from_data_model(data_model);
                let api_endpoint = ApiEndpoint::from_data_model(data_model, &topic);

                // If storage is enabled for this data model, create necessary infrastructure
                if data_model.config.storage.enabled {
                    let table = data_model.to_table();
                    let topic_to_table_sync_process =
                        TopicToTableSyncProcess::new(&topic, &table, default_database);

                    tables.insert(table.id(default_database), table);
                    topic_to_table_sync_processes.insert(
                        topic_to_table_sync_process.id(),
                        topic_to_table_sync_process,
                    );
                }

                // If streaming engine is enabled, create topics and API endpoints
                if project.features.streaming_engine {
                    topics.insert(topic.id(), topic);
                    api_endpoints.insert(api_endpoint.id(), api_endpoint);
                }
            } else {
                // Store unchanged data models for later processing
                // This allows us to reference infrastructure created by older versions
                data_models_that_have_not_changed_with_new_version.push(data_model);
            }
        }

        // Process data models that haven't changed with their registered versions
        // For those requiring storage, we create views pointing to the oldest table
        // that has the data with the same schema. We also reuse existing topics.
        for data_model in data_models_that_have_not_changed_with_new_version {
            match primitive_map
                .datamodels
                .find_earliest_similar_version(&data_model.name, data_model.version.as_str())
            {
                Some(previous_version_model) => {
                    // This will be already created with the previous data model.
                    // That's why we don't add it to the map
                    let previous_version_topic = Topic::from_data_model(previous_version_model);
                    let api_endpoint =
                        ApiEndpoint::from_data_model(data_model, &previous_version_topic);

                    if data_model.config.storage.enabled
                        && previous_version_model.config.storage.enabled
                    {
                        let view = View::alias_view(data_model, previous_version_model);
                        views.insert(view.id(), view);
                    }

                    if project.features.streaming_engine {
                        api_endpoints.insert(api_endpoint.id(), api_endpoint);
                    }
                }
                None => {
                    log::error!(
                        "Could not find previous version with no change for data model: {} {}",
                        data_model.name,
                        data_model.version
                    );
                    log::debug!("Data Models Dump: {:?}", primitive_map.datamodels);
                }
            }
        }

        if !project.features.streaming_engine && !primitive_map.functions.is_empty() {
            log::error!("Streaming disabled. Functions are disabled.");
            show_message_wrapper(
                MessageType::Error,
                Message {
                    action: "Disabled".to_string(),
                    details: format!(
                        "Streaming is disabled but {} function(s) found.",
                        primitive_map.functions.len()
                    ),
                },
            );
        } else {
            for function in primitive_map.functions.iter() {
                // Currently we are not creating 1 per function source and target.
                // We reuse the topics that were created from the data models.
                // Unless for streaming function migrations where we will have to create new topics.

                let function_process = FunctionProcess::from_function(function, &topics);
                function_processes.insert(function_process.id(), function_process);
            }
        }

        // TODO update here when we have several blocks processes
        let block_db_processes = OlapProcess::from_blocks(&primitive_map.blocks);

        // consumption api endpoints
        let consumption_api_web_server = ConsumptionApiWebServer {};
        if !project.features.apis && !primitive_map.consumption.endpoint_files.is_empty() {
            log::error!("Analytics APIs disabled. API endpoints will not be available.");
            show_message_wrapper(
                MessageType::Error,
                Message {
                    action: "Disabled".to_string(),
                    details: format!(
                        "Analytics APIs feature is disabled but {} API endpoint(s) found. Enable 'apis = true' in moose.config.toml.",
                        primitive_map.consumption.endpoint_files.len()
                    ),
                },
            );
        } else {
            for api_endpoint in primitive_map.consumption.endpoint_files {
                let api_endpoint_infra = ApiEndpoint::from(api_endpoint);
                api_endpoints.insert(api_endpoint_infra.id(), api_endpoint_infra);
            }
        }

        // Orchestration workers
        let mut orchestration_workers = HashMap::new();
        let orchestration_worker = OrchestrationWorker::new(project.language);
        orchestration_workers.insert(orchestration_worker.id(), orchestration_worker);

        InfrastructureMap {
            default_database: default_database.clone(),
            topics,
            api_endpoints,
            topic_to_table_sync_processes,
            topic_to_topic_sync_processes,
            tables,
            views,
            function_processes,
            block_db_processes,
            consumption_api_web_server,
            orchestration_workers,
            sql_resources: Default::default(),
            workflows: Default::default(),
            web_apps: Default::default(),
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
        }
    }

    /// Creates changes for initial topic deployment
    ///
    /// Generates changes representing the creation of all topics in this map.
    ///
    /// # Returns
    /// A vector of `StreamingChange` objects for topic creation
    pub fn init_topics(&self) -> Vec<StreamingChange> {
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
    pub fn init_tables(&self) -> Vec<OlapChange> {
        self.tables
            .values()
            .map(|table| OlapChange::Table(TableChange::Added(table.clone())))
            .chain(
                self.sql_resources
                    .values()
                    .map(|resource| OlapChange::SqlResource(Added(Box::new(resource.clone())))),
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

        // TODO Change this when we have multiple processes for blocks
        // Only add OLAP process if OLAP is enabled
        if project.features.olap {
            process_changes.push(ProcessChange::OlapProcess(Change::<OlapProcess>::Added(
                Box::new(OlapProcess {}),
            )));
        }

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
        log::info!("Analyzing changes in Tables...");
        let olap_changes_len_before = changes.olap_changes.len();
        Self::diff_tables_with_strategy(
            &self.tables,
            &target_map.tables,
            &mut changes.olap_changes,
            table_diff_strategy,
            respect_life_cycle,
            &target_map.default_database,
        );
        let table_changes = changes.olap_changes.len() - olap_changes_len_before;
        log::info!("Table changes detected: {}", table_changes);

        // Views
        Self::diff_views(&self.views, &target_map.views, &mut changes.olap_changes);

        // SQL Resources (needs tables context for MV population detection)
        log::info!("Analyzing changes in SQL Resources...");
        let olap_changes_len_before = changes.olap_changes.len();
        Self::diff_sql_resources(
            &self.sql_resources,
            &target_map.sql_resources,
            &target_map.tables, // Pass target tables for MV analysis
            is_production,
            &mut changes.olap_changes,
        );
        let sql_resource_changes = changes.olap_changes.len() - olap_changes_len_before;
        log::info!("SQL Resource changes detected: {}", sql_resource_changes);

        // All process types
        self.diff_all_processes(target_map, &mut changes.processes_changes);

        // Summary
        log::info!(
            "Total changes detected - OLAP: {}, Processes: {}, API: {}, WebApps: {}, Streaming: {}",
            changes.olap_changes.len(),
            changes.processes_changes.len(),
            changes.api_changes.len(),
            changes.web_app_changes.len(),
            changes.streaming_engine_changes.len()
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
        log::info!("Analyzing changes in Topics...");
        let mut topic_updates = 0;
        let mut topic_removals = 0;
        let mut topic_additions = 0;

        for (id, topic) in self_topics {
            if let Some(target_topic) = target_topics.get(id) {
                if !topics_equal_ignore_metadata(topic, target_topic) {
                    // Respect lifecycle: ExternallyManaged topics are never modified
                    if target_topic.life_cycle == LifeCycle::ExternallyManaged && respect_life_cycle
                    {
                        log::debug!(
                            "Topic '{}' has changes but is externally managed - skipping update",
                            topic.name
                        );
                    } else {
                        log::debug!("Topic updated: {} ({})", topic.name, id);
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
                        log::debug!("Topic removed: {} ({})", topic.name, id);
                        topic_removals += 1;
                        streaming_changes.push(StreamingChange::Topic(Change::<Topic>::Removed(
                            Box::new(topic.clone()),
                        )));
                    }
                    (LifeCycle::DeletionProtected, true) => {
                        log::debug!(
                            "Topic '{}' marked for removal but is deletion-protected - skipping removal",
                            topic.name
                        );
                    }
                    (LifeCycle::ExternallyManaged, true) => {
                        log::debug!(
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
                    log::debug!(
                        "Topic '{}' marked for addition but is externally managed - skipping addition",
                        topic.name
                    );
                } else {
                    log::debug!("Topic added: {} ({})", topic.name, id);
                    topic_additions += 1;
                    streaming_changes.push(StreamingChange::Topic(Change::<Topic>::Added(
                        Box::new(topic.clone()),
                    )));
                }
            }
        }

        log::info!(
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
        log::info!("Analyzing changes in API Endpoints...");
        let mut endpoint_updates = 0;
        let mut endpoint_removals = 0;
        let mut endpoint_additions = 0;

        for (id, endpoint) in self_endpoints {
            if let Some(target_endpoint) = target_endpoints.get(id) {
                if !api_endpoints_equal_ignore_metadata(endpoint, target_endpoint) {
                    log::debug!("API Endpoint updated: {}", id);
                    endpoint_updates += 1;
                    api_changes.push(ApiChange::ApiEndpoint(Change::<ApiEndpoint>::Updated {
                        before: Box::new(endpoint.clone()),
                        after: Box::new(target_endpoint.clone()),
                    }));
                }
            } else {
                log::debug!("API Endpoint removed: {}", id);
                endpoint_removals += 1;
                api_changes.push(ApiChange::ApiEndpoint(Change::<ApiEndpoint>::Removed(
                    Box::new(endpoint.clone()),
                )));
            }
        }

        for (id, endpoint) in target_endpoints {
            if !self_endpoints.contains_key(id) {
                log::debug!("API Endpoint added: {}", id);
                endpoint_additions += 1;
                api_changes.push(ApiChange::ApiEndpoint(Change::<ApiEndpoint>::Added(
                    Box::new(endpoint.clone()),
                )));
            }
        }

        log::info!(
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
        log::info!("Analyzing changes in WebApps...");
        let mut webapp_updates = 0;
        let mut webapp_removals = 0;
        let mut webapp_additions = 0;

        for (id, webapp) in self_web_apps {
            if let Some(target_webapp) = target_web_apps.get(id) {
                if webapp != target_webapp {
                    log::debug!("WebApp updated: {}", id);
                    webapp_updates += 1;
                    web_app_changes.push(WebAppChange::WebApp(Change::Updated {
                        before: Box::new(webapp.clone()),
                        after: Box::new(target_webapp.clone()),
                    }));
                }
            } else {
                log::debug!("WebApp removed: {}", id);
                webapp_removals += 1;
                web_app_changes.push(WebAppChange::WebApp(Change::Removed(Box::new(
                    webapp.clone(),
                ))));
            }
        }

        for (id, webapp) in target_web_apps {
            if !self_web_apps.contains_key(id) {
                log::debug!("WebApp added: {}", id);
                webapp_additions += 1;
                web_app_changes.push(WebAppChange::WebApp(Change::Added(Box::new(
                    webapp.clone(),
                ))));
            }
        }

        log::info!(
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
    fn diff_views(
        self_views: &HashMap<String, View>,
        target_views: &HashMap<String, View>,
        olap_changes: &mut Vec<OlapChange>,
    ) -> (usize, usize, usize) {
        log::info!("Analyzing changes in Views...");
        let mut view_updates = 0;
        let mut view_removals = 0;
        let mut view_additions = 0;

        // Check for updates and removals
        for (id, view) in self_views {
            if let Some(target_view) = target_views.get(id) {
                if view != target_view {
                    log::debug!("View updated: {} ({})", view.name, id);
                    view_updates += 1;
                    olap_changes.push(OlapChange::View(Change::Updated {
                        before: Box::new(view.clone()),
                        after: Box::new(target_view.clone()),
                    }));
                }
            } else {
                log::debug!("View removed: {} ({})", view.name, id);
                view_removals += 1;
                olap_changes.push(OlapChange::View(Change::Removed(Box::new(view.clone()))));
            }
        }

        // Check for additions
        for (id, view) in target_views {
            if !self_views.contains_key(id) {
                log::debug!("View added: {} ({})", view.name, id);
                view_additions += 1;
                olap_changes.push(OlapChange::View(Change::Added(Box::new(view.clone()))));
            }
        }

        log::info!(
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

        Self::diff_olap_processes(
            &self.block_db_processes,
            &target_map.block_db_processes,
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

    /// Compare TopicToTableSyncProcess changes between two infrastructure maps
    fn diff_topic_to_table_sync_processes(
        self_processes: &HashMap<String, TopicToTableSyncProcess>,
        target_processes: &HashMap<String, TopicToTableSyncProcess>,
        process_changes: &mut Vec<ProcessChange>,
    ) -> (usize, usize, usize) {
        log::info!("Analyzing changes in Topic-to-Table Sync Processes...");
        let mut process_updates = 0;
        let mut process_removals = 0;
        let mut process_additions = 0;

        for (id, process) in self_processes {
            if let Some(target_process) = target_processes.get(id) {
                if process != target_process {
                    log::debug!("TopicToTableSyncProcess updated: {}", id);
                    process_updates += 1;
                    process_changes.push(ProcessChange::TopicToTableSyncProcess(Change::<
                        TopicToTableSyncProcess,
                    >::Updated {
                        before: Box::new(process.clone()),
                        after: Box::new(target_process.clone()),
                    }));
                }
            } else {
                log::debug!("TopicToTableSyncProcess removed: {}", id);
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
                log::debug!("TopicToTableSyncProcess added: {}", id);
                process_additions += 1;
                process_changes.push(ProcessChange::TopicToTableSyncProcess(Change::<
                    TopicToTableSyncProcess,
                >::Added(
                    Box::new(process.clone()),
                )));
            }
        }

        log::info!(
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
        log::info!("Analyzing changes in Topic-to-Topic Sync Processes...");
        let mut process_updates = 0;
        let mut process_removals = 0;
        let mut process_additions = 0;

        for (id, process) in self_processes {
            if let Some(target_process) = target_processes.get(id) {
                if process != target_process {
                    log::debug!("TopicToTopicSyncProcess updated: {}", id);
                    process_updates += 1;
                    process_changes.push(ProcessChange::TopicToTopicSyncProcess(Change::<
                        TopicToTopicSyncProcess,
                    >::Updated {
                        before: Box::new(process.clone()),
                        after: Box::new(target_process.clone()),
                    }));
                }
            } else {
                log::debug!("TopicToTopicSyncProcess removed: {}", id);
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
                log::debug!("TopicToTopicSyncProcess added: {}", id);
                process_additions += 1;
                process_changes.push(ProcessChange::TopicToTopicSyncProcess(Change::<
                    TopicToTopicSyncProcess,
                >::Added(
                    Box::new(process.clone()),
                )));
            }
        }

        log::info!(
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
        log::info!("Analyzing changes in Function Processes...");
        let mut process_updates = 0;
        let mut process_removals = 0;
        let mut process_additions = 0;

        for (id, process) in self_processes {
            if let Some(target_process) = target_processes.get(id) {
                // Always treat function processes as updated if they exist in both maps
                // This ensures function code changes are always redeployed
                log::debug!("FunctionProcess updated (forced): {}", id);
                process_updates += 1;
                process_changes.push(ProcessChange::FunctionProcess(
                    Change::<FunctionProcess>::Updated {
                        before: Box::new(process.clone()),
                        after: Box::new(target_process.clone()),
                    },
                ));
            } else {
                log::debug!("FunctionProcess removed: {}", id);
                process_removals += 1;
                process_changes.push(ProcessChange::FunctionProcess(
                    Change::<FunctionProcess>::Removed(Box::new(process.clone())),
                ));
            }
        }

        for (id, process) in target_processes {
            if !self_processes.contains_key(id) {
                log::debug!("FunctionProcess added: {}", id);
                process_additions += 1;
                process_changes.push(ProcessChange::FunctionProcess(
                    Change::<FunctionProcess>::Added(Box::new(process.clone())),
                ));
            }
        }

        log::info!(
            "Function Process changes: {} added, {} removed, {} updated",
            process_additions,
            process_removals,
            process_updates
        );

        (process_additions, process_removals, process_updates)
    }

    /// Compare OLAP process changes between two infrastructure maps
    fn diff_olap_processes(
        self_process: &OlapProcess,
        target_process: &OlapProcess,
        process_changes: &mut Vec<ProcessChange>,
    ) {
        log::info!("Analyzing changes in OLAP processes...");

        // Currently we assume there is always a change and restart the processes
        // TODO: Once we refactor to have multiple processes, we should compare actual changes
        log::debug!("OLAP Process updated (assumed for now)");
        process_changes.push(ProcessChange::OlapProcess(Change::<OlapProcess>::Updated {
            before: Box::new(self_process.clone()),
            after: Box::new(target_process.clone()),
        }));
    }

    /// Compare Consumption API process changes between two infrastructure maps
    fn diff_consumption_api_processes(
        self_process: &ConsumptionApiWebServer,
        target_process: &ConsumptionApiWebServer,
        process_changes: &mut Vec<ProcessChange>,
    ) {
        log::info!("Analyzing changes in Analytics API processes...");

        // We are currently not tracking individual consumption endpoints, so we will just restart
        // the consumption web server when something changed
        log::debug!("Analytics API Web Server updated (assumed for now)");
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
        log::info!("Analyzing changes in Orchestration Workers...");
        let mut worker_updates = 0;
        let mut worker_removals = 0;
        let mut worker_additions = 0;

        for (id, worker) in self_workers {
            if let Some(target_worker) = target_workers.get(id) {
                // Always treat workers as updated to ensure redeployment
                log::debug!(
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
                log::debug!(
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
                log::debug!(
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

        log::info!(
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
    /// # Arguments
    /// * `self_sql_resources` - HashMap of source SQL resources to compare from
    /// * `target_sql_resources` - HashMap of target SQL resources to compare against
    /// * `target_tables` - Target tables for MV population analysis
    /// * `is_production` - Whether running in production environment
    /// * `olap_changes` - Mutable vector to collect the identified changes
    pub fn diff_sql_resources(
        self_sql_resources: &HashMap<String, SqlResource>,
        target_sql_resources: &HashMap<String, SqlResource>,
        target_tables: &HashMap<String, Table>,
        is_production: bool,
        olap_changes: &mut Vec<OlapChange>,
    ) {
        log::info!(
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
                    log::debug!("SQL resource '{}' has differences", id);
                    sql_resource_updates += 1;
                    olap_changes.push(OlapChange::SqlResource(Change::Updated {
                        before: Box::new(sql_resource.clone()),
                        after: Box::new(target_sql_resource.clone()),
                    }));

                    // Check if updated SQL resource is a materialized view that needs population
                    use crate::infrastructure::olap::clickhouse::diff_strategy::ClickHouseTableDiffStrategy;
                    ClickHouseTableDiffStrategy::check_materialized_view_population(
                        target_sql_resource,
                        target_tables,
                        true,
                        is_production,
                        olap_changes,
                    );
                }
            } else {
                log::debug!("SQL resource '{}' removed", id);
                sql_resource_removals += 1;
                olap_changes.push(OlapChange::SqlResource(Change::Removed(Box::new(
                    sql_resource.clone(),
                ))));
            }
        }

        for (id, sql_resource) in target_sql_resources {
            if !self_sql_resources.contains_key(id) {
                log::debug!("SQL resource '{}' added", id);
                sql_resource_additions += 1;
                olap_changes.push(OlapChange::SqlResource(Change::Added(Box::new(
                    sql_resource.clone(),
                ))));

                // Check if this is a materialized view that needs population (ClickHouse-specific)
                use crate::infrastructure::olap::clickhouse::diff_strategy::ClickHouseTableDiffStrategy;
                ClickHouseTableDiffStrategy::check_materialized_view_population(
                    sql_resource,
                    target_tables,
                    true,
                    is_production,
                    olap_changes,
                );
            }
        }

        log::info!(
            "SQL resource changes: {} added, {} removed, {} updated",
            sql_resource_additions,
            sql_resource_removals,
            sql_resource_updates
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
    /// * `strategy` - Strategy for handling database-specific table diffing logic
    /// * `default_database` - The configured default database name
    pub fn diff_tables_with_strategy(
        self_tables: &HashMap<String, Table>,
        target_tables: &HashMap<String, Table>,
        olap_changes: &mut Vec<OlapChange>,
        strategy: &dyn TableDiffStrategy,
        respect_life_cycle: bool,
        default_database: &str,
    ) {
        log::info!(
            "Analyzing table differences between {} source tables and {} target tables",
            self_tables.len(),
            target_tables.len()
        );

        let mut table_updates = 0;
        let mut table_removals = 0;
        let mut table_additions = 0;

        for table in self_tables.values() {
            // self_tables can be from remote where the keys are IDs with another database prefix
            // but they are then the default database,
            //   the `database` field is None and we build the ID ourselves
            if let Some(target_table) = target_tables.get(&table.id(default_database)) {
                if !tables_equal_ignore_metadata(table, target_table) {
                    // Respect lifecycle: ExternallyManaged tables are never modified
                    if target_table.life_cycle == LifeCycle::ExternallyManaged && respect_life_cycle
                    {
                        log::debug!(
                            "Table '{}' has changes but is externally managed - skipping update",
                            table.name
                        );
                    } else {
                        // Compute the basic diff components
                        let mut column_changes = compute_table_columns_diff(table, target_table);

                        // For DeletionProtected tables, filter out destructive column changes
                        if target_table.life_cycle == LifeCycle::DeletionProtected
                            && respect_life_cycle
                        {
                            let original_len = column_changes.len();
                            column_changes.retain(|change| match change {
                                ColumnChange::Removed(_) => {
                                    log::debug!(
                                        "Filtering out column removal for deletion-protected table '{}'",
                                        table.name
                                    );
                                    false // Remove destructive column removals
                                }
                                ColumnChange::Added { .. } => true, // Allow additive changes
                                ColumnChange::Updated { .. } => true, // Allow column updates
                            });

                            if original_len != column_changes.len() {
                                log::info!(
                                    "Filtered {} destructive column changes for deletion-protected table '{}'",
                                    original_len - column_changes.len(),
                                    table.name
                                );
                            }
                        }

                        // TODO: PARTITION BY is not checked!

                        // Compute ORDER BY changes
                        fn order_by_from_primary_key(target_table: &Table) -> Vec<String> {
                            target_table
                                .columns
                                .iter()
                                .filter_map(|c| {
                                    if c.primary_key {
                                        Some(c.name.clone())
                                    } else {
                                        None
                                    }
                                })
                                .collect()
                        }

                        let order_by_changed = table.order_by != target_table.order_by
                            // target may leave order_by unspecified,
                            // but the implicit order_by from primary keys can be the same
                            // ONLY for engines that support ORDER BY (MergeTree family and S3)
                            // Buffer, S3Queue, and Distributed don't support ORDER BY
                            // When engine is None, ClickHouse defaults to MergeTree
                            && !(target_table.order_by.is_empty()
                                && target_table.engine.as_ref().is_none_or(|e| e.supports_order_by())
                                && matches!(
                                    &table.order_by,
                                    OrderBy::Fields(v)
                                        if *v == order_by_from_primary_key(target_table)
                                ));

                        // Detect engine change (e.g., MergeTree -> ReplacingMergeTree)
                        let engine_changed = table.engine != target_table.engine;

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
                            &table.table_ttl_setting,
                            &target_table.table_ttl_setting,
                        ) {
                            log::debug!(
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

                        // Only process changes if there are actual differences to report
                        if !column_changes.is_empty()
                            || order_by_changed
                            || engine_changed
                            || indexes_changed
                        {
                            // Use the strategy to determine the appropriate changes
                            let strategy_changes = strategy.diff_table_update(
                                table,
                                target_table,
                                column_changes,
                                order_by_change,
                                default_database,
                            );

                            // Only count as a table update if the strategy returned actual operations
                            if !strategy_changes.is_empty() {
                                table_updates += 1;
                                olap_changes.extend(strategy_changes);
                            }
                        }
                    }
                }
            } else {
                // Respect lifecycle: DeletionProtected and ExternallyManaged tables are never removed
                match (table.life_cycle, respect_life_cycle) {
                    (LifeCycle::FullyManaged, _) | (_, false) => {
                        log::debug!("Table '{}' removed", table.name);
                        table_removals += 1;
                        olap_changes.push(OlapChange::Table(TableChange::Removed(table.clone())));
                    }
                    (LifeCycle::DeletionProtected, true) => {
                        log::debug!(
                            "Table '{}' marked for removal but is deletion-protected - skipping removal",
                            table.name
                        );
                    }
                    (LifeCycle::ExternallyManaged, true) => {
                        log::debug!(
                            "Table '{}' marked for removal but is externally managed - skipping removal",
                            table.name
                        );
                    }
                }
            }
        }

        for table in target_tables.values() {
            if find_table_from_infra_map(table, self_tables, default_database).is_none() {
                // Respect lifecycle: ExternallyManaged tables are never added automatically
                if table.life_cycle == LifeCycle::ExternallyManaged && respect_life_cycle {
                    log::debug!(
                        "Table '{}' marked for addition but is externally managed - skipping addition",
                        table.name
                    );
                } else {
                    log::debug!(
                        "Table '{}' added with {} columns",
                        table.name,
                        table.columns.len()
                    );
                    for col in &table.columns {
                        log::trace!("  - Column: {} ({})", col.name, col.data_type);
                    }
                    table_additions += 1;
                    olap_changes.push(OlapChange::Table(TableChange::Added(table.clone())));
                }
            }
        }

        log::info!(
            "Table changes: {} added, {} removed, {} updated",
            table_additions,
            table_removals,
            table_updates
        );
    }

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
        Self::diff_tables_with_strategy(
            self_tables,
            target_tables,
            olap_changes,
            &default_strategy,
            respect_life_cycle,
            default_database,
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

        let column_changes = compute_table_columns_diff(table, target_table);
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

        // Only return changes if there are actual differences to report
        // Detect index changes
        let indexes_changed = table.indexes != target_table.indexes;

        // Detect table-level TTL changes - use normalized comparison
        let ttl_changed = !ttl_expressions_are_equivalent(
            &table.table_ttl_setting,
            &target_table.table_ttl_setting,
        );

        if !column_changes.is_empty() || order_by_changed || indexes_changed || ttl_changed {
            Some(TableChange::Updated {
                name: table.name.clone(),
                column_changes,
                order_by_change,
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
    pub fn simple_table_diff_with_lifecycle(
        table: &Table,
        target_table: &Table,
    ) -> Option<TableChange> {
        if table == target_table {
            return None;
        }

        let mut column_changes = compute_table_columns_diff(table, target_table);

        // For DeletionProtected tables, filter out destructive column changes
        if target_table.life_cycle == LifeCycle::DeletionProtected {
            let original_len = column_changes.len();
            column_changes.retain(|change| match change {
                ColumnChange::Removed(_) => {
                    log::debug!(
                        "Filtering out column removal for deletion-protected table '{}'",
                        table.name
                    );
                    false // Remove destructive column removals
                }
                ColumnChange::Added { .. } => true, // Allow additive changes
                ColumnChange::Updated { .. } => true, // Allow column updates
            });

            if original_len != column_changes.len() {
                log::info!(
                    "Filtered {} destructive column changes for deletion-protected table '{}'",
                    original_len - column_changes.len(),
                    table.name
                );
            }
        }

        fn order_by_from_primary_key(target_table: &Table) -> Vec<String> {
            target_table
                .columns
                .iter()
                .filter_map(|c| {
                    if c.primary_key {
                        Some(c.name.clone())
                    } else {
                        None
                    }
                })
                .collect()
        }

        let order_by_changed = table.order_by != target_table.order_by
            // target may leave order_by unspecified,
            // but the implicit order_by from primary keys can be the same
            // ONLY for engines that support ORDER BY (MergeTree family and S3)
            // Buffer, S3Queue, and Distributed don't support ORDER BY
            // When engine is None, ClickHouse defaults to MergeTree
            && !(target_table.order_by.is_empty()
                && target_table.engine.as_ref().is_none_or(|e| e.supports_order_by())
                && matches!(
                    &table.order_by,
                    crate::framework::core::infrastructure::table::OrderBy::Fields(v)
                        if *v == order_by_from_primary_key(target_table)
                ));

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

        // Detect index changes
        let indexes_changed = table.indexes != target_table.indexes;

        // Detect table-level TTL changes - use normalized comparison
        let ttl_changed = !ttl_expressions_are_equivalent(
            &table.table_ttl_setting,
            &target_table.table_ttl_setting,
        );

        // Only return changes if there are actual differences to report
        if !column_changes.is_empty() || order_by_changed || indexes_changed || ttl_changed {
            Some(TableChange::Updated {
                name: table.name.clone(),
                column_changes,
                order_by_change,
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
    /// # Arguments
    /// * `path` - The path to the JSON file
    ///
    /// # Returns
    /// A Result containing either the loaded map or an IO error
    pub fn load_from_json(path: &Path) -> Result<Self, std::io::Error> {
        let json = fs::read_to_string(path)?;
        let infra_map = serde_json::from_str(&json)?;
        Ok(infra_map)
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
            let decoded = InfrastructureMap::from_proto(encoded).map_err(|e| {
                anyhow::anyhow!("Failed to decode InfrastructureMap from proto: {}", e)
            })?;
            Ok(Some(decoded))
        } else {
            Ok(None)
        }
    }

    /// Loads an infrastructure map using the last deployment's Redis key prefix.
    pub async fn load_from_last_redis_prefix(redis_client: &RedisClient) -> Result<Option<Self>> {
        let last_prefix = &redis_client.config.last_key_prefix;

        log::info!(
            "Loading InfrastructureMap from last Redis prefix: {}",
            last_prefix
        );

        let encoded = redis_client
            .get_with_explicit_prefix(last_prefix, "infrastructure_map")
            .await
            .context("Failed to get InfrastructureMap from Redis using LAST_KEY_PREFIX");

        if let Err(e) = encoded {
            log::error!("{}", e);
            return Ok(None);
        }

        if let Ok(Some(encoded)) = encoded {
            let decoded = InfrastructureMap::from_proto(encoded).map_err(|e| {
                anyhow::anyhow!("Failed to decode InfrastructureMap from proto: {}", e)
            })?;
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
            views: self
                .views
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

        Ok(InfrastructureMap {
            default_database: proto.default_database,
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
            views: proto
                .views
                .into_iter()
                .map(|(k, v)| (k, View::from_proto(v)))
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
            block_db_processes: OlapProcess {},
            sql_resources: proto
                .sql_resources
                .into_iter()
                .map(|(k, v)| (k, SqlResource::from_proto(v)))
                .collect(),
            // TODO: add proto
            workflows: HashMap::new(),
            web_apps: proto
                .web_apps
                .into_iter()
                .map(|(k, v)| (k, super::infrastructure::web_app::WebApp::from_proto(&v)))
                .collect(),
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
    ///
    /// # Returns
    /// A Result containing the infrastructure map or an error
    pub async fn load_from_user_code(project: &Project) -> anyhow::Result<Self> {
        let partial = if project.language == SupportedLanguages::Typescript {
            let process = crate::framework::typescript::export_collectors::collect_from_index(
                project,
                &project.project_location,
            )?;

            PartialInfrastructureMap::from_subprocess(process, "index.ts").await?
        } else {
            load_main_py(project, &project.project_location).await?
        };
        let infra_map = partial.into_infra_map(
            project.language,
            &project.main_file(),
            &project.clickhouse_config.db_name,
        )?;

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
            || !self.views.is_empty()
            || !self.topic_to_table_sync_processes.is_empty()
            || !self.sql_resources.is_empty()
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
fn columns_are_equivalent(before: &Column, after: &Column) -> bool {
    // Check all non-data_type and non-ttl fields first
    if before.name != after.name
        || before.required != after.required
        || before.unique != after.unique
        // primary_key change is handled at the table level
        || before.default != after.default
        || before.annotations != after.annotations
        || before.comment != after.comment
    {
        return false;
    }

    // Special handling for TTL comparison: normalize both expressions before comparing
    if !ttl_expressions_are_equivalent(&before.ttl, &after.ttl) {
        return false;
    }

    // Special handling for enum types
    use crate::framework::core::infrastructure::table::ColumnType;
    match (&before.data_type, &after.data_type) {
        (ColumnType::Enum(before_enum), ColumnType::Enum(after_enum)) => {
            // Try to use ClickHouse-specific enum comparison for string enums
            use crate::infrastructure::olap::clickhouse::diff_strategy::enums_are_equivalent;
            enums_are_equivalent(before_enum, after_enum)
        }
        // For all other types, use standard equality
        _ => before.data_type == after.data_type,
    }
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
pub fn compute_table_columns_diff(before: &Table, after: &Table) -> Vec<ColumnChange> {
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
            if !columns_are_equivalent(before_col, after_col) {
                log::debug!(
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
                log::debug!("Column '{}' unchanged", after_col.name);
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
            log::debug!("Column '{}' has been removed", before_col.name);
            diff.push(ColumnChange::Removed(before_col.clone()));
        }
    }

    diff
}

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
            views: HashMap::new(),
            topic_to_table_sync_processes: HashMap::new(),
            topic_to_topic_sync_processes: HashMap::new(),
            function_processes: HashMap::new(),
            block_db_processes: OlapProcess {},
            consumption_api_web_server: ConsumptionApiWebServer {},
            orchestration_workers: HashMap::new(),
            sql_resources: HashMap::new(),
            workflows: HashMap::new(),
            web_apps: HashMap::new(),
        }
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

    #[test]
    fn test_compute_table_diff() {
        let before = Table {
            name: "test_table".to_string(),
            engine: None,
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
            table_settings: None,
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
        };

        let after = Table {
            name: "test_table".to_string(),
            engine: None,
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
            table_settings: None,
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
        };

        let diff = compute_table_columns_diff(&before, &after);

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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);

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
            engine: None,
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
            table_settings: None,
            indexes: vec![],
            database: None,
            table_ttl_setting: None,
        }
    }

    #[test]
    fn test_empty_tables_no_changes() {
        let table1 = create_test_table("test", "1.0");
        let table2 = create_test_table("test", "1.0");

        let diff = compute_table_columns_diff(&table1, &table2);
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
        });

        let diff = compute_table_columns_diff(&before, &after);
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
        });

        let diff = compute_table_columns_diff(&before, &after);
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
        });

        let diff = compute_table_columns_diff(&before, &after);
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
            },
        ]);

        let diff = compute_table_columns_diff(&before, &after);
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

        before.engine = Some(ClickhouseEngine::MergeTree);
        after.engine = Some(ClickhouseEngine::ReplacingMergeTree {
            ver: None,
            is_deleted: None,
        });

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
                assert_eq!(b.engine.as_ref(), Some(&ClickhouseEngine::MergeTree));
                assert!(matches!(
                    a.engine.as_ref(),
                    Some(ClickhouseEngine::ReplacingMergeTree { .. })
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
        });

        let diff = compute_table_columns_diff(&before, &after);
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
            },
        ]);

        let diff = compute_table_columns_diff(&before, &after);
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
            };
            before.columns.push(col.clone());
            after.columns.push(col);
        }

        // Add one change in the middle
        if let Some(col) = after.columns.get_mut(500) {
            col.data_type = ColumnType::BigInt;
        }

        let diff = compute_table_columns_diff(&before, &after);
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
            });
        }

        let diff = compute_table_columns_diff(&before, &after);

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
        });

        let diff = compute_table_columns_diff(&before, &after);
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
        });

        let diff = compute_table_columns_diff(&before, &after);
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
        };
        let col2 = col1.clone();
        assert!(columns_are_equivalent(&col1, &col2));

        // Test 2: Different names should not be equivalent
        let mut col3 = col1.clone();
        col3.name = "different".to_string();
        assert!(!columns_are_equivalent(&col1, &col3));

        // Test 2b: Different comments should not be equivalent
        let mut col_with_comment = col1.clone();
        col_with_comment.comment = Some("User documentation".to_string());
        assert!(!columns_are_equivalent(&col1, &col_with_comment));

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
        };

        // These should be equivalent due to the enum semantic comparison
        assert!(columns_are_equivalent(
            &clickhouse_enum_col,
            &typescript_enum_col
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
        };

        assert!(!columns_are_equivalent(
            &typescript_enum_col,
            &different_enum_col
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
        };

        assert!(!columns_are_equivalent(&int_col1, &int_col2));
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

        let tables = HashMap::new(); // Empty tables for tests
        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &tables,
            false,
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
        let tables = HashMap::new(); // Empty tables for tests
        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &tables,
            false,
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
        let tables = HashMap::new(); // Empty tables for tests
        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &tables,
            false,
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
        let tables = HashMap::new(); // Empty tables for tests
        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &tables,
            false,
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
        let tables = HashMap::new(); // Empty tables for tests
        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &tables,
            false,
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
        let tables = HashMap::new(); // Empty tables for tests
        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &tables,
            false,
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
        let tables = HashMap::new(); // Empty tables for tests
        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &tables,
            false,
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
    fn test_update_materialized_view_select_statement_should_trigger_backfill() {
        use crate::framework::core::infrastructure::InfrastructureSignature;

        let mv_before = SqlResource {
            name: "events_summary_mv".to_string(),
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
        let tables = HashMap::new();

        InfrastructureMap::diff_sql_resources(
            &self_resources,
            &target_resources,
            &tables,
            false,
            &mut olap_changes,
        );

        assert_eq!(olap_changes.len(), 2);

        let mut has_updated = false;
        let mut has_populate = false;

        for change in &olap_changes {
            match change {
                OlapChange::SqlResource(Change::Updated { before, after }) => {
                    assert_eq!(before.name, "events_summary_mv");
                    assert_eq!(after.name, "events_summary_mv");
                    assert!(before.setup[0].contains("SELECT id, name FROM"));
                    assert!(after.setup[0].contains("SELECT id, name, timestamp FROM"));
                    has_updated = true;
                }
                OlapChange::PopulateMaterializedView {
                    view_name,
                    target_table,
                    select_statement,
                    ..
                } => {
                    assert_eq!(view_name, "events_summary_mv");
                    assert_eq!(target_table, "events_summary_table");
                    assert!(select_statement.contains("SELECT id, name, timestamp FROM events"));
                    has_populate = true;
                }
                _ => panic!("Unexpected change type: {:?}", change),
            }
        }

        assert!(has_updated);
        assert!(has_populate);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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
    use crate::framework::core::infrastructure::view::{View, ViewType};
    use crate::framework::versions::Version;

    // Helper function to create a test view
    fn create_test_view(name: &str, version_str: &str, source_table: &str) -> View {
        let version = Version::from_string(version_str.to_string());
        View {
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
        map1.views.insert(view.id(), view.clone());
        map2.views.insert(view.id(), view);

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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
        map2.views.insert(view.id(), view.clone());

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
        assert_eq!(changes.olap_changes.len(), 1, "Expected one OLAP change");
        match &changes.olap_changes[0] {
            OlapChange::View(Change::Added(v)) => {
                assert_eq!(**v, view, "Added view does not match")
            }
            _ => panic!("Expected View Added change"),
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
        map1.views.insert(view.id(), view.clone());

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
        assert_eq!(changes.olap_changes.len(), 1, "Expected one OLAP change");
        match &changes.olap_changes[0] {
            OlapChange::View(Change::Removed(v)) => {
                assert_eq!(**v, view, "Removed view does not match")
            }
            _ => panic!("Expected View Removed change"),
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

        map1.views.insert(view_before.id(), view_before.clone());
        map2.views.insert(view_after.id(), view_after.clone());

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
        assert_eq!(changes.olap_changes.len(), 1, "Expected one OLAP change");
        match &changes.olap_changes[0] {
            OlapChange::View(Change::Updated { before, after }) => {
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
            _ => panic!("Expected View Updated change"),
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);
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

        let changes = map1.diff_with_table_strategy(&map2, &DefaultTableDiffStrategy, true, false);

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
}
