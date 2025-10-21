//! # Infrastructure Map Tool
//!
//! This module implements the MCP tool for accessing the Moose infrastructure map.
//! It provides functionality to retrieve, filter, and search through infrastructure components.

use regex::Regex;
use rmcp::model::{CallToolResult, Tool};
use serde_json::{json, Map, Value};
use std::sync::Arc;

use super::{create_error_result, create_success_result};
use crate::framework::core::infrastructure::api_endpoint::ApiEndpoint;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::redis::redis_client::RedisClient;

/// Valid component types for filtering
/// Note: block_db_processes and consumption_api_web_server are single structs, not collections,
/// so they are not included in this list yet. They can be added when they become HashMaps.
const VALID_COMPONENT_TYPES: [&str; 10] = [
    "topics",
    "api_endpoints",
    "tables",
    "views",
    "topic_to_table_sync_processes",
    "topic_to_topic_sync_processes",
    "function_processes",
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
                "description": format!("Output format: 'summary' (default, CSV) or 'detailed' (JSONL). Summary shows component names and types in CSV format for token efficiency. Detailed shows full configurations as minified JSONL (one component per line). Default: {}", DEFAULT_FORMAT),
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
fn parse_params(
    arguments: Option<&Map<String, Value>>,
) -> Result<GetInfraMapParams, InfraMapError> {
    let component_type = arguments
        .and_then(|v| v.get("component_type"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Validate and normalize component_type if provided
    let component_type = if let Some(ct) = component_type {
        if !is_valid_component_type(&ct) {
            return Err(InfraMapError::InvalidParameter(format!(
                "component_type must be one of {}; got {}",
                VALID_COMPONENT_TYPES.join(", "),
                ct
            )));
        }
        // Normalize to lowercase for consistent comparison
        Some(ct.to_lowercase())
    } else {
        None
    };

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
        Err(e) => return create_error_result(format!("Parameter validation error: {}", e)),
    };

    match execute_get_infra_map(params, redis_client).await {
        Ok(content) => create_success_result(content),
        Err(e) => create_error_result(format!("Error retrieving infrastructure map: {}", e)),
    }
}

/// Filter a HashMap by search pattern, returning matching keys
fn filter_by_search<T>(
    map: &std::collections::HashMap<String, T>,
    search: &Option<SearchFilter>,
) -> Vec<String> {
    match search {
        Some(filter) => map.keys().filter(|k| filter.is_match(k)).cloned().collect(),
        None => map.keys().cloned().collect(),
    }
}

/// Process a component type for summary output (CSV format)
/// Returns CSV rows if the component should be shown and has matches
fn process_component_summary<T>(
    component_name: &str,
    map: &std::collections::HashMap<String, T>,
    search: &Option<SearchFilter>,
    component_type_filter: &Option<String>,
    show_all: bool,
) -> Option<Vec<String>> {
    // Check if we should process this component type
    if !show_all && component_type_filter.as_deref() != Some(component_name) {
        return None;
    }

    let filtered = filter_by_search(map, search);
    if filtered.is_empty() {
        return None;
    }

    let mut rows = Vec::new();
    for name in &filtered {
        rows.push(format!("{},{},", component_name, name));
    }

    Some(rows)
}

/// Format API type for display
fn format_api_type(
    api_type: &crate::framework::core::infrastructure::api_endpoint::APIType,
) -> String {
    use crate::framework::core::infrastructure::api_endpoint::APIType;
    match api_type {
        APIType::INGRESS {
            target_topic_id, ..
        } => {
            format!("INGRESS -> topic: {}", target_topic_id)
        }
        APIType::EGRESS { query_params, .. } => {
            if query_params.is_empty() {
                "EGRESS".to_string()
            } else {
                format!("EGRESS ({} params)", query_params.len())
            }
        }
    }
}

/// Process API endpoints for summary output (CSV format with api_type info)
fn process_api_endpoints_summary(
    api_endpoints: &std::collections::HashMap<String, ApiEndpoint>,
    search: &Option<SearchFilter>,
    component_type_filter: &Option<String>,
    show_all: bool,
) -> Option<Vec<String>> {
    // Check if we should process this component type
    if !show_all && component_type_filter.as_deref() != Some("api_endpoints") {
        return None;
    }

    let filtered = filter_by_search(api_endpoints, search);
    if filtered.is_empty() {
        return None;
    }

    let mut rows = Vec::new();
    for name in &filtered {
        if let Some(endpoint) = api_endpoints.get(name) {
            rows.push(format!(
                "api_endpoints,{},{}",
                name,
                format_api_type(&endpoint.api_type)
            ));
        }
    }

    Some(rows)
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

/// Format infrastructure map as a summary (CSV format for token efficiency)
fn format_summary(
    infra_map: &InfrastructureMap,
    component_type_filter: &Option<String>,
    search: &Option<SearchFilter>,
) -> String {
    let show_all = component_type_filter.is_none();

    // Process each component type using helper functions
    let component_results = vec![
        process_component_summary(
            "topics",
            &infra_map.topics,
            search,
            component_type_filter,
            show_all,
        ),
        process_api_endpoints_summary(
            &infra_map.api_endpoints,
            search,
            component_type_filter,
            show_all,
        ),
        process_component_summary(
            "tables",
            &infra_map.tables,
            search,
            component_type_filter,
            show_all,
        ),
        process_component_summary(
            "views",
            &infra_map.views,
            search,
            component_type_filter,
            show_all,
        ),
        process_component_summary(
            "topic_to_table_sync_processes",
            &infra_map.topic_to_table_sync_processes,
            search,
            component_type_filter,
            show_all,
        ),
        process_component_summary(
            "topic_to_topic_sync_processes",
            &infra_map.topic_to_topic_sync_processes,
            search,
            component_type_filter,
            show_all,
        ),
        process_component_summary(
            "function_processes",
            &infra_map.function_processes,
            search,
            component_type_filter,
            show_all,
        ),
        process_component_summary(
            "orchestration_workers",
            &infra_map.orchestration_workers,
            search,
            component_type_filter,
            show_all,
        ),
        process_component_summary(
            "sql_resources",
            &infra_map.sql_resources,
            search,
            component_type_filter,
            show_all,
        ),
        process_component_summary(
            "workflows",
            &infra_map.workflows,
            search,
            component_type_filter,
            show_all,
        ),
    ];

    // Collect all CSV rows
    let mut all_rows = Vec::new();
    for rows in component_results.into_iter().flatten() {
        all_rows.extend(rows);
    }

    if all_rows.is_empty() {
        return "No infrastructure components found matching the specified filters.".to_string();
    }

    // Build CSV output
    let mut output = String::from("type,name,info\n");
    for row in all_rows {
        output.push_str(&row);
        output.push('\n');
    }

    // Add filters as comment if any were used
    if component_type_filter.is_some() || search.is_some() {
        output.push_str("# Filters:");
        if let Some(ct) = component_type_filter {
            output.push_str(&format!(" type={}", ct));
        }
        if let Some(s) = search {
            output.push_str(&format!(" search={}", s.pattern));
        }
        output.push('\n');
    }

    output
}

/// Helper to add components as JSONL entries
fn add_components_to_jsonl<T: serde::Serialize>(
    component_type: &str,
    map: &std::collections::HashMap<String, T>,
    search: &Option<SearchFilter>,
    component_type_filter: &Option<String>,
    show_all: bool,
    lines: &mut Vec<String>,
) -> Result<(), InfraMapError> {
    if !show_all && component_type_filter.as_deref() != Some(component_type) {
        return Ok(());
    }

    let filtered_keys = filter_by_search(map, search);
    for key in filtered_keys {
        if let Some(value) = map.get(&key) {
            let mut obj = serde_json::Map::new();
            obj.insert(
                "type".to_string(),
                Value::String(component_type.to_string()),
            );
            obj.insert("name".to_string(), Value::String(key.clone()));
            obj.insert("config".to_string(), serde_json::to_value(value)?);

            // Minified JSON - no spaces or newlines
            lines.push(serde_json::to_string(&obj)?);
        }
    }
    Ok(())
}

/// Format infrastructure map with detailed information (JSONL format for token efficiency)
fn format_detailed(
    infra_map: &InfrastructureMap,
    component_type_filter: &Option<String>,
    search: &Option<SearchFilter>,
) -> Result<String, InfraMapError> {
    let show_all = component_type_filter.is_none();
    let mut lines = Vec::new();

    // Process each component type
    add_components_to_jsonl(
        "topics",
        &infra_map.topics,
        search,
        component_type_filter,
        show_all,
        &mut lines,
    )?;
    add_components_to_jsonl(
        "api_endpoints",
        &infra_map.api_endpoints,
        search,
        component_type_filter,
        show_all,
        &mut lines,
    )?;
    add_components_to_jsonl(
        "tables",
        &infra_map.tables,
        search,
        component_type_filter,
        show_all,
        &mut lines,
    )?;
    add_components_to_jsonl(
        "views",
        &infra_map.views,
        search,
        component_type_filter,
        show_all,
        &mut lines,
    )?;
    add_components_to_jsonl(
        "topic_to_table_sync_processes",
        &infra_map.topic_to_table_sync_processes,
        search,
        component_type_filter,
        show_all,
        &mut lines,
    )?;
    add_components_to_jsonl(
        "topic_to_topic_sync_processes",
        &infra_map.topic_to_topic_sync_processes,
        search,
        component_type_filter,
        show_all,
        &mut lines,
    )?;
    add_components_to_jsonl(
        "function_processes",
        &infra_map.function_processes,
        search,
        component_type_filter,
        show_all,
        &mut lines,
    )?;
    add_components_to_jsonl(
        "orchestration_workers",
        &infra_map.orchestration_workers,
        search,
        component_type_filter,
        show_all,
        &mut lines,
    )?;
    add_components_to_jsonl(
        "sql_resources",
        &infra_map.sql_resources,
        search,
        component_type_filter,
        show_all,
        &mut lines,
    )?;
    add_components_to_jsonl(
        "workflows",
        &infra_map.workflows,
        search,
        component_type_filter,
        show_all,
        &mut lines,
    )?;

    if lines.is_empty() {
        return Ok(
            "No infrastructure components found matching the specified filters.".to_string(),
        );
    }

    let mut output = lines.join("\n");

    // Add filters as comment if any were used
    if component_type_filter.is_some() || search.is_some() {
        output.push_str("\n# Filters:");
        if let Some(ct) = component_type_filter {
            output.push_str(&format!(" type={}", ct));
        }
        if let Some(s) = search {
            output.push_str(&format!(" search={}", s.pattern));
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

    #[test]
    fn test_parse_params_case_insensitive() {
        // Test that component_type is normalized to lowercase
        let args = json!({"component_type": "TOPICS"});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());
        let params = result.unwrap();
        assert_eq!(params.component_type, Some("topics".to_string()));

        let args = json!({"component_type": "Tables"});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());
        let params = result.unwrap();
        assert_eq!(params.component_type, Some("tables".to_string()));
    }

    #[test]
    fn test_filter_by_search_no_filter() {
        use std::collections::HashMap;

        let mut map = HashMap::new();
        map.insert("user_table".to_string(), 1);
        map.insert("order_table".to_string(), 2);
        map.insert("product_table".to_string(), 3);

        let result = filter_by_search(&map, &None);
        assert_eq!(result.len(), 3);
        assert!(result.contains(&"user_table".to_string()));
        assert!(result.contains(&"order_table".to_string()));
        assert!(result.contains(&"product_table".to_string()));
    }

    #[test]
    fn test_filter_by_search_with_filter() {
        use std::collections::HashMap;

        let mut map = HashMap::new();
        map.insert("user_table".to_string(), 1);
        map.insert("order_table".to_string(), 2);
        map.insert("product_table".to_string(), 3);

        let filter = SearchFilter::new("user".to_string()).unwrap();
        let result = filter_by_search(&map, &Some(filter));
        assert_eq!(result.len(), 1);
        assert!(result.contains(&"user_table".to_string()));

        let filter = SearchFilter::new("table".to_string()).unwrap();
        let result = filter_by_search(&map, &Some(filter));
        assert_eq!(result.len(), 3);

        let filter = SearchFilter::new("user|order".to_string()).unwrap();
        let result = filter_by_search(&map, &Some(filter));
        assert_eq!(result.len(), 2);
        assert!(result.contains(&"user_table".to_string()));
        assert!(result.contains(&"order_table".to_string()));
    }

    #[test]
    fn test_filter_by_search_empty_result() {
        use std::collections::HashMap;

        let mut map = HashMap::new();
        map.insert("user_table".to_string(), 1);
        map.insert("order_table".to_string(), 2);

        let filter = SearchFilter::new("product".to_string()).unwrap();
        let result = filter_by_search(&map, &Some(filter));
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_format_api_type() {
        use crate::framework::core::infrastructure::api_endpoint::APIType;

        // Test INGRESS type
        let ingress = APIType::INGRESS {
            target_topic_id: "user_events".to_string(),
            data_model: None,
            dead_letter_queue: None,
            schema: serde_json::Map::default(),
        };
        let result = format_api_type(&ingress);
        assert_eq!(result, "INGRESS -> topic: user_events");

        // Test EGRESS type with no params
        let egress_no_params = APIType::EGRESS {
            query_params: vec![],
            output_schema: serde_json::Value::Null,
        };
        let result = format_api_type(&egress_no_params);
        assert_eq!(result, "EGRESS");
    }
}
