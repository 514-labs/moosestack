//! # Infrastructure Issues Diagnostic Tool
//!
//! This module implements a proactive infrastructure diagnostics MCP tool that intelligently
//! surfaces errors by using the infrastructure map to determine what to check based on
//! infrastructure type (ClickHouse, Kafka/Redpanda, Temporal, etc.).
//!
//! Initial implementation focuses on ClickHouse diagnostics with extensible architecture
//! for future infrastructure types.
//!
//! See the shared `crate::infrastructure::olap::clickhouse::diagnostics` module for
//! detailed documentation on each diagnostic provider.

use regex::Regex;
use rmcp::model::{CallToolResult, Tool};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{debug, info};

use super::toon_serializer::serialize_to_toon_compressed;
use super::{create_error_result, create_success_result};
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::olap::clickhouse::diagnostics::{
    Component, DiagnosticOptions, DiagnosticOutput, DiagnosticRequest, InfrastructureType, Severity,
};
use crate::infrastructure::redis::redis_client::RedisClient;

/// Error types for MCP infrastructure diagnostic operations
#[derive(Debug, thiserror::Error)]
pub enum DiagnoseError {
    #[error("Failed to load infrastructure map: {0}")]
    InfraMapLoad(#[from] anyhow::Error),

    #[error("Failed to execute diagnostics: {0}")]
    DiagnosticFailed(String),

    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),

    #[error("Invalid regex pattern '{pattern}': {error}")]
    InvalidRegex {
        pattern: String,
        #[source]
        error: regex::Error,
    },

    #[error("Unsupported infrastructure type: {0}")]
    UnsupportedInfrastructureType(String),
}

/// Component filter for targeting specific infrastructure components
#[derive(Debug, Clone)]
pub struct ComponentFilter {
    /// Type of component to filter (e.g., "table", "topic", "view", "all")
    pub component_type: Option<String>,
    /// Regex pattern to match component names
    pub component_name: Option<Regex>,
}

/// Parameters for the diagnose_infrastructure MCP tool
#[derive(Debug)]
pub struct DiagnoseInfraParams {
    /// Which infrastructure type to diagnose
    pub infrastructure_type: InfrastructureType,
    /// Optional filter for specific components
    pub component_filter: Option<ComponentFilter>,
    /// Minimum severity level to report
    pub severity: Severity,
    /// Optional time filter (e.g., "-1h" for last hour)
    pub since: Option<String>,
}

impl Severity {
    fn from_str(s: &str) -> Result<Self, DiagnoseError> {
        match s.to_lowercase().as_str() {
            "error" => Ok(Severity::Error),
            "warning" => Ok(Severity::Warning),
            "info" => Ok(Severity::Info),
            "all" => Ok(Severity::Info), // "all" maps to lowest severity (includes everything)
            _ => Err(DiagnoseError::InvalidParameter(format!(
                "Invalid severity: {}. Must be one of: error, warning, info, all",
                s
            ))),
        }
    }
}

impl InfrastructureType {
    fn from_str(s: &str) -> Result<Self, DiagnoseError> {
        match s.to_lowercase().as_str() {
            "clickhouse" => Ok(InfrastructureType::ClickHouse),
            _ => Err(DiagnoseError::UnsupportedInfrastructureType(s.to_string())),
        }
    }
}

/// Returns the tool definition for the MCP server
pub fn tool_definition() -> Tool {
    let schema = json!({
        "type": "object",
        "properties": {
            "infrastructure_type": {
                "type": "string",
                "description": "Which infrastructure type to diagnose",
                "enum": ["clickhouse"],
                "default": "clickhouse"
            },
            "component_filter": {
                "type": "object",
                "description": "Optional filter for specific components",
                "properties": {
                    "component_type": {
                        "type": "string",
                        "description": "Type of component to check (e.g., 'table', 'view', 'all')",
                        "enum": ["table", "view", "all"]
                    },
                    "component_name": {
                        "type": "string",
                        "description": "Regex pattern to match component names (e.g., 'user_.*' for all user tables)"
                    }
                }
            },
            "severity": {
                "type": "string",
                "description": "Minimum severity level to report",
                "enum": ["error", "warning", "info", "all"],
                "default": "all"
            },
            "since": {
                "type": "string",
                "description": "Optional time filter for issues (e.g., '-1h' for last hour, '-30m' for last 30 minutes)",
                "examples": ["-1h", "-30m", "-1d", "2024-01-01T00:00:00Z"]
            }
        },
        "required": ["infrastructure_type"]
    });

    Tool {
        name: "get_issues".into(),
        description: Some(
            "Proactively scan for health issues (stuck mutations, replication errors, S3Queue failures, merge problems). Auto-checks relevant diagnostics based on infrastructure type. Use when investigating errors or performance issues. Returns actionable problems with remediation suggestions.".into()
        ),
        input_schema: Arc::new(schema.as_object().unwrap().clone()),
        annotations: None,
        icons: None,
        output_schema: None,
        title: Some("Get Project Issues".into()),
    }
}

/// Parse and validate parameters from MCP arguments
fn parse_params(
    arguments: Option<&Map<String, Value>>,
) -> Result<DiagnoseInfraParams, DiagnoseError> {
    let args = arguments
        .ok_or_else(|| DiagnoseError::InvalidParameter("No arguments provided".to_string()))?;

    // Parse infrastructure_type (required)
    let infrastructure_type_str = args
        .get("infrastructure_type")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            DiagnoseError::InvalidParameter("infrastructure_type parameter is required".to_string())
        })?;
    let infrastructure_type = InfrastructureType::from_str(infrastructure_type_str)?;

    // Parse component_filter (optional)
    let component_filter =
        if let Some(filter_obj) = args.get("component_filter").and_then(|v| v.as_object()) {
            let component_type = filter_obj
                .get("component_type")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let component_name =
                if let Some(pattern) = filter_obj.get("component_name").and_then(|v| v.as_str()) {
                    Some(
                        Regex::new(pattern).map_err(|e| DiagnoseError::InvalidRegex {
                            pattern: pattern.to_string(),
                            error: e,
                        })?,
                    )
                } else {
                    None
                };

            Some(ComponentFilter {
                component_type,
                component_name,
            })
        } else {
            None
        };

    // Parse severity (optional, default to Info which includes all)
    let severity = args
        .get("severity")
        .and_then(|v| v.as_str())
        .map(Severity::from_str)
        .transpose()?
        .unwrap_or(Severity::Info);

    // Parse since (optional)
    let since = args
        .get("since")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(DiagnoseInfraParams {
        infrastructure_type,
        component_filter,
        severity,
        since,
    })
}

/// Handle the MCP tool call with the given arguments
pub async fn handle_call(
    arguments: Option<&Map<String, Value>>,
    redis_client: Arc<RedisClient>,
    clickhouse_config: &ClickHouseConfig,
) -> CallToolResult {
    let params = match parse_params(arguments) {
        Ok(p) => p,
        Err(e) => return create_error_result(format!("Parameter validation error: {}", e)),
    };

    match execute_diagnose_infrastructure(params, redis_client, clickhouse_config).await {
        Ok(output) => {
            // Convert output to JSON Value first
            match serde_json::to_value(&output) {
                Ok(json_value) => {
                    // Format as TOON
                    match serialize_to_toon_compressed(&json_value) {
                        Ok(toon_str) => create_success_result(toon_str),
                        Err(e) => create_error_result(format!("Failed to format as TOON: {}", e)),
                    }
                }
                Err(e) => create_error_result(format!("Failed to convert output to JSON: {}", e)),
            }
        }
        Err(e) => create_error_result(format!("Infrastructure diagnostics error: {}", e)),
    }
}

/// Main execution function for infrastructure diagnostics
async fn execute_diagnose_infrastructure(
    params: DiagnoseInfraParams,
    redis_client: Arc<RedisClient>,
    clickhouse_config: &ClickHouseConfig,
) -> Result<DiagnosticOutput, DiagnoseError> {
    info!(
        "Running infrastructure diagnostics for {:?} with severity filter: {:?}",
        params.infrastructure_type, params.severity
    );

    match params.infrastructure_type {
        InfrastructureType::ClickHouse => {
            diagnose_clickhouse(params, redis_client, clickhouse_config).await
        }
    }
}

/// Diagnose ClickHouse infrastructure using the shared diagnostics module
async fn diagnose_clickhouse(
    params: DiagnoseInfraParams,
    redis_client: Arc<RedisClient>,
    clickhouse_config: &ClickHouseConfig,
) -> Result<DiagnosticOutput, DiagnoseError> {
    debug!("Loading infrastructure map from Redis");

    // Load infrastructure map
    let infra_map = InfrastructureMap::load_from_redis(&redis_client)
        .await?
        .ok_or_else(|| {
            DiagnoseError::InfraMapLoad(anyhow::anyhow!(
                "No infrastructure map found. The dev server may not be running."
            ))
        })?;

    // Filter tables based on component_filter
    let tables_to_check: Vec<_> = infra_map
        .tables
        .iter()
        .filter(|(_map_key, table)| {
            if let Some(ref filter) = params.component_filter {
                // Check component_type filter
                if let Some(ref ctype) = filter.component_type {
                    if ctype != "all" && ctype != "table" {
                        return false;
                    }
                }

                // Check component_name regex filter against actual table name
                if let Some(ref regex) = filter.component_name {
                    if !regex.is_match(&table.name) {
                        return false;
                    }
                }
            }
            true
        })
        .collect();

    debug!("Checking {} tables for issues", tables_to_check.len());

    // Build DiagnosticRequest with components from infrastructure map
    let components: Vec<_> = tables_to_check
        .iter()
        .map(|(_map_key, table)| {
            let mut metadata = HashMap::new();
            metadata.insert("database".to_string(), clickhouse_config.db_name.clone());

            let component = Component {
                component_type: "table".to_string(),
                name: table.name.clone(), // Use the actual table name
                metadata,
            };

            (component, table.engine.clone())
        })
        .collect();

    let request = DiagnosticRequest {
        components,
        options: DiagnosticOptions {
            diagnostic_names: Vec::new(), // Run all diagnostics
            min_severity: params.severity,
            since: params.since,
        },
    };

    // Use the shared run_diagnostics function
    let output = crate::infrastructure::olap::clickhouse::diagnostics::run_diagnostics(
        request,
        clickhouse_config,
    )
    .await
    .map_err(|e| DiagnoseError::DiagnosticFailed(format!("{}", e)))?;

    info!(
        "Infrastructure diagnostics complete. Found {} issues.",
        output.issues.len()
    );

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_infrastructure_type_from_str() {
        assert!(matches!(
            InfrastructureType::from_str("clickhouse"),
            Ok(InfrastructureType::ClickHouse)
        ));
        assert!(matches!(
            InfrastructureType::from_str("CLICKHOUSE"),
            Ok(InfrastructureType::ClickHouse)
        ));
        assert!(InfrastructureType::from_str("kafka").is_err());
        assert!(InfrastructureType::from_str("invalid").is_err());
    }

    #[test]
    fn test_severity_from_str() {
        assert!(matches!(Severity::from_str("error"), Ok(Severity::Error)));
        assert!(matches!(
            Severity::from_str("warning"),
            Ok(Severity::Warning)
        ));
        assert!(matches!(Severity::from_str("info"), Ok(Severity::Info)));
        assert!(matches!(Severity::from_str("all"), Ok(Severity::Info)));
        assert!(Severity::from_str("invalid").is_err());
    }

    #[test]
    fn test_severity_includes() {
        // Info includes all
        assert!(Severity::Info.includes(&Severity::Error));
        assert!(Severity::Info.includes(&Severity::Warning));
        assert!(Severity::Info.includes(&Severity::Info));

        // Warning includes warning and error
        assert!(Severity::Warning.includes(&Severity::Error));
        assert!(Severity::Warning.includes(&Severity::Warning));
        assert!(!Severity::Warning.includes(&Severity::Info));

        // Error includes only error
        assert!(Severity::Error.includes(&Severity::Error));
        assert!(!Severity::Error.includes(&Severity::Warning));
        assert!(!Severity::Error.includes(&Severity::Info));
    }

    #[test]
    fn test_parse_params_minimal() {
        let args = json!({
            "infrastructure_type": "clickhouse"
        });

        let params = parse_params(args.as_object()).unwrap();

        assert!(matches!(
            params.infrastructure_type,
            InfrastructureType::ClickHouse
        ));
        assert!(params.component_filter.is_none());
        assert!(matches!(params.severity, Severity::Info)); // Default
        assert!(params.since.is_none());
    }

    #[test]
    fn test_parse_params_full() {
        let args = json!({
            "infrastructure_type": "clickhouse",
            "component_filter": {
                "component_type": "table",
                "component_name": "user_.*"
            },
            "severity": "error",
            "since": "-1h"
        });

        let params = parse_params(args.as_object()).unwrap();

        assert!(matches!(
            params.infrastructure_type,
            InfrastructureType::ClickHouse
        ));
        assert!(matches!(params.severity, Severity::Error));
        assert_eq!(params.since, Some("-1h".to_string()));

        let filter = params.component_filter.unwrap();
        assert_eq!(filter.component_type, Some("table".to_string()));
        assert!(filter.component_name.is_some());

        let regex = filter.component_name.unwrap();
        assert!(regex.is_match("user_events"));
        assert!(regex.is_match("user_profiles"));
        assert!(!regex.is_match("events"));
    }

    #[test]
    fn test_parse_params_component_filter_type_only() {
        let args = json!({
            "infrastructure_type": "clickhouse",
            "component_filter": {
                "component_type": "view"
            }
        });

        let params = parse_params(args.as_object()).unwrap();

        let filter = params.component_filter.unwrap();
        assert_eq!(filter.component_type, Some("view".to_string()));
        assert!(filter.component_name.is_none());
    }

    #[test]
    fn test_parse_params_component_filter_name_only() {
        let args = json!({
            "infrastructure_type": "clickhouse",
            "component_filter": {
                "component_name": "events"
            }
        });

        let params = parse_params(args.as_object()).unwrap();

        let filter = params.component_filter.unwrap();
        assert!(filter.component_type.is_none());
        assert!(filter.component_name.is_some());
    }

    #[test]
    fn test_parse_params_invalid_regex() {
        let args = json!({
            "infrastructure_type": "clickhouse",
            "component_filter": {
                "component_name": "[invalid(regex"
            }
        });

        let result = parse_params(args.as_object());
        assert!(matches!(result, Err(DiagnoseError::InvalidRegex { .. })));

        if let Err(DiagnoseError::InvalidRegex { pattern, .. }) = result {
            assert_eq!(pattern, "[invalid(regex");
        }
    }

    #[test]
    fn test_parse_params_invalid_infrastructure_type() {
        let args = json!({
            "infrastructure_type": "kafka"
        });

        let result = parse_params(args.as_object());
        assert!(matches!(
            result,
            Err(DiagnoseError::UnsupportedInfrastructureType(_))
        ));
    }

    #[test]
    fn test_parse_params_invalid_severity() {
        let args = json!({
            "infrastructure_type": "clickhouse",
            "severity": "critical"
        });

        let result = parse_params(args.as_object());
        assert!(matches!(result, Err(DiagnoseError::InvalidParameter(_))));
    }

    #[test]
    fn test_parse_params_missing_infrastructure_type() {
        let args = json!({
            "severity": "error"
        });

        let result = parse_params(args.as_object());
        assert!(matches!(result, Err(DiagnoseError::InvalidParameter(_))));
    }

    #[test]
    fn test_parse_params_no_arguments() {
        let result = parse_params(None);
        assert!(matches!(result, Err(DiagnoseError::InvalidParameter(_))));
    }

    #[test]
    fn test_parse_params_all_severity_variants() {
        for (severity_str, expected) in [
            ("error", Severity::Error),
            ("warning", Severity::Warning),
            ("info", Severity::Info),
            ("all", Severity::Info), // "all" maps to Info
        ] {
            let args = json!({
                "infrastructure_type": "clickhouse",
                "severity": severity_str
            });

            let params = parse_params(args.as_object()).unwrap();
            assert_eq!(
                params.severity, expected,
                "Failed for severity: {}",
                severity_str
            );
        }
    }

    #[test]
    fn test_parse_params_case_insensitive() {
        let args = json!({
            "infrastructure_type": "CLICKHOUSE",
            "severity": "ERROR"
        });

        let params = parse_params(args.as_object()).unwrap();
        assert!(matches!(
            params.infrastructure_type,
            InfrastructureType::ClickHouse
        ));
        assert!(matches!(params.severity, Severity::Error));
    }
}
