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

/// Fuzzy match using case-insensitive substring matching
fn fuzzy_match(query: &str, text: &str) -> bool {
    let query_lower = query.to_lowercase();
    let text_lower = text.to_lowercase();
    text_lower.contains(&query_lower)
}

/// Returns the tool definition for the MCP server
pub fn tool_definition() -> Tool {
    let schema = json!({
        "type": "object",
        "properties": {
            "search": {
                "type": "string",
                "description": "Focus on specific components (fuzzy, case-insensitive). Examples: 'user' → UserEvents, user_table, INGRESS_User; 'bar' → Bar topic, BarAggregated table. Omit for complete map."
            }
        }
    });

    Tool {
        name: "get_infra_map".into(),
        description: Some(
            "🔍 START HERE: Get complete project topology showing all components (tables, topics, APIs, functions, workflows) with source file locations and data flow connections. Essential first step to understand project structure, locate files, and verify code changes are reflected. Use 'search' to focus on specific components (e.g., search='User' shows UserEvents topic, user tables, and all related connections).".into()
        ),
        input_schema: Arc::new(schema.as_object().unwrap().clone()),
        annotations: None,
        icons: None,
        output_schema: None,
        title: Some("Get Infrastructure Map".into()),
    }
}

/// Handle the tool call with the given arguments
pub async fn handle_call(
    arguments: Option<&Map<String, Value>>,
    redis_client: Arc<RedisClient>,
) -> CallToolResult {
    // Parse optional search parameter
    let search = arguments
        .and_then(|args| args.get("search"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    match execute_get_infra_map(redis_client, search).await {
        Ok(content) => create_success_result(content),
        Err(e) => create_error_result(format!("Error retrieving infrastructure map: {}", e)),
    }
}

/// Main function to retrieve infrastructure map
async fn execute_get_infra_map(
    redis_client: Arc<RedisClient>,
    search: Option<String>,
) -> Result<String, InfraMapError> {
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
    format_infrastructure_map(&infra_map, &search)
}

/// Format infrastructure map with component lineage information
fn format_infrastructure_map(
    infra_map: &InfrastructureMap,
    search: &Option<String>,
) -> Result<String, InfraMapError> {
    let mut output = String::from("# Moose Infrastructure Map\n\n");
    output.push_str("This view shows infrastructure components and their connections.\n");
    output.push_str(
        "For detailed component information, access the resource URIs via MCP resources.\n\n",
    );

    // Build compressed map
    let compressed_map = build_compressed_map(infra_map);

    // Apply search filter if provided
    let filtered_map = if let Some(query) = search {
        let mut filtered = compressed_map.clone();

        // Filter components: keep if query matches id OR name
        filtered.components.retain(|component| {
            fuzzy_match(query, &component.id) || fuzzy_match(query, &component.name)
        });

        // Build set of matching component IDs for connection filtering
        let component_ids: std::collections::HashSet<_> =
            filtered.components.iter().map(|c| c.id.as_str()).collect();

        // Filter connections: keep if source OR destination is in filtered components
        filtered.connections.retain(|conn| {
            component_ids.contains(conn.from.as_str()) || component_ids.contains(conn.to.as_str())
        });

        // Recalculate stats
        filtered.stats.total_components = filtered.components.len() as u32;
        filtered.stats.total_connections = filtered.connections.len() as u32;
        filtered.stats.by_type.clear();
        for component in &filtered.components {
            *filtered
                .stats
                .by_type
                .entry(component.component_type)
                .or_insert(0) += 1;
        }

        filtered
    } else {
        compressed_map
    };

    // Serialize to TOON
    let compressed_json = serde_json::to_value(&filtered_map)?;
    output.push_str("```toon\n");
    output.push_str(&serialize_to_toon_compressed(&compressed_json)?);
    output.push_str("\n```\n");

    // Add search info if filtered
    if search.is_some() {
        output.push_str(&format!(
            "\n**Search:** '{}' | **Matched:** {} component(s), {} connection(s)\n",
            search.as_ref().unwrap(),
            filtered_map.stats.total_components,
            filtered_map.stats.total_connections
        ));
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fuzzy_match() {
        // Basic substring matching
        assert!(fuzzy_match("user", "user_table"));
        assert!(fuzzy_match("user", "UserEvents"));
        assert!(fuzzy_match("table", "user_table"));

        // Case insensitive
        assert!(fuzzy_match("USER", "user_table"));
        assert!(fuzzy_match("User", "UserEvents"));
        assert!(fuzzy_match("user", "INGRESS_User"));

        // Partial matches
        assert!(fuzzy_match("eve", "UserEvents"));
        assert!(fuzzy_match("gres", "INGRESS_User"));

        // No match
        assert!(!fuzzy_match("order", "user_table"));
        assert!(!fuzzy_match("xyz", "UserEvents"));
    }

    #[test]
    fn test_fuzzy_match_empty_query() {
        // Empty query matches everything (substring logic)
        assert!(fuzzy_match("", "user_table"));
        assert!(fuzzy_match("", ""));
    }

    #[test]
    fn test_fuzzy_match_exact() {
        assert!(fuzzy_match("user_table", "user_table"));
        assert!(fuzzy_match("Bar", "Bar"));
    }
}
