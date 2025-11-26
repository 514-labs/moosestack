//! # Infrastructure Map Tool
//!
//! This module implements the MCP tool for accessing the Moose infrastructure map.

use rmcp::model::{CallToolResult, Tool};
use serde_json::{json, Map, Value};
use std::sync::Arc;

use super::toon_serializer::serialize_to_toon_compressed;
use super::{create_error_result, create_success_result};
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::redis::redis_client::RedisClient;
use crate::mcp::build_compressed_map;

/// Error types for infrastructure map retrieval operations
#[derive(Debug, thiserror::Error)]
pub enum InfraMapError {
    #[error("Failed to load infrastructure map from Redis: {0}")]
    RedisLoad(#[from] anyhow::Error),

    #[error("Failed to serialize infrastructure map: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Failed to serialize to TOON format: {0}")]
    ToonSerialization(#[from] super::toon_serializer::ToonSerializationError),
}

/// Returns the tool definition for the MCP server
pub fn tool_definition() -> Tool {
    let schema = json!({
        "type": "object",
        "properties": {}
    });

    Tool {
        name: "get_infra_map".into(),
        description: Some(
            "Retrieve the complete Moose infrastructure map showing all components and their connections. Returns tables, topics, API endpoints, sync processes, functions, SQL resources, workflows, and their relationships in a compact TOON table format.".into()
        ),
        input_schema: Arc::new(schema.as_object().unwrap().clone()),
        annotations: None,
        icons: None,
        output_schema: None,
        title: Some("Get Moose Infrastructure Map".into()),
    }
}

/// Handle the tool call with the given arguments
pub async fn handle_call(
    _arguments: Option<&Map<String, Value>>,
    redis_client: Arc<RedisClient>,
) -> CallToolResult {
    match execute_get_infra_map(redis_client).await {
        Ok(content) => create_success_result(content),
        Err(e) => create_error_result(format!("Error retrieving infrastructure map: {}", e)),
    }
}

/// Main function to retrieve infrastructure map
async fn execute_get_infra_map(redis_client: Arc<RedisClient>) -> Result<String, InfraMapError> {
    // Load infrastructure map from Redis
    let infra_map_opt = InfrastructureMap::load_from_redis(&redis_client).await?;

    let infra_map = match infra_map_opt {
        Some(map) => map,
        None => {
            return Ok(
                "No infrastructure map found. The dev server may not be running or no infrastructure has been deployed yet."
                    .to_string(),
            );
        }
    };

    // Format and return the infrastructure map
    format_infrastructure_map(&infra_map)
}

/// Format infrastructure map with component lineage information
fn format_infrastructure_map(infra_map: &InfrastructureMap) -> Result<String, InfraMapError> {
    let mut output = String::from("# Moose Infrastructure Map\n\n");
    output.push_str("This view shows infrastructure components and their connections.\n");
    output.push_str(
        "For detailed component information, access the resource URIs via MCP resources.\n\n",
    );

    // Build compressed map
    let compressed_map = build_compressed_map(infra_map);

    // Serialize to TOON
    let compressed_json = serde_json::to_value(&compressed_map)?;
    output.push_str("```toon\n");
    output.push_str(&serialize_to_toon_compressed(&compressed_json)?);
    output.push_str("\n```\n");

    Ok(output)
}
