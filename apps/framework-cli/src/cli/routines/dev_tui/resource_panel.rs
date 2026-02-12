//! Resource panel types for Dev TUI
//!
//! This module provides types for displaying and filtering infrastructure resources
//! in the Dev TUI.

use crate::framework::core::infrastructure::api_endpoint::APIType;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use std::collections::HashSet;
use tokio::sync::mpsc;

/// Type of infrastructure resource
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ResourceType {
    Table,
    Stream,
    IngestionApi,
    ConsumptionApi,
    Function,
    Workflow,
    WebApp,
}

impl ResourceType {
    /// Returns a display name for the resource type (used in panel headers)
    pub fn display_name(&self) -> &'static str {
        match self {
            ResourceType::Table => "TABLES",
            ResourceType::Stream => "STREAMS",
            ResourceType::IngestionApi => "INGESTION APIS",
            ResourceType::ConsumptionApi => "CONSUMPTION APIS",
            ResourceType::Function => "FUNCTIONS",
            ResourceType::Workflow => "WORKFLOWS",
            ResourceType::WebApp => "WEB APPS",
        }
    }

    /// Returns all resource types in display order
    pub fn all() -> &'static [ResourceType] {
        &[
            ResourceType::Table,
            ResourceType::Stream,
            ResourceType::IngestionApi,
            ResourceType::ConsumptionApi,
            ResourceType::Function,
            ResourceType::Workflow,
            ResourceType::WebApp,
        ]
    }
}

/// A selected resource for filtering logs
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectedResource {
    pub resource_type: ResourceType,
    pub name: String,
}

/// List of all resources extracted from InfrastructureMap
#[derive(Debug, Clone, Default)]
pub struct ResourceList {
    pub tables: Vec<String>,
    pub streams: Vec<String>,
    pub ingestion_apis: Vec<String>,
    pub consumption_apis: Vec<String>,
    pub functions: Vec<String>,
    pub workflows: Vec<String>,
    pub web_apps: Vec<String>,
}

impl ResourceList {
    /// Create a new empty ResourceList
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a ResourceList from an InfrastructureMap
    pub fn from_infrastructure_map(map: &InfrastructureMap) -> Self {
        let mut tables: Vec<String> = map.tables.keys().cloned().collect();
        tables.sort();

        let mut streams: Vec<String> = map.topics.keys().cloned().collect();
        streams.sort();

        let mut ingestion_apis: Vec<String> = Vec::new();
        let mut consumption_apis: Vec<String> = Vec::new();

        for (name, endpoint) in &map.api_endpoints {
            match &endpoint.api_type {
                APIType::INGRESS { .. } => ingestion_apis.push(name.clone()),
                APIType::EGRESS { .. } => consumption_apis.push(name.clone()),
            }
        }
        ingestion_apis.sort();
        consumption_apis.sort();

        let mut functions: Vec<String> = map.function_processes.keys().cloned().collect();
        functions.sort();

        let mut workflows: Vec<String> = map.workflows.keys().cloned().collect();
        workflows.sort();

        let mut web_apps: Vec<String> = map.web_apps.keys().cloned().collect();
        web_apps.sort();

        Self {
            tables,
            streams,
            ingestion_apis,
            consumption_apis,
            functions,
            workflows,
            web_apps,
        }
    }

    /// Get the total count of all resources
    pub fn total_count(&self) -> usize {
        self.tables.len()
            + self.streams.len()
            + self.ingestion_apis.len()
            + self.consumption_apis.len()
            + self.functions.len()
            + self.workflows.len()
            + self.web_apps.len()
    }

    /// Check if the resource list is empty
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.total_count() == 0
    }

    /// Get the resources for a specific type
    pub fn get_by_type(&self, resource_type: ResourceType) -> &[String] {
        match resource_type {
            ResourceType::Table => &self.tables,
            ResourceType::Stream => &self.streams,
            ResourceType::IngestionApi => &self.ingestion_apis,
            ResourceType::ConsumptionApi => &self.consumption_apis,
            ResourceType::Function => &self.functions,
            ResourceType::Workflow => &self.workflows,
            ResourceType::WebApp => &self.web_apps,
        }
    }

    /// Get count for a specific resource type
    #[allow(dead_code)]
    pub fn count_by_type(&self, resource_type: ResourceType) -> usize {
        self.get_by_type(resource_type).len()
    }

    /// Convert to a flat list of ResourceItems for rendering
    pub fn to_items(&self, expanded: &HashSet<ResourceType>) -> Vec<ResourceItem> {
        let mut items = Vec::new();

        for resource_type in ResourceType::all() {
            let resources = self.get_by_type(*resource_type);
            let count = resources.len();

            // Skip empty groups
            if count == 0 {
                continue;
            }

            let is_expanded = expanded.contains(resource_type);
            items.push(ResourceItem::GroupHeader {
                resource_type: *resource_type,
                count,
                expanded: is_expanded,
            });

            if is_expanded {
                for name in resources {
                    items.push(ResourceItem::Resource {
                        resource_type: *resource_type,
                        name: name.clone(),
                    });
                }
            }
        }

        items
    }
}

/// Item in the flattened resource list (for rendering/navigation)
#[derive(Debug, Clone)]
pub enum ResourceItem {
    /// A group header (e.g., "TABLES (5)")
    GroupHeader {
        resource_type: ResourceType,
        count: usize,
        expanded: bool,
    },
    /// A resource within a group
    Resource {
        resource_type: ResourceType,
        name: String,
    },
}

impl ResourceItem {
    /// Check if this is a group header
    #[allow(dead_code)]
    pub fn is_header(&self) -> bool {
        matches!(self, ResourceItem::GroupHeader { .. })
    }

    /// Get the resource type
    #[allow(dead_code)]
    pub fn resource_type(&self) -> ResourceType {
        match self {
            ResourceItem::GroupHeader { resource_type, .. } => *resource_type,
            ResourceItem::Resource { resource_type, .. } => *resource_type,
        }
    }
}

/// Check if a log message mentions a resource
///
/// Uses case-insensitive substring matching since Moose logs consistently
/// include resource names in messages.
pub fn matches_resource(message: &str, resource_name: &str) -> bool {
    message
        .to_lowercase()
        .contains(&resource_name.to_lowercase())
}

// ============================================================================
// RESOURCE UPDATE CHANNEL (for dynamic updates from file watcher)
// ============================================================================

/// Updates sent from the file watcher to the TUI when infrastructure changes
#[derive(Debug, Clone)]
pub enum ResourceUpdate {
    /// Changes are being loaded/applied (show loading indicator)
    ApplyingChanges,
    /// Infrastructure map was updated with new resources and a summary of changes
    ChangesApplied {
        resource_list: ResourceList,
        changes: Vec<ChangeEntry>,
    },
    /// Change application failed
    ChangeFailed(String),
}

/// A single change entry for display in the TUI
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ChangeEntry {
    pub change_type: ChangeType,
    pub resource_type: ResourceType,
    pub name: String,
    pub details: Option<String>,
}

/// Type of change that occurred
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ChangeType {
    /// Resource was added (green +)
    Added,
    /// Resource was removed (red -)
    Removed,
    /// Resource was updated (yellow ~)
    Updated,
}

impl ChangeType {
    /// Get the prefix character for this change type
    #[allow(dead_code)]
    pub fn prefix(&self) -> char {
        match self {
            ChangeType::Added => '+',
            ChangeType::Removed => '-',
            ChangeType::Updated => '~',
        }
    }
}

/// Sender for resource updates
pub type ResourceUpdateSender = mpsc::UnboundedSender<ResourceUpdate>;
/// Receiver for resource updates
#[allow(dead_code)] // TODO(PR5): Remove once entry point uses this
pub type ResourceUpdateReceiver = mpsc::UnboundedReceiver<ResourceUpdate>;

/// Create a new resource update channel
#[allow(dead_code)] // TODO(PR5): Remove once entry point uses this
pub fn resource_update_channel() -> (ResourceUpdateSender, ResourceUpdateReceiver) {
    mpsc::unbounded_channel()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_type_display_name_returns_correct_values() {
        assert_eq!(ResourceType::Table.display_name(), "TABLES");
        assert_eq!(ResourceType::Stream.display_name(), "STREAMS");
        assert_eq!(ResourceType::IngestionApi.display_name(), "INGESTION APIS");
        assert_eq!(
            ResourceType::ConsumptionApi.display_name(),
            "CONSUMPTION APIS"
        );
        assert_eq!(ResourceType::Function.display_name(), "FUNCTIONS");
        assert_eq!(ResourceType::Workflow.display_name(), "WORKFLOWS");
        assert_eq!(ResourceType::WebApp.display_name(), "WEB APPS");
    }

    #[test]
    fn resource_list_new_is_empty() {
        let list = ResourceList::new();
        assert!(list.is_empty());
        assert_eq!(list.total_count(), 0);
    }

    #[test]
    fn resource_list_total_count_sums_all() {
        let list = ResourceList {
            tables: vec!["Users".into(), "Orders".into()],
            streams: vec!["events".into()],
            ingestion_apis: vec![],
            consumption_apis: vec!["analytics".into()],
            functions: vec![],
            workflows: vec![],
            web_apps: vec![],
        };
        assert_eq!(list.total_count(), 4);
        assert!(!list.is_empty());
    }

    #[test]
    fn resource_list_get_by_type_returns_correct_slice() {
        let list = ResourceList {
            tables: vec!["Users".into()],
            streams: vec!["events".into()],
            ..Default::default()
        };
        assert_eq!(list.get_by_type(ResourceType::Table), &["Users"]);
        assert_eq!(list.get_by_type(ResourceType::Stream), &["events"]);
        assert!(list.get_by_type(ResourceType::Function).is_empty());
    }

    #[test]
    fn resource_list_to_items_collapsed() {
        let list = ResourceList {
            tables: vec!["Users".into(), "Orders".into()],
            streams: vec!["events".into()],
            ..Default::default()
        };
        let expanded = HashSet::new(); // Nothing expanded
        let items = list.to_items(&expanded);

        // Should have 2 headers (Tables and Streams)
        assert_eq!(items.len(), 2);
        assert!(matches!(
            &items[0],
            ResourceItem::GroupHeader {
                resource_type: ResourceType::Table,
                count: 2,
                expanded: false
            }
        ));
        assert!(matches!(
            &items[1],
            ResourceItem::GroupHeader {
                resource_type: ResourceType::Stream,
                count: 1,
                expanded: false
            }
        ));
    }

    #[test]
    fn resource_list_to_items_expanded() {
        let list = ResourceList {
            tables: vec!["Users".into(), "Orders".into()],
            ..Default::default()
        };
        let mut expanded = HashSet::new();
        expanded.insert(ResourceType::Table);
        let items = list.to_items(&expanded);

        // Should have 1 header + 2 resources
        assert_eq!(items.len(), 3);
        assert!(matches!(
            &items[0],
            ResourceItem::GroupHeader {
                resource_type: ResourceType::Table,
                expanded: true,
                ..
            }
        ));
        assert!(matches!(
            &items[1],
            ResourceItem::Resource {
                resource_type: ResourceType::Table,
                name,
            } if name == "Users"
        ));
        assert!(matches!(
            &items[2],
            ResourceItem::Resource {
                resource_type: ResourceType::Table,
                name,
            } if name == "Orders"
        ));
    }

    #[test]
    fn resource_list_to_items_skips_empty_groups() {
        let list = ResourceList {
            tables: vec!["Users".into()],
            streams: vec![], // Empty
            functions: vec!["transform".into()],
            ..Default::default()
        };
        let expanded = HashSet::new();
        let items = list.to_items(&expanded);

        // Should only have headers for non-empty groups
        assert_eq!(items.len(), 2);
        assert!(items
            .iter()
            .all(|item| item.resource_type() != ResourceType::Stream));
    }

    #[test]
    fn matches_resource_case_insensitive() {
        assert!(matches_resource("Creating table UserEvents", "userevents"));
        assert!(matches_resource("Creating table UserEvents", "USEREVENTS"));
        assert!(matches_resource("Creating table UserEvents", "UserEvents"));
    }

    #[test]
    fn matches_resource_returns_false_for_no_match() {
        assert!(!matches_resource("Creating table UserEvents", "Orders"));
    }

    #[test]
    fn matches_resource_partial_match() {
        assert!(matches_resource(
            "Route registered POST /ingest/User",
            "User"
        ));
    }

    #[test]
    fn change_type_prefix() {
        assert_eq!(ChangeType::Added.prefix(), '+');
        assert_eq!(ChangeType::Removed.prefix(), '-');
        assert_eq!(ChangeType::Updated.prefix(), '~');
    }

    #[test]
    fn resource_item_is_header() {
        let header = ResourceItem::GroupHeader {
            resource_type: ResourceType::Table,
            count: 5,
            expanded: false,
        };
        let resource = ResourceItem::Resource {
            resource_type: ResourceType::Table,
            name: "Users".into(),
        };
        assert!(header.is_header());
        assert!(!resource.is_header());
    }

    #[test]
    fn resource_item_resource_type() {
        let header = ResourceItem::GroupHeader {
            resource_type: ResourceType::Stream,
            count: 3,
            expanded: true,
        };
        let resource = ResourceItem::Resource {
            resource_type: ResourceType::Function,
            name: "transform".into(),
        };
        assert_eq!(header.resource_type(), ResourceType::Stream);
        assert_eq!(resource.resource_type(), ResourceType::Function);
    }

    #[test]
    fn resource_update_channel_works() {
        let (tx, mut rx) = resource_update_channel();
        tx.send(ResourceUpdate::ApplyingChanges).unwrap();
        let received = rx.try_recv().unwrap();
        assert!(matches!(received, ResourceUpdate::ApplyingChanges));
    }
}
