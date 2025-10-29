//! # Infrastructure Issues Diagnostic Tool
//!
//! This module implements a proactive infrastructure diagnostics MCP tool that intelligently
//! surfaces errors by using the infrastructure map to determine what to check based on
//! infrastructure type (ClickHouse, Kafka/Redpanda, Temporal, etc.).
//!
//! Initial implementation focuses on ClickHouse diagnostics with extensible architecture
//! for future infrastructure types.
//!
//! ## ClickHouse Diagnostic Providers
//!
//! The tool automatically runs multiple diagnostic providers based on table engine types:
//!
//! ### 1. MutationDiagnostic
//! Detects stuck or failing mutations (ALTER operations) that can block table maintenance.
//! - **Source**: `system.mutations`
//! - **Detection**: Mutations not done (is_done = 0) or with non-empty failure reasons
//! - **Thresholds**:
//!   - Error: Mutation has a failure reason (latest_fail_reason not empty)
//!   - Warning: Mutation in progress but not completed (is_done = 0)
//! - **Suggested Action**: Cancel stuck mutations with KILL MUTATION
//!
//! ### 2. PartsDiagnostic
//! Identifies excessive data parts per partition that impact query performance.
//! - **Source**: `system.parts`
//! - **Detection**: Active parts count per partition > 100
//! - **Thresholds**:
//!   - Error: part_count > 300
//!   - Warning: 100 < part_count ≤ 300
//! - **Suggested Action**: Run OPTIMIZE TABLE to merge parts
//!
//! ### 3. MergeDiagnostic
//! Monitors long-running background merges.
//! - **Source**: `system.merges`
//! - **Detection**: Merges running > 300 seconds
//! - **Thresholds**:
//!   - Error: elapsed_time > 1800s (30 minutes)
//!   - Warning: 300s < elapsed_time ≤ 1800s
//! - **Note**: Progress is tracked and reported but not used in severity determination
//! - **Suggested Action**: Monitor merge progress and check server resources (CPU, disk I/O, memory)
//!
//! ### 4. ErrorStatsDiagnostic
//! Aggregates errors from ClickHouse system.errors to surface recurring issues.
//! - **Source**: `system.errors`
//! - **Detection**: All errors with count > 0 (reports top 10 by occurrence)
//! - **Thresholds**:
//!   - Error: error_count > 100
//!   - Warning: error_count > 10
//!   - Info: 0 < error_count ≤ 10
//! - **Suggested Action**: Review error messages and recent system changes
//!
//! ### 5. S3QueueDiagnostic (S3Queue tables only)
//! Detects S3Queue ingestion failures and processing issues.
//! - **Source**: `system.s3queue_log`
//! - **Detection**: Failed or ProcessingFailed status entries in S3Queue log
//! - **Threshold**: All failed entries trigger Error severity
//! - **Suggested Action**: Check S3 credentials, permissions, and file formats
//!
//! ### 6. ReplicationDiagnostic (Replicated* tables only)
//! Monitors replication health, queue backlogs, and stuck replication entries.
//! - **Sources**: `system.replication_queue`, `system.replicas`
//! - **Detection**:
//!   - Large queue backlogs (queue_size > 10 or > 100 for replicas health)
//!   - Stuck entries (num_tries > 3 or has exceptions)
//!   - Replica health issues (readonly, session_expired, high delay > 300s)
//! - **Thresholds**:
//!   - Error: queue_size > 50, num_tries > 10, session_expired, delay > 600s
//!   - Warning: queue_size > 10, 3 < num_tries ≤ 10, readonly, 300s < delay ≤ 600s
//! - **Suggested Action**: Check ZooKeeper connectivity, restart replication queues
//!
//! ### 7. MergeFailureDiagnostic
//! Detects system-wide background merge failures that may affect multiple tables.
//! - **Source**: `system.metrics`
//! - **Detection**: FailedBackgroundMerges metric > 0
//! - **Thresholds**:
//!   - Error: failed_merges > 10
//!   - Warning: failed_merges > 0
//! - **Suggested Action**: Check system.errors for merge failure details, review disk space
//!
//! ### 8. StoppedOperationsDiagnostic
//! Identifies manually stopped or stalled merge/replication operations.
//! - **Sources**: `system.parts`, `system.merges`, `system.replicas`
//! - **Detection**:
//!   - Many parts (>100) but no active merges
//!   - Replica readonly with pending queue items
//! - **Thresholds**:
//!   - Error: Replica readonly with queue items (replication stopped)
//!   - Warning: Excessive parts with no merges (merges possibly stopped)
//! - **Suggested Action**: Run SYSTEM START MERGES or SYSTEM START REPLICATION QUEUES
//!
//! ## Query Timeout
//! All diagnostic queries have a 30-second timeout to prevent blocking on slow queries.
//!
//! ## Filtering Options
//! - **Component Filter**: Regex pattern to target specific tables/components
//! - **Severity Filter**: Filter by error, warning, or info (default: info shows all)
//! - **Time Filter**: Filter issues by time range (e.g., "-1h" for last hour)
//!
//! ## Output Format
//! Returns structured JSON with:
//! - \`severity\`: error, warning, or info
//! - \`source\`: System table(s) queried
//! - \`component\`: Affected table/component
//! - \`error_type\`: Category of issue
//! - \`message\`: Human-readable description
//! - \`details\`: Additional context (counts, values)
//! - \`suggested_action\`: Remediation steps
//! - \`related_queries\`: Diagnostic and fix queries

// Diagnostic provider modules
mod errors;
mod merge_failures;
mod merges;
mod mutations;
mod parts;
mod replication;
mod s3queue;
mod stopped_operations;

use log::{debug, info};
use regex::Regex;
use rmcp::model::{CallToolResult, Tool};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::Arc;

use super::{create_error_result, create_success_result};
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
use crate::infrastructure::redis::redis_client::RedisClient;

// Re-export diagnostic providers
pub use errors::ErrorStatsDiagnostic;
pub use merge_failures::MergeFailureDiagnostic;
pub use merges::MergeDiagnostic;
pub use mutations::MutationDiagnostic;
pub use parts::PartsDiagnostic;
pub use replication::ReplicationDiagnostic;
pub use s3queue::S3QueueDiagnostic;
pub use stopped_operations::StoppedOperationsDiagnostic;

/// Error types for infrastructure diagnostic operations
#[derive(Debug, thiserror::Error)]
pub enum DiagnoseError {
    #[error("Failed to load infrastructure map: {0}")]
    InfraMapLoad(#[from] anyhow::Error),

    #[error("Failed to connect to ClickHouse: {0}")]
    ClickHouseConnection(String),

    #[error("Failed to execute diagnostic query: {0}")]
    QueryFailed(String),

    #[error("Query timeout after {0} seconds")]
    QueryTimeout(u64),

    #[error("Failed to parse query result: {0}")]
    ParseError(String),

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

/// Infrastructure type enum
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InfrastructureType {
    ClickHouse,
    // Future support:
    // Kafka,
    // Temporal,
}

impl InfrastructureType {
    fn from_str(s: &str) -> Result<Self, DiagnoseError> {
        match s.to_lowercase().as_str() {
            "clickhouse" => Ok(InfrastructureType::ClickHouse),
            _ => Err(DiagnoseError::UnsupportedInfrastructureType(s.to_string())),
        }
    }
}

/// Component filter for targeting specific infrastructure components
#[derive(Debug, Clone)]
pub struct ComponentFilter {
    /// Type of component to filter (e.g., "table", "topic", "view", "all")
    pub component_type: Option<String>,
    /// Regex pattern to match component names
    pub component_name: Option<Regex>,
}

/// Severity level for issues
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
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

    /// Check if this severity should include issues of the given level
    fn includes(&self, other: &Severity) -> bool {
        match self {
            Severity::Info => true, // Info includes all severities
            Severity::Warning => matches!(other, Severity::Warning | Severity::Error),
            Severity::Error => matches!(other, Severity::Error),
        }
    }
}

/// Parameters for the diagnose_infrastructure tool
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

/// Component information for issue context
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Component {
    pub component_type: String,
    pub name: String,
    /// Flexible metadata for component-specific context (e.g., database, namespace, cluster)
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub metadata: HashMap<String, String>,
}

/// Detailed information about an infrastructure issue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    pub severity: Severity,
    pub source: String,
    pub component: Component,
    pub error_type: String,
    pub message: String,
    pub details: Map<String, Value>,
    pub suggested_action: String,
    pub related_queries: Vec<String>,
}

/// Summary statistics for diagnostic results
#[derive(Debug, Serialize, Deserialize)]
pub struct IssueSummary {
    pub total_issues: usize,
    pub by_severity: HashMap<String, usize>,
    pub by_component: HashMap<String, usize>,
}

/// Complete diagnostic output
#[derive(Debug, Serialize, Deserialize)]
pub struct DiagnosticOutput {
    pub infrastructure_type: InfrastructureType,
    pub issues: Vec<Issue>,
    pub summary: IssueSummary,
}

impl DiagnosticOutput {
    /// Create a new diagnostic output and compute summary statistics
    pub fn new(infrastructure_type: InfrastructureType, issues: Vec<Issue>) -> Self {
        let mut by_severity = HashMap::new();
        let mut by_component = HashMap::new();

        for issue in &issues {
            let severity_key = format!("{:?}", issue.severity).to_lowercase();
            *by_severity.entry(severity_key).or_insert(0) += 1;

            let component_key = issue.component.name.clone();
            *by_component.entry(component_key).or_insert(0) += 1;
        }

        let summary = IssueSummary {
            total_issues: issues.len(),
            by_severity,
            by_component,
        };

        Self {
            infrastructure_type,
            issues,
            summary,
        }
    }
}

/// Trait for ClickHouse diagnostic providers
/// Each provider implements checks for a specific aspect of ClickHouse infrastructure health
///
/// Note: Currently ClickHouse-specific. Will need refactoring to support other
/// infrastructure types (Kafka, Temporal, etc.) in the future.
#[async_trait::async_trait]
pub trait DiagnosticProvider: Send + Sync {
    /// Name of this diagnostic provider
    fn name(&self) -> &str;

    /// Check if this provider is applicable to the given component
    fn applicable_to(&self, component: &Component, engine: Option<&ClickhouseEngine>) -> bool;

    /// Check if this provider is system-wide (not component-specific)
    /// System-wide providers are run once, not per-component
    fn is_system_wide(&self) -> bool {
        false
    }

    /// Run diagnostics and return list of issues found
    async fn diagnose(
        &self,
        component: &Component,
        engine: Option<&ClickhouseEngine>,
        config: &ClickHouseConfig,
        since: Option<&str>,
    ) -> Result<Vec<Issue>, DiagnoseError>;
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
        name: "diagnose_infrastructure".into(),
        description: Some(
            "Proactively diagnose infrastructure issues by intelligently checking relevant diagnostic sources based on infrastructure type. For ClickHouse, automatically checks: stuck mutations, S3Queue ingestion errors (for S3Queue tables), replication health (for replicated tables), data parts issues, background merge problems, system errors, and Docker container logs. Returns structured, actionable information about errors and warnings with suggested remediation steps.".into()
        ),
        input_schema: Arc::new(schema.as_object().unwrap().clone()),
        annotations: None,
        icons: None,
        output_schema: None,
        title: Some("Diagnose Infrastructure Issues".into()),
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

/// Handle the tool call with the given arguments
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
            // Format as pretty JSON
            match serde_json::to_string_pretty(&output) {
                Ok(json_str) => create_success_result(json_str),
                Err(e) => create_error_result(format!("Failed to format output: {}", e)),
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

/// Diagnose ClickHouse infrastructure
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

    // Create diagnostic providers
    let providers = create_clickhouse_providers();

    // Separate component-specific and system-wide providers
    let component_providers: Vec<_> = providers.iter().filter(|p| !p.is_system_wide()).collect();
    let system_wide_providers: Vec<_> = providers.iter().filter(|p| p.is_system_wide()).collect();

    // Run diagnostics for each table
    let mut all_issues = Vec::new();

    for (_map_key, table) in tables_to_check {
        let mut metadata = HashMap::new();
        metadata.insert("database".to_string(), clickhouse_config.db_name.clone());

        let component = Component {
            component_type: "table".to_string(),
            name: table.name.clone(), // Use the actual table name, not the infra map key
            metadata,
        };

        let engine = table.engine.as_ref();

        // Run each applicable component-specific provider
        for provider in &component_providers {
            if provider.applicable_to(&component, engine) {
                debug!(
                    "Running {} diagnostic for table {}",
                    provider.name(),
                    table.name
                );

                match provider
                    .diagnose(
                        &component,
                        engine,
                        clickhouse_config,
                        params.since.as_deref(),
                    )
                    .await
                {
                    Ok(mut issues) => {
                        // Filter by severity
                        issues.retain(|issue| params.severity.includes(&issue.severity));
                        all_issues.extend(issues);
                    }
                    Err(e) => {
                        debug!(
                            "Provider {} failed for table {}: {}",
                            provider.name(),
                            table.name,
                            e
                        );
                        // Continue with other providers even if one fails
                    }
                }
            }
        }
    }

    // Run system-wide diagnostics once
    let mut system_metadata = HashMap::new();
    system_metadata.insert("database".to_string(), clickhouse_config.db_name.clone());

    let system_component = Component {
        component_type: "system".to_string(),
        name: "clickhouse".to_string(),
        metadata: system_metadata,
    };

    for provider in system_wide_providers {
        debug!("Running system-wide {} diagnostic", provider.name());

        match provider
            .diagnose(
                &system_component,
                None,
                clickhouse_config,
                params.since.as_deref(),
            )
            .await
        {
            Ok(mut issues) => {
                // Filter by severity
                issues.retain(|issue| params.severity.includes(&issue.severity));
                all_issues.extend(issues);
            }
            Err(e) => {
                debug!("System-wide provider {} failed: {}", provider.name(), e);
                // Continue with other providers even if one fails
            }
        }
    }

    // TODO: Add Docker logs diagnostic (not component-specific)

    info!(
        "Infrastructure diagnostics complete. Found {} issues.",
        all_issues.len()
    );

    Ok(DiagnosticOutput::new(
        InfrastructureType::ClickHouse,
        all_issues,
    ))
}

/// Create all ClickHouse diagnostic providers
fn create_clickhouse_providers() -> Vec<Box<dyn DiagnosticProvider>> {
    vec![
        Box::new(MutationDiagnostic),
        Box::new(PartsDiagnostic),
        Box::new(MergeDiagnostic),
        Box::new(ErrorStatsDiagnostic),
        Box::new(S3QueueDiagnostic),
        Box::new(ReplicationDiagnostic),
        Box::new(MergeFailureDiagnostic),
        Box::new(StoppedOperationsDiagnostic),
    ]
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
        let error = Severity::Error;
        let warning = Severity::Warning;
        let info = Severity::Info;

        // Error only includes error
        assert!(error.includes(&Severity::Error));
        assert!(!error.includes(&Severity::Warning));
        assert!(!error.includes(&Severity::Info));

        // Warning includes warning and error
        assert!(warning.includes(&Severity::Error));
        assert!(warning.includes(&Severity::Warning));
        assert!(!warning.includes(&Severity::Info));

        // Info includes everything
        assert!(info.includes(&Severity::Error));
        assert!(info.includes(&Severity::Warning));
        assert!(info.includes(&Severity::Info));
    }

    #[test]
    fn test_parse_params_minimal() {
        let args = json!({
            "infrastructure_type": "clickhouse"
        });
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());
        let params = result.unwrap();
        assert_eq!(params.infrastructure_type, InfrastructureType::ClickHouse);
        assert!(params.component_filter.is_none());
        assert_eq!(params.severity, Severity::Info);
        assert!(params.since.is_none());
    }

    #[test]
    fn test_parse_params_with_filter() {
        let args = json!({
            "infrastructure_type": "clickhouse",
            "component_filter": {
                "component_type": "table",
                "component_name": "user_.*"
            },
            "severity": "error",
            "since": "-1h"
        });
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());
        let params = result.unwrap();
        assert!(params.component_filter.is_some());
        let filter = params.component_filter.unwrap();
        assert_eq!(filter.component_type, Some("table".to_string()));
        assert!(filter.component_name.is_some());
        assert_eq!(params.severity, Severity::Error);
        assert_eq!(params.since, Some("-1h".to_string()));
    }

    #[test]
    fn test_parse_params_invalid() {
        // Missing required parameter
        let args = json!({});
        let map = args.as_object().unwrap();
        assert!(parse_params(Some(map)).is_err());

        // Invalid infrastructure type
        let args = json!({"infrastructure_type": "invalid"});
        let map = args.as_object().unwrap();
        assert!(parse_params(Some(map)).is_err());

        // Invalid severity
        let args = json!({
            "infrastructure_type": "clickhouse",
            "severity": "invalid"
        });
        let map = args.as_object().unwrap();
        assert!(parse_params(Some(map)).is_err());

        // Invalid regex pattern
        let args = json!({
            "infrastructure_type": "clickhouse",
            "component_filter": {
                "component_name": "[invalid"
            }
        });
        let map = args.as_object().unwrap();
        assert!(parse_params(Some(map)).is_err());
    }

    #[test]
    fn test_diagnostic_output_summary() {
        let issues = vec![
            Issue {
                severity: Severity::Error,
                source: "system.mutations".to_string(),
                component: Component {
                    component_type: "table".to_string(),
                    name: "users".to_string(),
                    metadata: {
                        let mut m = HashMap::new();
                        m.insert("database".to_string(), "test_db".to_string());
                        m
                    },
                },
                error_type: "stuck_mutation".to_string(),
                message: "Mutation stuck".to_string(),
                details: Map::new(),
                suggested_action: "Kill mutation".to_string(),
                related_queries: vec![],
            },
            Issue {
                severity: Severity::Warning,
                source: "system.parts".to_string(),
                component: Component {
                    component_type: "table".to_string(),
                    name: "users".to_string(),
                    metadata: {
                        let mut m = HashMap::new();
                        m.insert("database".to_string(), "test_db".to_string());
                        m
                    },
                },
                error_type: "excessive_parts".to_string(),
                message: "Too many parts".to_string(),
                details: Map::new(),
                suggested_action: "Optimize table".to_string(),
                related_queries: vec![],
            },
            Issue {
                severity: Severity::Error,
                source: "system.mutations".to_string(),
                component: Component {
                    component_type: "table".to_string(),
                    name: "orders".to_string(),
                    metadata: {
                        let mut m = HashMap::new();
                        m.insert("database".to_string(), "test_db".to_string());
                        m
                    },
                },
                error_type: "failed_mutation".to_string(),
                message: "Mutation failed".to_string(),
                details: Map::new(),
                suggested_action: "Check logs".to_string(),
                related_queries: vec![],
            },
        ];

        let output = DiagnosticOutput::new(InfrastructureType::ClickHouse, issues);

        assert_eq!(output.summary.total_issues, 3);
        assert_eq!(output.summary.by_severity.get("error"), Some(&2));
        assert_eq!(output.summary.by_severity.get("warning"), Some(&1));
        assert_eq!(output.summary.by_component.get("users"), Some(&2));
        assert_eq!(output.summary.by_component.get("orders"), Some(&1));
    }
}
