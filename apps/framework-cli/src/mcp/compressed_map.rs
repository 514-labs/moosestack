//! Compressed infrastructure map structures for efficient MCP transmission
//!
//! This module defines lightweight data structures for representing the infrastructure
//! map with focus on lineage and connectivity rather than detailed schemas.
//! Components reference MCP resources for detailed information.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::framework::core::infrastructure::table::Metadata;
use crate::framework::core::infrastructure_map::InfrastructureMap;

/// Path prefix for workflow source files
const WORKFLOW_SOURCE_PATH_PREFIX: &str = "app/workflows/";

/// Compressed infrastructure map showing component relationships
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressedInfraMap {
    /// All components in the infrastructure
    pub components: Vec<ComponentNode>,
    /// Connections between components showing data flow
    pub connections: Vec<Connection>,
    /// Summary statistics about the infrastructure
    pub stats: MapStats,
}

/// Lightweight component node with resource reference
/// Note: MCP resource URI can be reconstructed as: moose://infra/{type}s/{id}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ComponentNode {
    /// Unique identifier for the component
    pub id: String,
    /// Type of component
    #[serde(rename = "type")]
    pub component_type: ComponentType,
    /// Display name
    pub name: String,
    /// Source file path where the component is declared (empty string if not tracked)
    pub source_file: String,
}

/// Connection between two components showing data flow
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Connection {
    /// Source component ID
    pub from: String,
    /// Target component ID
    pub to: String,
    /// Type of connection/relationship
    #[serde(rename = "type")]
    pub connection_type: ConnectionType,
}

/// Type of infrastructure component
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ComponentType {
    /// Redpanda/Kafka topic for streaming data
    Topic,
    /// ClickHouse table for OLAP storage
    Table,
    /// ClickHouse view (table alias)
    View,
    /// API endpoint (ingress or egress)
    ApiEndpoint,
    /// Data transformation function
    Function,
    /// Custom SQL resource
    SqlResource,
    /// Temporal workflow
    Workflow,
    /// Web application
    WebApp,
    /// Topic-to-table synchronization process
    TopicTableSync,
    /// Topic-to-topic transformation process
    TopicTopicSync,
}

impl ComponentType {
    /// Get the URI path segment for this component type
    pub fn uri_segment(&self) -> &'static str {
        match self {
            Self::Topic => "topics",
            Self::Table => "tables",
            Self::View => "views",
            Self::ApiEndpoint => "apis",
            Self::Function => "functions",
            Self::SqlResource => "sql_resources",
            Self::Workflow => "workflows",
            Self::WebApp => "web_apps",
            Self::TopicTableSync => "topic_table_syncs",
            Self::TopicTopicSync => "topic_topic_syncs",
        }
    }
}

/// Type of connection between components
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionType {
    /// Topic data is ingested into a table
    Ingests,
    /// API or process produces data to a topic
    Produces,
    /// API or process queries data from a table
    Queries,
    /// Function transforms data between topics
    Transforms,
    /// View references a table
    References,
    /// SQL resource pulls data from component
    PullsFrom,
    /// SQL resource pushes data to component
    PushesTo,
}

/// Statistics about the infrastructure map
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapStats {
    /// Total number of components
    pub total_components: u32,
    /// Breakdown by component type
    pub by_type: HashMap<ComponentType, u32>,
    /// Total number of connections
    pub total_connections: u32,
}

impl CompressedInfraMap {
    /// Create a new empty compressed infrastructure map
    pub fn new() -> Self {
        Self {
            components: Vec::new(),
            connections: Vec::new(),
            stats: MapStats {
                total_components: 0,
                by_type: HashMap::new(),
                total_connections: 0,
            },
        }
    }

    /// Add a component to the map
    pub fn add_component(&mut self, component: ComponentNode) {
        *self
            .stats
            .by_type
            .entry(component.component_type)
            .or_insert(0) += 1;
        self.stats.total_components += 1;
        self.components.push(component);
    }

    /// Add a connection to the map
    pub fn add_connection(&mut self, connection: Connection) {
        self.stats.total_connections += 1;
        self.connections.push(connection);
    }

    /// Get component by ID
    pub fn get_component(&self, id: &str) -> Option<&ComponentNode> {
        self.components.iter().find(|c| c.id == id)
    }

    /// Get all connections from a specific component
    pub fn get_outgoing_connections(&self, component_id: &str) -> Vec<&Connection> {
        self.connections
            .iter()
            .filter(|c| c.from == component_id)
            .collect()
    }

    /// Get all connections to a specific component
    pub fn get_incoming_connections(&self, component_id: &str) -> Vec<&Connection> {
        self.connections
            .iter()
            .filter(|c| c.to == component_id)
            .collect()
    }
}

impl Default for CompressedInfraMap {
    fn default() -> Self {
        Self::new()
    }
}

/// Convert an absolute file path to a relative path from the project root
/// Strips the project directory prefix to get a path like "app/datamodels/User.ts"
fn make_relative_path(absolute_path: &str) -> String {
    // Find the last occurrence of "/app/" or "\app\" and take everything from "app/" onwards
    // This works for paths like "/Users/name/project/app/datamodels/User.ts" -> "app/datamodels/User.ts"
    if let Some(pos) = absolute_path.rfind("/app/") {
        return absolute_path[pos + 1..].to_string();
    }
    if let Some(pos) = absolute_path.rfind("\\app\\") {
        return absolute_path[pos + 1..].replace('\\', "/");
    }

    // If path already starts with "app/", return as-is
    if absolute_path.starts_with("app/") || absolute_path.starts_with("app\\") {
        return absolute_path.replace('\\', "/");
    }

    // Fallback: return the original path if we can't find "app/"
    absolute_path.to_string()
}

/// Extract source file path from component metadata
fn extract_source_file(metadata: Option<&Metadata>) -> String {
    metadata
        .and_then(|m| m.source.as_ref())
        .map(|s| make_relative_path(&s.file))
        .unwrap_or_default()
}

/// Add all topics to the compressed map
fn add_topics(compressed: &mut CompressedInfraMap, infra_map: &InfrastructureMap) {
    for (key, topic) in &infra_map.topics {
        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::Topic,
            name: topic.name.clone(),
            source_file: extract_source_file(topic.metadata.as_ref()),
        });
    }
}

/// Add all tables to the compressed map
fn add_tables(compressed: &mut CompressedInfraMap, infra_map: &InfrastructureMap) {
    for (key, table) in &infra_map.tables {
        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::Table,
            name: table.name.clone(),
            source_file: extract_source_file(table.metadata.as_ref()),
        });
    }
}

/// Add all views to the compressed map
fn add_views(compressed: &mut CompressedInfraMap, infra_map: &InfrastructureMap) {
    use crate::framework::core::infrastructure::view::ViewType;

    for (key, view) in &infra_map.views {
        // Views are aliases to tables, so try to use the source table's file
        let source_file = match &view.view_type {
            ViewType::TableAlias { source_table_name } => infra_map
                .tables
                .get(source_table_name)
                .and_then(|t| t.metadata.as_ref())
                .map(|m| extract_source_file(Some(m)))
                .unwrap_or_default(),
        };

        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::View,
            name: view.name.clone(),
            source_file,
        });

        // Add connection from view to its target table
        let ViewType::TableAlias { source_table_name } = &view.view_type;
        compressed.add_connection(Connection {
            from: key.clone(),
            to: source_table_name.clone(),
            connection_type: ConnectionType::References,
        });
    }
}

/// Add all API endpoints to the compressed map
fn add_api_endpoints(compressed: &mut CompressedInfraMap, infra_map: &InfrastructureMap) {
    use crate::framework::core::infrastructure::api_endpoint::APIType;

    for (key, api) in &infra_map.api_endpoints {
        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::ApiEndpoint,
            name: format!("{:?} {}", api.method, api.path.display()),
            source_file: extract_source_file(api.metadata.as_ref()),
        });

        // Add connections based on API type
        match &api.api_type {
            APIType::INGRESS {
                target_topic_id, ..
            } => {
                compressed.add_connection(Connection {
                    from: key.clone(),
                    to: target_topic_id.clone(),
                    connection_type: ConnectionType::Produces,
                });
            }
            APIType::EGRESS { .. } => {
                // EGRESS APIs query from tables/views, but the connection would require
                // analyzing the SQL query to determine which tables are accessed
                // Skip for now as this requires query parsing
            }
        }
    }
}

/// Add all functions to the compressed map
fn add_functions(compressed: &mut CompressedInfraMap, infra_map: &InfrastructureMap) {
    for (key, func) in &infra_map.function_processes {
        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::Function,
            name: func.name.clone(),
            source_file: extract_source_file(func.metadata.as_ref()),
        });

        // Add connections: source topic -> function -> target topic
        compressed.add_connection(Connection {
            from: func.source_topic_id.clone(),
            to: key.clone(),
            connection_type: ConnectionType::Transforms,
        });
        if let Some(target_topic_id) = &func.target_topic_id {
            compressed.add_connection(Connection {
                from: key.clone(),
                to: target_topic_id.clone(),
                connection_type: ConnectionType::Produces,
            });
        }
    }
}

/// Add all SQL resources to the compressed map
fn add_sql_resources(compressed: &mut CompressedInfraMap, infra_map: &InfrastructureMap) {
    for (key, sql) in &infra_map.sql_resources {
        let source_file = sql
            .source_file
            .as_ref()
            .map(|s| make_relative_path(s))
            .unwrap_or_default();

        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::SqlResource,
            name: sql.name.clone(),
            source_file,
        });

        // Add connections based on lineage using the id() method
        for source in &sql.pulls_data_from {
            compressed.add_connection(Connection {
                from: source.id().to_string(),
                to: key.clone(),
                connection_type: ConnectionType::PullsFrom,
            });
        }
        for target in &sql.pushes_data_to {
            compressed.add_connection(Connection {
                from: key.clone(),
                to: target.id().to_string(),
                connection_type: ConnectionType::PushesTo,
            });
        }
    }
}

/// Add all workflows to the compressed map
fn add_workflows(compressed: &mut CompressedInfraMap, infra_map: &InfrastructureMap) {
    for (key, workflow) in &infra_map.workflows {
        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::Workflow,
            name: workflow.name().to_string(),
            source_file: format!("{}{}", WORKFLOW_SOURCE_PATH_PREFIX, workflow.name()),
        });
    }
}

/// Add all web apps to the compressed map
fn add_web_apps(compressed: &mut CompressedInfraMap, infra_map: &InfrastructureMap) {
    for (key, web_app) in &infra_map.web_apps {
        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::WebApp,
            name: web_app.name.clone(),
            source_file: String::new(), // Web apps don't have source file tracking
        });
    }
}

/// Add topic-to-table sync processes to the compressed map
fn add_topic_table_syncs(compressed: &mut CompressedInfraMap, infra_map: &InfrastructureMap) {
    for (key, sync) in &infra_map.topic_to_table_sync_processes {
        // Sync processes are derived from the source topic, use its source file
        let source_file = infra_map
            .topics
            .get(&sync.source_topic_id)
            .and_then(|t| t.metadata.as_ref())
            .map(|m| extract_source_file(Some(m)))
            .unwrap_or_default();

        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::TopicTableSync,
            name: format!("{} -> {}", sync.source_topic_id, sync.target_table_id),
            source_file,
        });

        // Add connections: topic -> sync -> table
        compressed.add_connection(Connection {
            from: sync.source_topic_id.clone(),
            to: key.clone(),
            connection_type: ConnectionType::Ingests,
        });
        compressed.add_connection(Connection {
            from: key.clone(),
            to: sync.target_table_id.clone(),
            connection_type: ConnectionType::Ingests,
        });
    }
}

/// Add topic-to-topic sync processes to the compressed map
fn add_topic_topic_syncs(compressed: &mut CompressedInfraMap, infra_map: &InfrastructureMap) {
    for (key, sync) in &infra_map.topic_to_topic_sync_processes {
        // Sync processes are derived from the source topic, use its source file
        let source_file = infra_map
            .topics
            .get(&sync.source_topic_id)
            .and_then(|t| t.metadata.as_ref())
            .map(|m| extract_source_file(Some(m)))
            .unwrap_or_default();

        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::TopicTopicSync,
            name: format!("{} -> {}", sync.source_topic_id, sync.target_topic_id),
            source_file,
        });

        // Add connections: source topic -> sync -> target topic
        compressed.add_connection(Connection {
            from: sync.source_topic_id.clone(),
            to: key.clone(),
            connection_type: ConnectionType::Transforms,
        });
        compressed.add_connection(Connection {
            from: key.clone(),
            to: sync.target_topic_id.clone(),
            connection_type: ConnectionType::Produces,
        });
    }
}

/// Build a compressed infrastructure map from the full InfrastructureMap
pub fn build_compressed_map(infra_map: &InfrastructureMap) -> CompressedInfraMap {
    let mut compressed = CompressedInfraMap::new();

    add_topics(&mut compressed, infra_map);
    add_tables(&mut compressed, infra_map);
    add_views(&mut compressed, infra_map);
    add_api_endpoints(&mut compressed, infra_map);
    add_functions(&mut compressed, infra_map);
    add_sql_resources(&mut compressed, infra_map);
    add_workflows(&mut compressed, infra_map);
    add_web_apps(&mut compressed, infra_map);
    add_topic_table_syncs(&mut compressed, infra_map);
    add_topic_topic_syncs(&mut compressed, infra_map);

    compressed
}

/// Build a resource URI for a component
pub fn build_resource_uri(component_type: ComponentType, component_id: &str) -> String {
    format!(
        "moose://infra/{}/{}",
        component_type.uri_segment(),
        component_id
    )
}

/// Parse a resource URI to extract component type and ID
pub fn parse_resource_uri(uri: &str) -> Option<(ComponentType, String)> {
    let prefix = "moose://infra/";
    if !uri.starts_with(prefix) {
        return None;
    }

    let path = &uri[prefix.len()..];
    let parts: Vec<&str> = path.splitn(2, '/').collect();
    if parts.len() != 2 {
        return None;
    }

    let component_type = match parts[0] {
        "topics" => ComponentType::Topic,
        "tables" => ComponentType::Table,
        "views" => ComponentType::View,
        "apis" => ComponentType::ApiEndpoint,
        "functions" => ComponentType::Function,
        "sql_resources" => ComponentType::SqlResource,
        "workflows" => ComponentType::Workflow,
        "web_apps" => ComponentType::WebApp,
        "topic_table_syncs" => ComponentType::TopicTableSync,
        "topic_topic_syncs" => ComponentType::TopicTopicSync,
        _ => return None,
    };

    Some((component_type, parts[1].to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_resource_uri() {
        assert_eq!(
            build_resource_uri(ComponentType::Topic, "user_events_v1"),
            "moose://infra/topics/user_events_v1"
        );
        assert_eq!(
            build_resource_uri(ComponentType::Table, "analytics__users"),
            "moose://infra/tables/analytics__users"
        );
    }

    #[test]
    fn test_parse_resource_uri() {
        let (comp_type, id) = parse_resource_uri("moose://infra/topics/user_events").unwrap();
        assert_eq!(comp_type, ComponentType::Topic);
        assert_eq!(id, "user_events");

        assert!(parse_resource_uri("invalid://uri").is_none());
        assert!(parse_resource_uri("moose://infra/invalid/id").is_none());
    }

    #[test]
    fn test_compressed_map_add_component() {
        let mut map = CompressedInfraMap::new();

        map.add_component(ComponentNode {
            id: "topic1".to_string(),
            component_type: ComponentType::Topic,
            name: "Events".to_string(),
            source_file: "app/datamodels/Events.ts".to_string(),
        });

        assert_eq!(map.stats.total_components, 1);
        assert_eq!(*map.stats.by_type.get(&ComponentType::Topic).unwrap(), 1);
        assert!(map.get_component("topic1").is_some());
    }

    #[test]
    fn test_compressed_map_connections() {
        let mut map = CompressedInfraMap::new();

        map.add_connection(Connection {
            from: "api1".to_string(),
            to: "topic1".to_string(),
            connection_type: ConnectionType::Produces,
        });

        assert_eq!(map.stats.total_connections, 1);
        assert_eq!(map.get_outgoing_connections("api1").len(), 1);
        assert_eq!(map.get_incoming_connections("topic1").len(), 1);
    }

    #[test]
    fn test_component_type_uri_segments() {
        assert_eq!(ComponentType::Topic.uri_segment(), "topics");
        assert_eq!(ComponentType::ApiEndpoint.uri_segment(), "apis");
        assert_eq!(ComponentType::Function.uri_segment(), "functions");
    }

    #[test]
    fn test_component_node_with_source_file() {
        let component = ComponentNode {
            id: "test_topic".to_string(),
            component_type: ComponentType::Topic,
            name: "TestTopic".to_string(),
            source_file: "app/datamodels/TestTopic.ts".to_string(),
        };

        // Verify source_file is set
        assert_eq!(
            component.source_file,
            "app/datamodels/TestTopic.ts".to_string()
        );

        // Test serialization/deserialization
        let json = serde_json::to_string(&component).unwrap();
        let deserialized: ComponentNode = serde_json::from_str(&json).unwrap();
        assert_eq!(component, deserialized);
    }

    #[test]
    fn test_component_node_without_source_file() {
        let component = ComponentNode {
            id: "test_view".to_string(),
            component_type: ComponentType::View,
            name: "TestView".to_string(),
            source_file: String::new(),
        };

        // Verify source_file is empty string
        assert_eq!(component.source_file, "");

        // Test serialization - field should always be present now
        let json = serde_json::to_string(&component).unwrap();
        assert!(json.contains("source_file"));

        // Test deserialization
        let deserialized: ComponentNode = serde_json::from_str(&json).unwrap();
        assert_eq!(component, deserialized);
    }

    #[test]
    fn test_make_relative_path_with_absolute_unix() {
        let absolute = "/Users/nicolas/code/514/test-projects/ts-test-tests/app/ingest/models.ts";
        let relative = make_relative_path(absolute);
        assert_eq!(relative, "app/ingest/models.ts");
    }

    #[test]
    fn test_make_relative_path_with_absolute_windows() {
        let absolute = "C:\\Users\\nicolas\\code\\project\\app\\datamodels\\User.ts";
        let relative = make_relative_path(absolute);
        assert_eq!(relative, "app/datamodels/User.ts");
    }

    #[test]
    fn test_make_relative_path_already_relative() {
        let already_relative = "app/ingest/models.ts";
        let result = make_relative_path(already_relative);
        assert_eq!(result, "app/ingest/models.ts");
    }

    #[test]
    fn test_make_relative_path_with_backslashes() {
        let windows_relative = "app\\ingest\\models.ts";
        let result = make_relative_path(windows_relative);
        assert_eq!(result, "app/ingest/models.ts");
    }

    #[test]
    fn test_make_relative_path_no_app_directory() {
        // Fallback case where path doesn't contain "app/"
        let path = "/some/other/path/file.ts";
        let result = make_relative_path(path);
        assert_eq!(result, "/some/other/path/file.ts");
    }

    #[test]
    fn test_make_relative_path_nested_app_directories() {
        // Should use the last occurrence of "/app/"
        let path = "/Users/app/project/app/datamodels/User.ts";
        let result = make_relative_path(path);
        assert_eq!(result, "app/datamodels/User.ts");
    }
}
