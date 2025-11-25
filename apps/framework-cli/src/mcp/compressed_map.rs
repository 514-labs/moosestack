//! Compressed infrastructure map structures for efficient MCP transmission
//!
//! This module defines lightweight data structures for representing the infrastructure
//! map with focus on lineage and connectivity rather than detailed schemas.
//! Components reference MCP resources for detailed information.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ComponentNode {
    /// Unique identifier for the component
    pub id: String,
    /// Type of component
    #[serde(rename = "type")]
    pub component_type: ComponentType,
    /// Display name
    pub name: String,
    /// MCP resource URI for detailed information
    pub resource_uri: String,
    /// Current operational status
    pub status: ComponentStatus,
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
    /// Optional description of the relationship
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
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

/// Operational status of a component
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ComponentStatus {
    /// Component is operational
    Active,
    /// Component exists but is not currently active
    Inactive,
    /// Component has errors or issues
    Error,
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

/// Build a compressed infrastructure map from the full InfrastructureMap
pub fn build_compressed_map(
    infra_map: &crate::framework::core::infrastructure_map::InfrastructureMap,
) -> CompressedInfraMap {
    let mut compressed = CompressedInfraMap::new();

    // Add all topics
    for (key, topic) in &infra_map.topics {
        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::Topic,
            name: topic.name.clone(),
            resource_uri: build_resource_uri(ComponentType::Topic, key),
            status: ComponentStatus::Active,
        });
    }

    // Add all tables
    for (key, table) in &infra_map.tables {
        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::Table,
            name: table.name.clone(),
            resource_uri: build_resource_uri(ComponentType::Table, key),
            status: ComponentStatus::Active,
        });
    }

    // Add all views
    for (key, view) in &infra_map.views {
        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::View,
            name: view.name.clone(),
            resource_uri: build_resource_uri(ComponentType::View, key),
            status: ComponentStatus::Active,
        });

        // Add connection from view to its target table
        use crate::framework::core::infrastructure::view::ViewType;
        let ViewType::TableAlias { source_table_name } = &view.view_type;
        compressed.add_connection(Connection {
            from: key.clone(),
            to: source_table_name.clone(),
            connection_type: ConnectionType::References,
            description: Some("View references table".to_string()),
        });
    }

    // Add all API endpoints
    for (key, api) in &infra_map.api_endpoints {
        use crate::framework::core::infrastructure::api_endpoint::APIType;

        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::ApiEndpoint,
            name: format!("{:?} {}", api.method, api.path.display()),
            resource_uri: build_resource_uri(ComponentType::ApiEndpoint, key),
            status: ComponentStatus::Active,
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
                    description: Some("API produces to topic".to_string()),
                });
            }
            APIType::EGRESS { .. } => {
                // EGRESS APIs query from tables/views, but the connection would require
                // analyzing the SQL query to determine which tables are accessed
                // Skip for now as this requires query parsing
            }
        }
    }

    // Add all functions
    for (key, func) in &infra_map.function_processes {
        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::Function,
            name: func.name.clone(),
            resource_uri: build_resource_uri(ComponentType::Function, key),
            status: ComponentStatus::Active,
        });

        // Add connections: source topic -> function -> target topic
        compressed.add_connection(Connection {
            from: func.source_topic_id.clone(),
            to: key.clone(),
            connection_type: ConnectionType::Transforms,
            description: Some("Function consumes from topic".to_string()),
        });
        if let Some(target_topic_id) = &func.target_topic_id {
            compressed.add_connection(Connection {
                from: key.clone(),
                to: target_topic_id.clone(),
                connection_type: ConnectionType::Produces,
                description: Some("Function produces to topic".to_string()),
            });
        }
    }

    // Add all SQL resources
    for (key, sql) in &infra_map.sql_resources {
        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::SqlResource,
            name: sql.name.clone(),
            resource_uri: build_resource_uri(ComponentType::SqlResource, key),
            status: ComponentStatus::Active,
        });

        // Add connections based on lineage
        for source in &sql.pulls_data_from {
            compressed.add_connection(Connection {
                from: format!("{:?}", source), // Convert signature to string
                to: key.clone(),
                connection_type: ConnectionType::PullsFrom,
                description: Some("SQL resource pulls data".to_string()),
            });
        }
        for target in &sql.pushes_data_to {
            compressed.add_connection(Connection {
                from: key.clone(),
                to: format!("{:?}", target), // Convert signature to string
                connection_type: ConnectionType::PushesTo,
                description: Some("SQL resource pushes data".to_string()),
            });
        }
    }

    // Add all workflows
    for (key, workflow) in &infra_map.workflows {
        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::Workflow,
            name: workflow.name().to_string(),
            resource_uri: build_resource_uri(ComponentType::Workflow, key),
            status: ComponentStatus::Active,
        });
    }

    // Add topic-to-table sync processes
    for (key, sync) in &infra_map.topic_to_table_sync_processes {
        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::TopicTableSync,
            name: format!("{} -> {}", sync.source_topic_id, sync.target_table_id),
            resource_uri: build_resource_uri(ComponentType::TopicTableSync, key),
            status: ComponentStatus::Active,
        });

        // Add connections: topic -> sync -> table
        compressed.add_connection(Connection {
            from: sync.source_topic_id.clone(),
            to: key.clone(),
            connection_type: ConnectionType::Ingests,
            description: Some("Sync reads from topic".to_string()),
        });
        compressed.add_connection(Connection {
            from: key.clone(),
            to: sync.target_table_id.clone(),
            connection_type: ConnectionType::Ingests,
            description: Some("Sync writes to table".to_string()),
        });
    }

    // Add topic-to-topic sync processes
    for (key, sync) in &infra_map.topic_to_topic_sync_processes {
        compressed.add_component(ComponentNode {
            id: key.clone(),
            component_type: ComponentType::TopicTopicSync,
            name: format!("{} -> {}", sync.source_topic_id, sync.target_topic_id),
            resource_uri: build_resource_uri(ComponentType::TopicTopicSync, key),
            status: ComponentStatus::Active,
        });

        // Add connections: source topic -> sync -> target topic
        compressed.add_connection(Connection {
            from: sync.source_topic_id.clone(),
            to: key.clone(),
            connection_type: ConnectionType::Transforms,
            description: Some("Sync reads from topic".to_string()),
        });
        compressed.add_connection(Connection {
            from: key.clone(),
            to: sync.target_topic_id.clone(),
            connection_type: ConnectionType::Produces,
            description: Some("Sync writes to topic".to_string()),
        });
    }

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
            resource_uri: build_resource_uri(ComponentType::Topic, "topic1"),
            status: ComponentStatus::Active,
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
            description: None,
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
}
