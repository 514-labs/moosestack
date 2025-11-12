//! # Get Source Tool
//!
//! This module implements the MCP tool for retrieving source file location information
//! for infrastructure components. It returns the file path where a component
//! was defined in the user's codebase.

use rmcp::model::{CallToolResult, Tool};
use serde_json::{json, Map, Value};
use std::sync::Arc;

use super::{create_error_result, create_success_result};
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::redis::redis_client::RedisClient;

/// Valid component types that support source location metadata
const VALID_COMPONENT_TYPES: [&str; 3] = ["topics", "api_endpoints", "tables"];

/// Error types for get source operations
#[derive(Debug, thiserror::Error)]
pub enum GetSourceError {
    #[error("Failed to load infrastructure map from Redis: {0}")]
    RedisLoad(#[from] anyhow::Error),

    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),

    #[error("Component not found: {component_type}/{name}")]
    ComponentNotFound {
        component_type: String,
        name: String,
    },
}

/// Parameters for the get_source tool
#[derive(Debug)]
struct GetSourceParams {
    /// Component type (e.g., "tables", "topics", "api_endpoints", "function_processes")
    /// If not provided, will search across all component types
    component_type: Option<String>,
    /// Query to search for - can be name, ID, path, or other identifying attribute
    query: String,
}

/// Helper to check if a component type supports source location
fn is_valid_component_type(component_type: &str) -> bool {
    VALID_COMPONENT_TYPES.contains(&component_type.to_lowercase().as_str())
}

/// Returns the tool definition for the MCP server
pub fn tool_definition() -> Tool {
    let schema = json!({
        "type": "object",
        "properties": {
            "component_type": {
                "type": "string",
                "description": "Optional: Filter by component type (topics, api_endpoints, or tables). If omitted, searches all types. Enables partial matching when specified.",
                "enum": VALID_COMPONENT_TYPES
            },
            "query": {
                "type": "string",
                "description": "Component name, ID, or path to search for. Examples: 'Foo', 'ingest/MetaCampaign', 'EGRESS_bar_1', 'bar/1'"
            }
        },
        "required": ["query"]
    });

    Tool {
        name: "get_source".into(),
        description: Some(
            r#"Get the source file path where an infrastructure component was defined in your Moose project.

**Searchable Component Types:**
- topics: Redpanda/Kafka topics (stream sources)
- tables: ClickHouse tables (OLAP storage)
- api_endpoints: Ingestion and consumption APIs

**Search Query Options:**
- Component name: "Foo", "Bar", "MetaCampaign"
- API path: "ingest/Foo", "bar/1", "bar"
- Internal ID: "INGRESS_Foo", "EGRESS_bar"

**Search Behavior:**
- WITH component_type: Partial matching (e.g., "Meta" finds "MetaCampaign", "MetaAdSet")
- WITHOUT component_type: Searches across all component types
- Returns multiple matches if query is ambiguous

**Components WITHOUT source tracking:**
- function_processes: Transform functions (derived from code, not defined directly)
- sql_resources: Materialized views (generated SQL)
- orchestration_workers: Temporal workers (runtime components)
- sync_processes: Topic-to-table syncs (auto-generated)
- Metadata fields: Column names, primitive types, etc.

**Returns:**
File path where the component is defined."#.into()
        ),
        input_schema: Arc::new(schema.as_object().unwrap().clone()),
        annotations: None,
        icons: None,
        output_schema: None,
        title: Some("Get Source Location".into()),
    }
}

/// Parse and validate parameters from MCP arguments
fn parse_params(arguments: Option<&Map<String, Value>>) -> Result<GetSourceParams, GetSourceError> {
    let component_type = arguments
        .and_then(|v| v.get("component_type"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_lowercase());

    let query = arguments
        .and_then(|v| v.get("query"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| GetSourceError::InvalidParameter("query is required".to_string()))?
        .to_string();

    // Validate component_type if provided
    if let Some(ref ct) = component_type {
        if !is_valid_component_type(ct) {
            return Err(GetSourceError::InvalidParameter(format!(
                "component_type must be one of {}; got {}",
                VALID_COMPONENT_TYPES.join(", "),
                ct
            )));
        }
    }

    Ok(GetSourceParams {
        component_type,
        query,
    })
}

/// Result of a component search
#[derive(Debug)]
struct SearchResult {
    component_type: String,
    display_name: String,
    source_file: String,
}

/// Search for a component in the infrastructure map using flexible matching
fn search_components(
    query: &str,
    component_type: Option<&str>,
    infra_map: &InfrastructureMap,
) -> Vec<SearchResult> {
    let mut results = Vec::new();

    // Determine which component types to search
    let types_to_search: Vec<&str> = match component_type {
        Some(t) => vec![t],
        None => VALID_COMPONENT_TYPES.to_vec(),
    };

    for comp_type in types_to_search {
        match comp_type {
            "topics" => {
                for (id, topic) in &infra_map.topics {
                    if matches_query(query, id, &topic.name, None) {
                        if let Some(file) = topic
                            .metadata
                            .as_ref()
                            .and_then(|m| m.source.as_ref())
                            .map(|s| s.file.clone())
                        {
                            results.push(SearchResult {
                                component_type: "topics".to_string(),
                                display_name: topic.name.clone(),
                                source_file: file,
                            });
                        }
                    }
                }
            }
            "api_endpoints" => {
                for (id, endpoint) in &infra_map.api_endpoints {
                    // For API endpoints, also search by path
                    let path_str = endpoint.path.to_string_lossy();
                    if matches_query(query, id, &endpoint.name, Some(&path_str)) {
                        if let Some(file) = endpoint
                            .metadata
                            .as_ref()
                            .and_then(|m| m.source.as_ref())
                            .map(|s| s.file.clone())
                        {
                            results.push(SearchResult {
                                component_type: "api_endpoints".to_string(),
                                display_name: format!("{} ({})", endpoint.name, path_str),
                                source_file: file,
                            });
                        }
                    }
                }
            }
            "tables" => {
                for (id, table) in &infra_map.tables {
                    if matches_query(query, id, &table.name, None) {
                        if let Some(file) = table
                            .metadata
                            .as_ref()
                            .and_then(|m| m.source.as_ref())
                            .map(|s| s.file.clone())
                        {
                            results.push(SearchResult {
                                component_type: "tables".to_string(),
                                display_name: table.name.clone(),
                                source_file: file,
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }

    results
}

/// Check if a query matches a component
/// Supports exact ID match, name match, and additional field match (e.g., path for APIs)
fn matches_query(query: &str, id: &str, name: &str, additional: Option<&str>) -> bool {
    let query_lower = query.to_lowercase();
    let id_lower = id.to_lowercase();
    let name_lower = name.to_lowercase();

    // Exact match on ID or name
    if id_lower == query_lower || name_lower == query_lower {
        return true;
    }

    // Match on additional field (e.g., path)
    if let Some(add) = additional {
        let add_lower = add.to_lowercase();
        if add_lower == query_lower {
            return true;
        }
        // Also check if path starts with query (for partial path matches)
        if add_lower.starts_with(&query_lower) || add_lower.contains(&query_lower) {
            return true;
        }
    }

    // Partial match on ID or name
    if id_lower.contains(&query_lower) || name_lower.contains(&query_lower) {
        return true;
    }

    false
}

/// Main function to get source location for a component
async fn execute_get_source(
    params: GetSourceParams,
    redis_client: Arc<RedisClient>,
) -> Result<String, GetSourceError> {
    // Load infrastructure map from Redis
    let infra_map_opt = InfrastructureMap::load_from_redis(&redis_client).await?;

    let infra_map = infra_map_opt.ok_or_else(|| {
        GetSourceError::InvalidParameter(
            "No infrastructure map found. The dev server may not be running or no infrastructure has been deployed yet.".to_string()
        )
    })?;

    // Search for matching components
    let results = search_components(&params.query, params.component_type.as_deref(), &infra_map);

    if results.is_empty() {
        return Err(GetSourceError::ComponentNotFound {
            component_type: params.component_type.unwrap_or_else(|| "any".to_string()),
            name: params.query.clone(),
        });
    }

    // If we have exactly one match, return it
    if results.len() == 1 {
        let result = &results[0];
        let output = format!(
            "# Source Location\n\n**Component:** {}/{}\n**File:** {}",
            result.component_type, result.display_name, result.source_file
        );
        return Ok(output);
    }

    // If we have multiple matches, return all of them
    let mut output = format!(
        "# Multiple Matches Found for '{}'\n\nFound {} matching components:\n\n",
        params.query,
        results.len()
    );

    for (idx, result) in results.iter().enumerate() {
        output.push_str(&format!(
            "{}. **{}** ({})\n   - File: {}\n\n",
            idx + 1,
            result.display_name,
            result.component_type,
            result.source_file
        ));
    }

    Ok(output)
}

/// Handle the tool call with the given arguments
pub async fn handle_call(
    arguments: Option<&Map<String, Value>>,
    redis_client: Arc<RedisClient>,
) -> CallToolResult {
    let params = match parse_params(arguments) {
        Ok(p) => p,
        Err(e) => return create_error_result(format!("Parameter validation error: {}", e)),
    };

    match execute_get_source(params, redis_client).await {
        Ok(content) => create_success_result(content),
        Err(e) => create_error_result(format!("Error retrieving source location: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_component_type() {
        assert!(is_valid_component_type("topics"));
        assert!(is_valid_component_type("tables"));
        assert!(is_valid_component_type("api_endpoints"));

        assert!(!is_valid_component_type("function_processes"));
        assert!(!is_valid_component_type("views"));
        assert!(!is_valid_component_type("invalid"));
        assert!(!is_valid_component_type(""));
    }

    #[test]
    fn test_parse_params_valid() {
        let args = json!({
            "component_type": "tables",
            "query": "user_table"
        });
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());
        let params = result.unwrap();
        assert_eq!(params.component_type, Some("tables".to_string()));
        assert_eq!(params.query, "user_table");
    }

    #[test]
    fn test_parse_params_query_only() {
        // component_type is now optional
        let args = json!({"query": "user_table"});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());
        let params = result.unwrap();
        assert_eq!(params.component_type, None);
        assert_eq!(params.query, "user_table");
    }

    #[test]
    fn test_parse_params_missing_query() {
        // Missing query
        let args = json!({"component_type": "tables"});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());

        // No arguments
        let result = parse_params(None);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_params_invalid_component_type() {
        let args = json!({
            "component_type": "invalid",
            "query": "test"
        });
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_params_case_insensitive() {
        let args = json!({
            "component_type": "TOPICS",
            "query": "user_events"
        });
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());
        let params = result.unwrap();
        assert_eq!(params.component_type, Some("topics".to_string()));
    }

    #[test]
    fn test_matches_query_exact() {
        assert!(matches_query("user_table", "user_table", "users", None));
        assert!(matches_query("users", "user_table", "users", None));
    }

    #[test]
    fn test_matches_query_partial() {
        assert!(matches_query("user", "user_table", "users", None));
        assert!(matches_query("table", "user_table", "users", None));
    }

    #[test]
    fn test_matches_query_additional_field() {
        // Test matching on additional field (e.g., API path)
        assert!(matches_query(
            "/ingest/user",
            "user_api",
            "UserAPI",
            Some("/ingest/user/0.0")
        ));
        assert!(matches_query(
            "ingest",
            "user_api",
            "UserAPI",
            Some("/ingest/user/0.0")
        ));
    }

    #[test]
    fn test_matches_query_case_insensitive() {
        assert!(matches_query("USER", "user_table", "users", None));
        assert!(matches_query("Table", "user_table", "users", None));
    }
}
