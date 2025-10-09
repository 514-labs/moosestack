//! # Infrastructure Map Tool
//!
//! This module implements the MCP tool for accessing the Moose infrastructure map.
//! It provides functionality to retrieve, filter, and search through infrastructure components.

use regex::Regex;
use rmcp::model::{Annotated, CallToolResult, RawContent, RawTextContent, Tool};
use serde_json::{json, Map, Value};
use std::sync::Arc;

use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::redis::redis_client::RedisClient;

/// Valid component types for filtering
const VALID_COMPONENT_TYPES: [&str; 12] = [
    "topics",
    "api_endpoints",
    "tables",
    "views",
    "topic_to_table_sync_processes",
    "topic_to_topic_sync_processes",
    "function_processes",
    "block_db_processes",
    "consumption_api_web_server",
    "orchestration_workers",
    "sql_resources",
    "workflows",
];

/// Valid format options
const VALID_FORMATS: [&str; 2] = ["summary", "detailed"];
const DEFAULT_FORMAT: &str = "summary";

/// Error types for infrastructure map retrieval operations
#[derive(Debug, thiserror::Error)]
pub enum InfraMapError {
    #[error("Failed to load infrastructure map from Redis: {0}")]
    RedisLoad(#[from] anyhow::Error),

    #[error("Failed to serialize infrastructure map: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),

    #[error("Invalid regex pattern '{pattern}': {error}")]
    InvalidRegex {
        pattern: String,
        #[source]
        error: regex::Error,
    },
}

/// Compiled search filter for efficient regex matching
#[derive(Debug)]
struct SearchFilter {
    pattern: String,
    regex: Regex,
}

impl SearchFilter {
    /// Create a new search filter with compiled regex
    fn new(pattern: String) -> Result<Self, InfraMapError> {
        let regex = Regex::new(&pattern).map_err(|e| InfraMapError::InvalidRegex {
            pattern: pattern.clone(),
            error: e,
        })?;
        Ok(Self { pattern, regex })
    }

    /// Check if a component name matches the regex pattern
    fn is_match(&self, name: &str) -> bool {
        self.regex.is_match(name)
    }
}

/// Parameters for the get_infra_map tool
#[derive(Debug)]
struct GetInfraMapParams {
    /// Filter by component type (e.g., "tables", "topics", "api_endpoints")
    component_type: Option<String>,
    /// Search filter with precompiled regex
    search: Option<SearchFilter>,
    /// Format option: "summary" (default) or "detailed"
    format: String,
}

/// Helper to check if a component type string is valid
fn is_valid_component_type(component_type: &str) -> bool {
    VALID_COMPONENT_TYPES.contains(&component_type.to_lowercase().as_str())
}

/// Helper to check if a format string is valid
fn is_valid_format(format: &str) -> bool {
    VALID_FORMATS.contains(&format.to_lowercase().as_str())
}

/// Returns the tool definition for the MCP server
pub fn tool_definition() -> Tool {
    let schema = json!({
        "type": "object",
        "properties": {
            "component_type": {
                "type": "string",
                "description": "Filter by component type",
                "enum": VALID_COMPONENT_TYPES
            },
            "search": {
                "type": "string",
                "description": "Regex pattern to search for in component names. Examples: 'user' (simple text), 'user|order' (OR), 'user_\\d+' (with digits), '(?i)user' (case-insensitive)"
            },
            "format": {
                "type": "string",
                "description": format!("Output format: 'summary' (default) or 'detailed'. Summary shows component names and types, detailed shows full configurations. Default: {}", DEFAULT_FORMAT),
                "enum": VALID_FORMATS
            }
        }
    });

    Tool {
        name: "get_infra_map".into(),
        description: Some(
            "Retrieve and explore the Moose infrastructure map. Access all infrastructure components including tables, topics, API endpoints, sync processes, function processes, orchestration workers, SQL resources, and workflows. Filter by component type and search with regex patterns.".into()
        ),
        input_schema: Arc::new(schema.as_object().unwrap().clone()),
        annotations: None,
        icons: None,
        output_schema: None,
        title: Some("Get Moose Infrastructure Map".into()),
    }
}

/// Parse and validate parameters from MCP arguments
fn parse_params(arguments: Option<&Map<String, Value>>) -> Result<GetInfraMapParams, InfraMapError> {
    let component_type = arguments
        .and_then(|v| v.get("component_type"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Validate component_type if provided
    if let Some(ref ct) = component_type {
        if !is_valid_component_type(ct) {
            return Err(InfraMapError::InvalidParameter(format!(
                "component_type must be one of {}; got {}",
                VALID_COMPONENT_TYPES.join(", "),
                ct
            )));
        }
    }

    // Parse and compile search regex if provided
    let search = if let Some(pattern) = arguments
        .and_then(|v| v.get("search"))
        .and_then(|v| v.as_str())
    {
        Some(SearchFilter::new(pattern.to_string())?)
    } else {
        None
    };

    let format = arguments
        .and_then(|v| v.get("format"))
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_FORMAT)
        .to_string();

    // Validate format
    if !is_valid_format(&format) {
        return Err(InfraMapError::InvalidParameter(format!(
            "format must be one of {}; got {}",
            VALID_FORMATS.join(", "),
            format
        )));
    }

    Ok(GetInfraMapParams {
        component_type,
        search,
        format,
    })
}

/// Handle the tool call with the given arguments
pub async fn handle_call(
    arguments: Option<&Map<String, Value>>,
    redis_client: Arc<RedisClient>,
) -> CallToolResult {
    let params = match parse_params(arguments) {
        Ok(p) => p,
        Err(e) => {
            return CallToolResult {
                content: vec![Annotated {
                    raw: RawContent::Text(RawTextContent {
                        text: format!("Parameter validation error: {}", e),
                        meta: None,
                    }),
                    annotations: None,
                }],
                is_error: Some(true),
                meta: None,
                structured_content: None,
            };
        }
    };

    match execute_get_infra_map(params, redis_client).await {
        Ok(content) => CallToolResult {
            content: vec![Annotated {
                raw: RawContent::Text(RawTextContent {
                    text: content,
                    meta: None,
                }),
                annotations: None,
            }],
            is_error: Some(false),
            meta: None,
            structured_content: None,
        },
        Err(e) => CallToolResult {
            content: vec![Annotated {
                raw: RawContent::Text(RawTextContent {
                    text: format!("Error retrieving infrastructure map: {}", e),
                    meta: None,
                }),
                annotations: None,
            }],
            is_error: Some(true),
            meta: None,
            structured_content: None,
        },
    }
}

/// Filter a HashMap by search pattern, returning matching keys
fn filter_by_search<T>(
    map: &std::collections::HashMap<String, T>,
    search: &Option<SearchFilter>,
) -> Vec<String> {
    match search {
        Some(filter) => map
            .keys()
            .filter(|k| filter.is_match(k))
            .cloned()
            .collect(),
        None => map.keys().cloned().collect(),
    }
}

/// Main function to retrieve and filter infrastructure map
async fn execute_get_infra_map(
    params: GetInfraMapParams,
    redis_client: Arc<RedisClient>,
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

    // Apply filtering based on component_type and search
    let output = if params.format == "summary" {
        format_summary(&infra_map, &params.component_type, &params.search)
    } else {
        format_detailed(&infra_map, &params.component_type, &params.search)?
    };

    Ok(output)
}

/// Format infrastructure map as a summary (component names and types)
fn format_summary(
    infra_map: &InfrastructureMap,
    component_type_filter: &Option<String>,
    search: &Option<SearchFilter>,
) -> String {
    let mut output = String::from("# Moose Infrastructure Map (Summary)\n\n");

    let show_all = component_type_filter.is_none();

    if show_all || component_type_filter.as_deref() == Some("topics") {
        let filtered = filter_by_search(&infra_map.topics, search);
        if !filtered.is_empty() {
            output.push_str(&format!("## Topics ({})\n", filtered.len()));
            for name in &filtered {
                output.push_str(&format!("- {}\n", name));
            }
            output.push('\n');
        }
    }

    if show_all || component_type_filter.as_deref() == Some("api_endpoints") {
        let filtered = filter_by_search(&infra_map.api_endpoints, search);
        if !filtered.is_empty() {
            output.push_str(&format!("## API Endpoints ({})\n", filtered.len()));
            for name in &filtered {
                if let Some(endpoint) = infra_map.api_endpoints.get(name) {
                    output.push_str(&format!("- {} ({:?})\n", name, endpoint.api_type));
                }
            }
            output.push('\n');
        }
    }

    if show_all || component_type_filter.as_deref() == Some("tables") {
        let filtered = filter_by_search(&infra_map.tables, search);
        if !filtered.is_empty() {
            output.push_str(&format!("## Tables ({})\n", filtered.len()));
            for name in &filtered {
                output.push_str(&format!("- {}\n", name));
            }
            output.push('\n');
        }
    }

    if show_all || component_type_filter.as_deref() == Some("views") {
        let filtered = filter_by_search(&infra_map.views, search);
        if !filtered.is_empty() {
            output.push_str(&format!("## Views ({})\n", filtered.len()));
            for name in &filtered {
                output.push_str(&format!("- {}\n", name));
            }
            output.push('\n');
        }
    }

    if show_all || component_type_filter.as_deref() == Some("topic_to_table_sync_processes") {
        let filtered = filter_by_search(&infra_map.topic_to_table_sync_processes, search);
        if !filtered.is_empty() {
            output.push_str(&format!(
                "## Topic-to-Table Sync Processes ({})\n",
                filtered.len()
            ));
            for name in &filtered {
                output.push_str(&format!("- {}\n", name));
            }
            output.push('\n');
        }
    }

    if show_all || component_type_filter.as_deref() == Some("topic_to_topic_sync_processes") {
        let filtered = filter_by_search(&infra_map.topic_to_topic_sync_processes, search);
        if !filtered.is_empty() {
            output.push_str(&format!(
                "## Topic-to-Topic Sync Processes ({})\n",
                filtered.len()
            ));
            for name in &filtered {
                output.push_str(&format!("- {}\n", name));
            }
            output.push('\n');
        }
    }

    if show_all || component_type_filter.as_deref() == Some("function_processes") {
        let filtered = filter_by_search(&infra_map.function_processes, search);
        if !filtered.is_empty() {
            output.push_str(&format!("## Function Processes ({})\n", filtered.len()));
            for name in &filtered {
                output.push_str(&format!("- {}\n", name));
            }
            output.push('\n');
        }
    }

    if show_all || component_type_filter.as_deref() == Some("orchestration_workers") {
        let filtered = filter_by_search(&infra_map.orchestration_workers, search);
        if !filtered.is_empty() {
            output.push_str(&format!("## Orchestration Workers ({})\n", filtered.len()));
            for name in &filtered {
                output.push_str(&format!("- {}\n", name));
            }
            output.push('\n');
        }
    }

    if show_all || component_type_filter.as_deref() == Some("sql_resources") {
        let filtered = filter_by_search(&infra_map.sql_resources, search);
        if !filtered.is_empty() {
            output.push_str(&format!("## SQL Resources ({})\n", filtered.len()));
            for name in &filtered {
                output.push_str(&format!("- {}\n", name));
            }
            output.push('\n');
        }
    }

    if show_all || component_type_filter.as_deref() == Some("workflows") {
        let filtered = filter_by_search(&infra_map.workflows, search);
        if !filtered.is_empty() {
            output.push_str(&format!("## Workflows ({})\n", filtered.len()));
            for name in &filtered {
                output.push_str(&format!("- {}\n", name));
            }
            output.push('\n');
        }
    }

    // Add filters applied section if any filters were used
    if component_type_filter.is_some() || search.is_some() {
        output.push_str("\n---\n**Filters applied:**\n");
        if let Some(ct) = component_type_filter {
            output.push_str(&format!("- Component type: {}\n", ct));
        }
        if let Some(s) = search {
            output.push_str(&format!("- Search pattern: {}\n", s.pattern));
        }
    }

    if output.trim() == "# Moose Infrastructure Map (Summary)" {
        output = "No infrastructure components found matching the specified filters.".to_string();
    }

    output
}

/// Format infrastructure map with detailed information (full JSON)
fn format_detailed(
    infra_map: &InfrastructureMap,
    component_type_filter: &Option<String>,
    search: &Option<SearchFilter>,
) -> Result<String, InfraMapError> {
    let mut output = String::from("# Moose Infrastructure Map (Detailed)\n\n");

    // Create a filtered version of the infrastructure map
    let filtered_json = if component_type_filter.is_some() || search.is_some() {
        // Build a filtered JSON object
        let mut filtered = serde_json::Map::new();

        let show_all = component_type_filter.is_none();

        if show_all || component_type_filter.as_deref() == Some("topics") {
            let filtered_keys = filter_by_search(&infra_map.topics, search);
            if !filtered_keys.is_empty() {
                let mut topics_map = serde_json::Map::new();
                for key in filtered_keys {
                    if let Some(topic) = infra_map.topics.get(&key) {
                        topics_map.insert(key, serde_json::to_value(topic)?);
                    }
                }
                filtered.insert("topics".to_string(), Value::Object(topics_map));
            }
        }

        if show_all || component_type_filter.as_deref() == Some("api_endpoints") {
            let filtered_keys = filter_by_search(&infra_map.api_endpoints, search);
            if !filtered_keys.is_empty() {
                let mut api_map = serde_json::Map::new();
                for key in filtered_keys {
                    if let Some(api) = infra_map.api_endpoints.get(&key) {
                        api_map.insert(key, serde_json::to_value(api)?);
                    }
                }
                filtered.insert("api_endpoints".to_string(), Value::Object(api_map));
            }
        }

        if show_all || component_type_filter.as_deref() == Some("tables") {
            let filtered_keys = filter_by_search(&infra_map.tables, search);
            if !filtered_keys.is_empty() {
                let mut tables_map = serde_json::Map::new();
                for key in filtered_keys {
                    if let Some(table) = infra_map.tables.get(&key) {
                        tables_map.insert(key, serde_json::to_value(table)?);
                    }
                }
                filtered.insert("tables".to_string(), Value::Object(tables_map));
            }
        }

        if show_all || component_type_filter.as_deref() == Some("views") {
            let filtered_keys = filter_by_search(&infra_map.views, search);
            if !filtered_keys.is_empty() {
                let mut views_map = serde_json::Map::new();
                for key in filtered_keys {
                    if let Some(view) = infra_map.views.get(&key) {
                        views_map.insert(key, serde_json::to_value(view)?);
                    }
                }
                filtered.insert("views".to_string(), Value::Object(views_map));
            }
        }

        if show_all || component_type_filter.as_deref() == Some("topic_to_table_sync_processes") {
            let filtered_keys = filter_by_search(&infra_map.topic_to_table_sync_processes, search);
            if !filtered_keys.is_empty() {
                let mut sync_map = serde_json::Map::new();
                for key in filtered_keys {
                    if let Some(sync) = infra_map.topic_to_table_sync_processes.get(&key) {
                        sync_map.insert(key, serde_json::to_value(sync)?);
                    }
                }
                filtered.insert(
                    "topic_to_table_sync_processes".to_string(),
                    Value::Object(sync_map),
                );
            }
        }

        if show_all || component_type_filter.as_deref() == Some("topic_to_topic_sync_processes") {
            let filtered_keys = filter_by_search(&infra_map.topic_to_topic_sync_processes, search);
            if !filtered_keys.is_empty() {
                let mut sync_map = serde_json::Map::new();
                for key in filtered_keys {
                    if let Some(sync) = infra_map.topic_to_topic_sync_processes.get(&key) {
                        sync_map.insert(key, serde_json::to_value(sync)?);
                    }
                }
                filtered.insert(
                    "topic_to_topic_sync_processes".to_string(),
                    Value::Object(sync_map),
                );
            }
        }

        if show_all || component_type_filter.as_deref() == Some("function_processes") {
            let filtered_keys = filter_by_search(&infra_map.function_processes, search);
            if !filtered_keys.is_empty() {
                let mut func_map = serde_json::Map::new();
                for key in filtered_keys {
                    if let Some(func) = infra_map.function_processes.get(&key) {
                        func_map.insert(key, serde_json::to_value(func)?);
                    }
                }
                filtered.insert("function_processes".to_string(), Value::Object(func_map));
            }
        }

        if show_all || component_type_filter.as_deref() == Some("orchestration_workers") {
            let filtered_keys = filter_by_search(&infra_map.orchestration_workers, search);
            if !filtered_keys.is_empty() {
                let mut worker_map = serde_json::Map::new();
                for key in filtered_keys {
                    if let Some(worker) = infra_map.orchestration_workers.get(&key) {
                        worker_map.insert(key, serde_json::to_value(worker)?);
                    }
                }
                filtered.insert(
                    "orchestration_workers".to_string(),
                    Value::Object(worker_map),
                );
            }
        }

        if show_all || component_type_filter.as_deref() == Some("sql_resources") {
            let filtered_keys = filter_by_search(&infra_map.sql_resources, search);
            if !filtered_keys.is_empty() {
                let mut sql_map = serde_json::Map::new();
                for key in filtered_keys {
                    if let Some(sql) = infra_map.sql_resources.get(&key) {
                        sql_map.insert(key, serde_json::to_value(sql)?);
                    }
                }
                filtered.insert("sql_resources".to_string(), Value::Object(sql_map));
            }
        }

        if show_all || component_type_filter.as_deref() == Some("workflows") {
            let filtered_keys = filter_by_search(&infra_map.workflows, search);
            if !filtered_keys.is_empty() {
                let mut workflow_map = serde_json::Map::new();
                for key in filtered_keys {
                    if let Some(workflow) = infra_map.workflows.get(&key) {
                        workflow_map.insert(key, serde_json::to_value(workflow)?);
                    }
                }
                filtered.insert("workflows".to_string(), Value::Object(workflow_map));
            }
        }

        Value::Object(filtered)
    } else {
        // No filters, return everything
        serde_json::to_value(infra_map)?
    };

    output.push_str("```json\n");
    output.push_str(&serde_json::to_string_pretty(&filtered_json)?);
    output.push_str("\n```\n");

    // Add filters applied section if any filters were used
    if component_type_filter.is_some() || search.is_some() {
        output.push_str("\n---\n**Filters applied:**\n");
        if let Some(ct) = component_type_filter {
            output.push_str(&format!("- Component type: {}\n", ct));
        }
        if let Some(s) = search {
            output.push_str(&format!("- Search pattern: {}\n", s.pattern));
        }
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_component_type() {
        assert!(is_valid_component_type("topics"));
        assert!(is_valid_component_type("tables"));
        assert!(is_valid_component_type("api_endpoints"));
        assert!(is_valid_component_type("workflows"));

        assert!(!is_valid_component_type("invalid"));
        assert!(!is_valid_component_type(""));
    }

    #[test]
    fn test_is_valid_format() {
        assert!(is_valid_format("summary"));
        assert!(is_valid_format("detailed"));
        assert!(is_valid_format("SUMMARY"));

        assert!(!is_valid_format("invalid"));
        assert!(!is_valid_format(""));
    }

    #[test]
    fn test_search_filter() {
        let filter = SearchFilter::new("user".to_string()).unwrap();
        assert!(filter.is_match("user_table"));
        assert!(filter.is_match("users"));
        assert!(!filter.is_match("orders"));

        let filter = SearchFilter::new("user|order".to_string()).unwrap();
        assert!(filter.is_match("user_table"));
        assert!(filter.is_match("orders"));

        let filter = SearchFilter::new("(?i)USER".to_string()).unwrap();
        assert!(filter.is_match("user_table"));
        assert!(filter.is_match("User"));
    }

    #[test]
    fn test_search_filter_invalid_regex() {
        let result = SearchFilter::new("[invalid".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_params_valid() {
        // Test with all parameters
        let args = json!({
            "component_type": "tables",
            "search": "user",
            "format": "detailed"
        });
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());
        let params = result.unwrap();
        assert_eq!(params.component_type, Some("tables".to_string()));
        assert!(params.search.is_some());
        assert_eq!(params.format, "detailed");

        // Test with no parameters
        let result = parse_params(None);
        assert!(result.is_ok());
        let params = result.unwrap();
        assert_eq!(params.component_type, None);
        assert!(params.search.is_none());
        assert_eq!(params.format, DEFAULT_FORMAT);
    }

    #[test]
    fn test_parse_params_invalid() {
        // Invalid component type
        let args = json!({"component_type": "invalid"});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());

        // Invalid format
        let args = json!({"format": "invalid"});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());

        // Invalid regex
        let args = json!({"search": "[invalid"});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());
    }
}
