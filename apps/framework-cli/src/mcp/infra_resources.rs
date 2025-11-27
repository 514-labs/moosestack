//! Infrastructure component resources for MCP
//!
//! This module provides MCP resources for accessing detailed information about
//! infrastructure components (topics, tables, APIs, etc.) referenced from the
//! compressed infrastructure map.

use rmcp::model::{
    Annotated, ListResourcesResult, RawResource, ReadResourceResult, ResourceContents,
};
use serde_json::{json, Value};
use std::sync::Arc;

use super::compressed_map::{build_resource_uri, parse_resource_uri, ComponentType};
use super::tools::toon_serializer::serialize_to_toon_compressed;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::redis::redis_client::RedisClient;

/// List all available infrastructure resources
pub async fn list_infra_resources(redis_client: Arc<RedisClient>) -> ListResourcesResult {
    let infra_map = match InfrastructureMap::load_from_redis(&redis_client).await {
        Ok(Some(map)) => map,
        _ => {
            return ListResourcesResult {
                resources: Vec::new(),
                next_cursor: None,
            }
        }
    };

    let mut resources = Vec::new();

    // Add topic resources
    for (key, topic) in &infra_map.topics {
        resources.push(Annotated {
            raw: RawResource {
                uri: build_resource_uri(ComponentType::Topic, key),
                name: topic.name.clone(),
                title: Some(format!("Topic: {}", topic.name)),
                description: topic.metadata.as_ref().and_then(|m| m.description.clone()),
                mime_type: Some("application/x-toon".to_string()),
                size: None,
                icons: None,
            },
            annotations: None,
        });
    }

    // Add table resources
    for (key, table) in &infra_map.tables {
        resources.push(Annotated {
            raw: RawResource {
                uri: build_resource_uri(ComponentType::Table, key),
                name: table.name.clone(),
                title: Some(format!("Table: {}", table.name)),
                description: table.metadata.as_ref().and_then(|m| m.description.clone()),
                mime_type: Some("application/x-toon".to_string()),
                size: None,
                icons: None,
            },
            annotations: None,
        });
    }

    // Add view resources
    for (key, view) in &infra_map.views {
        resources.push(Annotated {
            raw: RawResource {
                uri: build_resource_uri(ComponentType::View, key),
                name: view.name.clone(),
                title: Some(format!("View: {}", view.name)),
                description: None, // Views don't have metadata
                mime_type: Some("application/x-toon".to_string()),
                size: None,
                icons: None,
            },
            annotations: None,
        });
    }

    // Add API endpoint resources
    for (key, api) in &infra_map.api_endpoints {
        use crate::framework::core::infrastructure::api_endpoint::APIType;

        let api_type = match &api.api_type {
            APIType::INGRESS { .. } => "Ingress",
            APIType::EGRESS { .. } => "Egress",
        };
        resources.push(Annotated {
            raw: RawResource {
                uri: build_resource_uri(ComponentType::ApiEndpoint, key),
                name: format!("{:?} {}", api.method, api.path.display()),
                title: Some(format!(
                    "{} API: {:?} {}",
                    api_type,
                    api.method,
                    api.path.display()
                )),
                description: api.metadata.as_ref().and_then(|m| m.description.clone()),
                mime_type: Some("application/x-toon".to_string()),
                size: None,
                icons: None,
            },
            annotations: None,
        });
    }

    // Add function resources
    for (key, func) in &infra_map.function_processes {
        resources.push(Annotated {
            raw: RawResource {
                uri: build_resource_uri(ComponentType::Function, key),
                name: func.name.clone(),
                title: Some(format!("Function: {}", func.name)),
                description: func.metadata.as_ref().and_then(|m| m.description.clone()),
                mime_type: Some("application/x-toon".to_string()),
                size: None,
                icons: None,
            },
            annotations: None,
        });
    }

    // Add SQL resource resources
    for (key, sql) in &infra_map.sql_resources {
        resources.push(Annotated {
            raw: RawResource {
                uri: build_resource_uri(ComponentType::SqlResource, key),
                name: sql.name.clone(),
                title: Some(format!("SQL Resource: {}", sql.name)),
                description: None, // SQL resources don't have metadata field
                mime_type: Some("application/x-toon".to_string()),
                size: None,
                icons: None,
            },
            annotations: None,
        });
    }

    // Add workflow resources
    for (key, workflow) in &infra_map.workflows {
        resources.push(Annotated {
            raw: RawResource {
                uri: build_resource_uri(ComponentType::Workflow, key),
                name: workflow.name().to_string(),
                title: Some(format!("Workflow: {}", workflow.name())),
                description: None, // Workflows don't have metadata field
                mime_type: Some("application/x-toon".to_string()),
                size: None,
                icons: None,
            },
            annotations: None,
        });
    }

    // Add web app resources
    for (key, web_app) in &infra_map.web_apps {
        resources.push(Annotated {
            raw: RawResource {
                uri: build_resource_uri(ComponentType::WebApp, key),
                name: web_app.name.clone(),
                title: Some(format!("Web App: {}", web_app.name)),
                description: web_app
                    .metadata
                    .as_ref()
                    .and_then(|m| m.description.clone()),
                mime_type: Some("application/x-toon".to_string()),
                size: None,
                icons: None,
            },
            annotations: None,
        });
    }

    // Add topic-to-table sync process resources
    for (key, sync) in &infra_map.topic_to_table_sync_processes {
        resources.push(Annotated {
            raw: RawResource {
                uri: build_resource_uri(ComponentType::TopicTableSync, key),
                name: format!("{} -> {}", sync.source_topic_id, sync.target_table_id),
                title: Some(format!(
                    "Topic-to-Table Sync: {} -> {}",
                    sync.source_topic_id, sync.target_table_id
                )),
                description: None, // Sync processes don't have metadata field
                mime_type: Some("application/x-toon".to_string()),
                size: None,
                icons: None,
            },
            annotations: None,
        });
    }

    // Add topic-to-topic sync process resources
    for (key, sync) in &infra_map.topic_to_topic_sync_processes {
        resources.push(Annotated {
            raw: RawResource {
                uri: build_resource_uri(ComponentType::TopicTopicSync, key),
                name: format!("{} -> {}", sync.source_topic_id, sync.target_topic_id),
                title: Some(format!(
                    "Topic-to-Topic Sync: {} -> {}",
                    sync.source_topic_id, sync.target_topic_id
                )),
                description: None, // Sync processes don't have metadata field
                mime_type: Some("application/x-toon".to_string()),
                size: None,
                icons: None,
            },
            annotations: None,
        });
    }

    ListResourcesResult {
        resources,
        next_cursor: None,
    }
}

/// Read a specific infrastructure resource by URI
pub async fn read_infra_resource(
    uri: &str,
    redis_client: Arc<RedisClient>,
) -> Option<ReadResourceResult> {
    let (component_type, component_id) = parse_resource_uri(uri)?;

    let infra_map = InfrastructureMap::load_from_redis(&redis_client)
        .await
        .ok()??;

    let json_value = match component_type {
        ComponentType::Topic => {
            let topic = infra_map.topics.get(&component_id)?;
            serialize_topic_to_json(topic, &component_id)
        }
        ComponentType::Table => {
            let table = infra_map.tables.get(&component_id)?;
            serialize_table_to_json(table, &component_id)
        }
        ComponentType::View => {
            let view = infra_map.views.get(&component_id)?;
            serialize_view_to_json(view, &component_id)
        }
        ComponentType::ApiEndpoint => {
            let api = infra_map.api_endpoints.get(&component_id)?;
            serialize_api_to_json(api, &component_id)
        }
        ComponentType::Function => {
            let func = infra_map.function_processes.get(&component_id)?;
            serialize_function_to_json(func, &component_id)
        }
        ComponentType::SqlResource => {
            let sql = infra_map.sql_resources.get(&component_id)?;
            serialize_sql_resource_to_json(sql, &component_id)
        }
        ComponentType::Workflow => {
            let workflow = infra_map.workflows.get(&component_id)?;
            serialize_workflow_to_json(workflow, &component_id)
        }
        ComponentType::WebApp => {
            let web_app = infra_map.web_apps.get(&component_id)?;
            serialize_web_app_to_json(web_app, &component_id)
        }
        ComponentType::TopicTableSync => {
            let sync = infra_map.topic_to_table_sync_processes.get(&component_id)?;
            serialize_topic_table_sync_to_json(sync, &component_id, &infra_map)
        }
        ComponentType::TopicTopicSync => {
            let sync = infra_map.topic_to_topic_sync_processes.get(&component_id)?;
            serialize_topic_topic_sync_to_json(sync, &component_id, &infra_map)
        }
    };

    // Serialize to TOON format
    let toon_text = serialize_to_toon_compressed(&json_value).ok()?;

    Some(ReadResourceResult {
        contents: vec![ResourceContents::TextResourceContents {
            uri: uri.to_string(),
            mime_type: Some("application/x-toon".to_string()),
            text: toon_text,
            meta: None,
        }],
    })
}

/// Serialize a topic to JSON value
fn serialize_topic_to_json(
    topic: &crate::framework::core::infrastructure::topic::Topic,
    id: &str,
) -> Value {
    json!({
        "id": id,
        "name": topic.name,
        "type": "topic",
        "metadata": {
            "description": topic.metadata.as_ref().and_then(|m| m.description.as_ref()),
            "source_file": topic.metadata.as_ref().and_then(|m| m.source.as_ref()).map(|s| &s.file),
            "version": topic.version,
            "lifecycle": format!("{:?}", topic.life_cycle),
        },
        "configuration": {
            "partition_count": topic.partition_count,
            "retention_ms": topic.retention_period.as_millis(),
            "max_message_bytes": topic.max_message_bytes,
        },
        "schema": {
            "columns": topic.columns.iter().map(|col| json!({
                "name": col.name,
                "data_type": format!("{:?}", col.data_type),
                "required": col.required,
                "primary_key": col.primary_key,
                "unique": col.unique,
            })).collect::<Vec<_>>(),
            "schema_config": topic.schema_config.as_ref().map(|sc| json!({
                "type": format!("{:?}", sc),
            })),
        },
    })
}

/// Serialize a table to JSON value
fn serialize_table_to_json(
    table: &crate::framework::core::infrastructure::table::Table,
    id: &str,
) -> Value {
    json!({
        "id": id,
        "name": table.name,
        "type": "table",
        "database": table.database,
        "metadata": {
            "description": table.metadata.as_ref().and_then(|m| m.description.as_ref()),
            "source_file": table.metadata.as_ref().and_then(|m| m.source.as_ref()).map(|s| &s.file),
            "version": table.version,
            "lifecycle": format!("{:?}", table.life_cycle),
        },
        "configuration": {
            "engine": format!("{:?}", table.engine),
            "order_by": format!("{:?}", table.order_by),
        },
        "schema": {
            "columns": table.columns.iter().map(|col| json!({
                "name": col.name,
                "data_type": format!("{:?}", col.data_type),
                "required": col.required,
                "primary_key": col.primary_key,
                "unique": col.unique,
            })).collect::<Vec<_>>(),
        },
    })
}

/// Serialize a view to JSON value
fn serialize_view_to_json(
    view: &crate::framework::core::infrastructure::view::View,
    id: &str,
) -> Value {
    use crate::framework::core::infrastructure::view::ViewType;

    let target_table = match &view.view_type {
        ViewType::TableAlias { source_table_name } => source_table_name.clone(),
    };

    json!({
        "id": id,
        "name": view.name,
        "type": "view",
        "version": format!("{:?}", view.version),
        "target_table": target_table,
    })
}

/// Serialize an API endpoint to JSON value
fn serialize_api_to_json(
    api: &crate::framework::core::infrastructure::api_endpoint::ApiEndpoint,
    id: &str,
) -> Value {
    use crate::framework::core::infrastructure::api_endpoint::APIType;

    let api_details = match &api.api_type {
        APIType::INGRESS {
            target_topic_id,
            data_model,
            dead_letter_queue,
            schema,
        } => json!({
            "api_type": "ingress",
            "target_topic": target_topic_id,
            "has_data_model": data_model.is_some(),
            "dead_letter_queue": dead_letter_queue,
            "schema_fields": schema.keys().collect::<Vec<_>>(),
        }),
        APIType::EGRESS {
            query_params,
            output_schema,
        } => json!({
            "api_type": "egress",
            "query_params": query_params.iter().map(|qp| &qp.name).collect::<Vec<_>>(),
            "output_schema": output_schema,
        }),
    };

    json!({
        "id": id,
        "name": format!("{:?} {}", api.method, api.path.display()),
        "type": "api_endpoint",
        "metadata": {
            "description": api.metadata.as_ref().and_then(|m| m.description.as_ref()),
            "source_file": api.metadata.as_ref().and_then(|m| m.source.as_ref()).map(|s| &s.file),
            "version": api.version,
        },
        "configuration": {
            "method": format!("{:?}", api.method),
            "path": api.path.display().to_string(),
        },
        "details": api_details,
    })
}

/// Serialize a function to JSON value
fn serialize_function_to_json(
    func: &crate::framework::core::infrastructure::function_process::FunctionProcess,
    id: &str,
) -> Value {
    json!({
        "id": id,
        "name": func.name,
        "type": "function",
        "metadata": {
            "description": func.metadata.as_ref().and_then(|m| m.description.as_ref()),
            "source_file": func.metadata.as_ref().and_then(|m| m.source.as_ref()).map(|s| &s.file),
            "version": func.version,
        },
        "configuration": {
            "source_topic": func.source_topic_id,
            "target_topic": func.target_topic_id,
            "language": format!("{:?}", func.language),
            "parallel_process_count": func.parallel_process_count,
        },
    })
}

/// Serialize a SQL resource to JSON value
fn serialize_sql_resource_to_json(
    sql: &crate::framework::core::infrastructure::sql_resource::SqlResource,
    id: &str,
) -> Value {
    json!({
        "id": id,
        "name": sql.name,
        "type": "sql_resource",
        "configuration": {
            "setup": sql.setup,
            "teardown": sql.teardown,
        },
        "lineage": {
            "pulls_from": sql.pulls_data_from.iter().map(|sig| format!("{:?}", sig)).collect::<Vec<_>>(),
            "pushes_to": sql.pushes_data_to.iter().map(|sig| format!("{:?}", sig)).collect::<Vec<_>>(),
        },
    })
}

/// Serialize a workflow to JSON value
fn serialize_workflow_to_json(workflow: &crate::framework::scripts::Workflow, id: &str) -> Value {
    json!({
        "id": id,
        "name": workflow.name(),
        "type": "workflow",
        "configuration": {
            "workflow_name": workflow.name(),
            "schedule": workflow.config().schedule,
            "retries": workflow.config().retries,
        },
    })
}

/// Serialize a topic-to-table sync process to JSON value
fn serialize_topic_table_sync_to_json(
    sync: &crate::framework::core::infrastructure::topic_sync_process::TopicToTableSyncProcess,
    id: &str,
    infra_map: &crate::framework::core::infrastructure_map::InfrastructureMap,
) -> Value {
    // Get source file from the source topic's metadata
    let source_file = infra_map
        .topics
        .get(&sync.source_topic_id)
        .and_then(|t| t.metadata.as_ref())
        .and_then(|m| m.source.as_ref())
        .map(|s| s.file.clone());

    json!({
        "id": id,
        "name": format!("{} -> {}", sync.source_topic_id, sync.target_table_id),
        "type": "topic_table_sync",
        "configuration": {
            "source_topic_id": sync.source_topic_id,
            "target_table_id": sync.target_table_id,
            "version": sync.version.as_ref().map(|v| v.to_string()),
        },
        "metadata": {
            "source_file": source_file,
            "source_primitive": {
                "name": sync.source_primitive.name,
                "primitive_type": format!("{:?}", sync.source_primitive.primitive_type),
            },
        },
        "schema": {
            "columns": sync.columns.iter().map(|col| json!({
                "name": col.name,
                "data_type": format!("{:?}", col.data_type),
                "required": col.required,
                "primary_key": col.primary_key,
                "unique": col.unique,
            })).collect::<Vec<_>>(),
        },
    })
}

/// Serialize a topic-to-topic sync process to JSON value
fn serialize_topic_topic_sync_to_json(
    sync: &crate::framework::core::infrastructure::topic_sync_process::TopicToTopicSyncProcess,
    id: &str,
    infra_map: &crate::framework::core::infrastructure_map::InfrastructureMap,
) -> Value {
    // Get source file from the source topic's metadata
    let source_file = infra_map
        .topics
        .get(&sync.source_topic_id)
        .and_then(|t| t.metadata.as_ref())
        .and_then(|m| m.source.as_ref())
        .map(|s| s.file.clone());

    json!({
        "id": id,
        "name": format!("{} -> {}", sync.source_topic_id, sync.target_topic_id),
        "type": "topic_topic_sync",
        "configuration": {
            "source_topic_id": sync.source_topic_id,
            "target_topic_id": sync.target_topic_id,
        },
        "metadata": {
            "source_file": source_file,
            "source_primitive": {
                "name": sync.source_primitive.name,
                "primitive_type": format!("{:?}", sync.source_primitive.primitive_type),
            },
        },
    })
}

/// Serialize a web app to JSON value
fn serialize_web_app_to_json(
    web_app: &crate::framework::core::infrastructure::web_app::WebApp,
    id: &str,
) -> Value {
    json!({
        "id": id,
        "name": web_app.name,
        "type": "web_app",
        "configuration": {
            "mount_path": web_app.mount_path,
        },
        "metadata": {
            "description": web_app.metadata.as_ref().and_then(|m| m.description.as_ref()),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_topic_basic() {
        use crate::framework::core::infrastructure::table::Metadata;
        use crate::framework::core::infrastructure::topic::Topic;
        use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
        use crate::framework::core::partial_infrastructure_map::LifeCycle;
        use std::time::Duration;

        let topic = Topic {
            name: "test_topic".to_string(),
            columns: Vec::new(),
            partition_count: 3,
            retention_period: Duration::from_secs(86400),
            metadata: Some(Metadata {
                description: Some("Test description".to_string()),
                source: None,
            }),
            version: None,
            life_cycle: LifeCycle::FullyManaged,
            max_message_bytes: 1024000,
            schema_config: None,
            source_primitive: PrimitiveSignature {
                name: "test_topic".to_string(),
                primitive_type: PrimitiveTypes::DataModel,
            },
        };

        let json_val = serialize_topic_to_json(&topic, "test_id");
        assert_eq!(json_val["name"], "test_topic");
        assert_eq!(json_val["type"], "topic");
        assert_eq!(json_val["configuration"]["partition_count"], 3);
    }
}
