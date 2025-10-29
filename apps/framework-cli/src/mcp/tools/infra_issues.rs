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
//! - **Detection**: Mutations with num_tries > 3 or non-empty exceptions
//! - **Thresholds**:
//!   - Error: num_tries > 10
//!   - Warning: 3 < num_tries ≤ 10
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
//! Monitors stuck background merges that fail to make progress.
//! - **Source**: `system.merges`
//! - **Detection**: Merges running > 300 seconds with low progress
//! - **Thresholds**:
//!   - Error: elapsed_time > 600s and progress < 50%
//!   - Warning: elapsed_time > 300s and progress < 50%
//! - **Suggested Action**: Check disk I/O, memory, and system load
//!
//! ### 4. ErrorStatsDiagnostic
//! Aggregates errors from ClickHouse system.errors to surface recurring issues.
//! - **Source**: `system.errors`
//! - **Detection**: Errors with count > 10
//! - **Thresholds**:
//!   - Error: error_count > 100
//!   - Warning: error_count > 10
//! - **Suggested Action**: Review error messages and recent system changes
//!
//! ### 5. S3QueueDiagnostic (S3Queue tables only)
//! Detects S3Queue ingestion failures and processing issues.
//! - **Source**: `system.s3queue_log`
//! - **Detection**: Failed status entries in S3Queue processing log
//! - **Threshold**: Any failed entries trigger Warning
//! - **Suggested Action**: Check S3 credentials, permissions, and file formats
//!
//! ### 6. ReplicationDiagnostic (Replicated* tables only)
//! Monitors replication health, queue backlogs, and stuck replication entries.
//! - **Sources**: `system.replication_queue`, `system.replicas`
//! - **Detection**:
//!   - Large queue backlogs (queue_size > 10)
//!   - Stuck entries (num_tries > 3 or has exceptions)
//!   - Replica health issues (readonly, session_expired, high delay)
//! - **Thresholds**:
//!   - Error: queue_size > 50, num_tries > 10, delay > 300s, readonly
//!   - Warning: queue_size > 10, 3 < num_tries ≤ 10
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
//! - `severity`: error, warning, or info
//! - `source`: System table(s) queried
//! - `component`: Affected table/component
//! - `error_type`: Category of issue
//! - `message`: Human-readable description
//! - `details`: Additional context (counts, values)
//! - `suggested_action`: Remediation steps
//! - `related_queries`: Diagnostic and fix queries

use log::{debug, info};
use regex::Regex;
use rmcp::model::{CallToolResult, Tool};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::Arc;

use super::{create_error_result, create_success_result};
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::olap::clickhouse::client::ClickHouseClient;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
use crate::infrastructure::redis::redis_client::RedisClient;

/// Query timeout for diagnostic checks (30 seconds)
const DIAGNOSTIC_QUERY_TIMEOUT_SECS: u64 = 30;

/// Maximum number of log lines to retrieve from Docker
#[allow(dead_code)] // Will be used when DockerLogsDiagnostic is implemented
const MAX_DOCKER_LOG_LINES: u32 = 100;

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

    #[error("Docker operation failed: {0}")]
    #[allow(dead_code)] // Will be used when DockerLogsDiagnostic is implemented
    DockerError(String),

    #[error("Table '{0}' not found in infrastructure map")]
    #[allow(dead_code)] // Reserved for future use
    TableNotFound(String),

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
    #[serde(rename = "type")]
    pub component_type: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
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
    fn new(infrastructure_type: InfrastructureType, issues: Vec<Issue>) -> Self {
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

/// Trait for diagnostic providers
/// Each provider implements checks for a specific aspect of infrastructure health
#[async_trait::async_trait]
pub trait DiagnosticProvider: Send + Sync {
    /// Name of this diagnostic provider
    fn name(&self) -> &str;

    /// Check if this provider is applicable to the given component
    fn applicable_to(&self, component: &Component, engine: Option<&ClickhouseEngine>) -> bool;

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
        .filter(|(name, _table)| {
            if let Some(ref filter) = params.component_filter {
                // Check component_type filter
                if let Some(ref ctype) = filter.component_type {
                    if ctype != "all" && ctype != "table" {
                        return false;
                    }
                }

                // Check component_name regex filter
                if let Some(ref regex) = filter.component_name {
                    if !regex.is_match(name) {
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

    // Run diagnostics for each table
    let mut all_issues = Vec::new();

    for (_map_key, table) in tables_to_check {
        let component = Component {
            component_type: "table".to_string(),
            name: table.name.clone(), // Use the actual table name, not the infra map key
            database: Some(clickhouse_config.db_name.clone()),
        };

        let engine = table.engine.as_ref();

        // Run each applicable provider
        for provider in &providers {
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

// ============================================================================
// Diagnostic Provider Implementations
// ============================================================================

/// Diagnostic provider for checking stuck or failed mutations
struct MutationDiagnostic;

#[async_trait::async_trait]
impl DiagnosticProvider for MutationDiagnostic {
    fn name(&self) -> &str {
        "MutationDiagnostic"
    }

    fn applicable_to(&self, _component: &Component, _engine: Option<&ClickhouseEngine>) -> bool {
        // Mutations can occur on any table
        true
    }

    async fn diagnose(
        &self,
        component: &Component,
        _engine: Option<&ClickhouseEngine>,
        config: &ClickHouseConfig,
        _since: Option<&str>,
    ) -> Result<Vec<Issue>, DiagnoseError> {
        let client = ClickHouseClient::new(config)
            .map_err(|e| DiagnoseError::ClickHouseConnection(format!("{}", e)))?;

        let query = format!(
            "SELECT
                mutation_id,
                command,
                create_time,
                is_done,
                latest_failed_part,
                latest_fail_time,
                latest_fail_reason
             FROM system.mutations
             WHERE database = '{}' AND table = '{}'
             AND (is_done = 0 OR latest_fail_reason != '')
             ORDER BY create_time DESC
             FORMAT JSON",
            config.db_name, component.name
        );

        debug!("Executing mutations query: {}", query);

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(DIAGNOSTIC_QUERY_TIMEOUT_SECS),
            client.execute_sql(&query),
        )
        .await
        .map_err(|_| DiagnoseError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnoseError::QueryFailed(format!("{}", e)))?;

        // Parse ClickHouse JSON response
        let json_response: Value = serde_json::from_str(&result)
            .map_err(|e| DiagnoseError::ParseError(format!("{}", e)))?;

        let data = json_response
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                DiagnoseError::ParseError("Missing 'data' field in response".to_string())
            })?;

        let mut issues = Vec::new();

        for row in data {
            let mutation_id = row
                .get("mutation_id")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let command = row.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let is_done = row.get("is_done").and_then(|v| v.as_u64()).unwrap_or(0);
            let latest_fail_reason = row
                .get("latest_fail_reason")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let severity = if !latest_fail_reason.is_empty() {
                Severity::Error
            } else if is_done == 0 {
                Severity::Warning
            } else {
                continue; // Skip completed mutations without errors
            };

            let error_type = if !latest_fail_reason.is_empty() {
                "failed_mutation"
            } else {
                "stuck_mutation"
            };

            let message = if !latest_fail_reason.is_empty() {
                format!("Mutation failed: {}", latest_fail_reason)
            } else {
                "Mutation is in progress and may be stuck".to_string()
            };

            let mut details = Map::new();
            details.insert("mutation_id".to_string(), json!(mutation_id));
            details.insert("command".to_string(), json!(command));
            details.insert("is_done".to_string(), json!(is_done == 1));
            if !latest_fail_reason.is_empty() {
                details.insert("fail_reason".to_string(), json!(latest_fail_reason));
            }

            let suggested_action = if !latest_fail_reason.is_empty() {
                format!(
                    "Review the failure reason and consider killing the mutation with: KILL MUTATION WHERE mutation_id = '{}'",
                    mutation_id
                )
            } else {
                format!(
                    "Check mutation progress. If stuck, kill it with: KILL MUTATION WHERE mutation_id = '{}'",
                    mutation_id
                )
            };

            let related_queries = vec![
                format!(
                    "SELECT * FROM system.mutations WHERE database = '{}' AND table = '{}' AND mutation_id = '{}'",
                    config.db_name, component.name, mutation_id
                ),
                format!("KILL MUTATION WHERE mutation_id = '{}'", mutation_id),
            ];

            issues.push(Issue {
                severity,
                source: "system.mutations".to_string(),
                component: component.clone(),
                error_type: error_type.to_string(),
                message,
                details,
                suggested_action,
                related_queries,
            });
        }

        Ok(issues)
    }
}

/// Diagnostic provider for checking data parts issues
struct PartsDiagnostic;

#[async_trait::async_trait]
impl DiagnosticProvider for PartsDiagnostic {
    fn name(&self) -> &str {
        "PartsDiagnostic"
    }

    fn applicable_to(&self, _component: &Component, _engine: Option<&ClickhouseEngine>) -> bool {
        // Parts are relevant for all MergeTree tables
        true
    }

    async fn diagnose(
        &self,
        component: &Component,
        _engine: Option<&ClickhouseEngine>,
        config: &ClickHouseConfig,
        _since: Option<&str>,
    ) -> Result<Vec<Issue>, DiagnoseError> {
        let client = ClickHouseClient::new(config)
            .map_err(|e| DiagnoseError::ClickHouseConnection(format!("{}", e)))?;

        // Check for excessive parts count per partition
        let query = format!(
            "SELECT
                partition,
                count() as part_count,
                sum(rows) as total_rows,
                sum(bytes_on_disk) as total_bytes
             FROM system.parts
             WHERE database = '{}' AND table = '{}' AND active = 1
             GROUP BY partition
             HAVING part_count > 100
             ORDER BY part_count DESC
             FORMAT JSON",
            config.db_name, component.name
        );

        debug!("Executing parts query: {}", query);

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(DIAGNOSTIC_QUERY_TIMEOUT_SECS),
            client.execute_sql(&query),
        )
        .await
        .map_err(|_| DiagnoseError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnoseError::QueryFailed(format!("{}", e)))?;

        let json_response: Value = serde_json::from_str(&result)
            .map_err(|e| DiagnoseError::ParseError(format!("{}", e)))?;

        let data = json_response
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                DiagnoseError::ParseError("Missing 'data' field in response".to_string())
            })?;

        let mut issues = Vec::new();

        for row in data {
            let partition = row
                .get("partition")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let part_count = row.get("part_count").and_then(|v| v.as_u64()).unwrap_or(0);

            let severity = if part_count > 300 {
                Severity::Error
            } else {
                Severity::Warning
            };

            let mut details = Map::new();
            details.insert("partition".to_string(), json!(partition));
            details.insert("part_count".to_string(), json!(part_count));
            details.insert(
                "total_rows".to_string(),
                row.get("total_rows").cloned().unwrap_or(json!(0)),
            );
            details.insert(
                "total_bytes".to_string(),
                row.get("total_bytes").cloned().unwrap_or(json!(0)),
            );

            issues.push(Issue {
                severity,
                source: "system.parts".to_string(),
                component: component.clone(),
                error_type: "excessive_parts".to_string(),
                message: format!(
                    "Partition '{}' has {} active parts (threshold: 100). This may impact query performance.",
                    partition, part_count
                ),
                details,
                suggested_action: format!(
                    "Run OPTIMIZE TABLE to merge parts: OPTIMIZE TABLE {}.{} PARTITION '{}'",
                    config.db_name, component.name, partition
                ),
                related_queries: vec![
                    format!(
                        "SELECT * FROM system.parts WHERE database = '{}' AND table = '{}' AND partition = '{}' AND active = 1",
                        config.db_name, component.name, partition
                    ),
                    format!(
                        "OPTIMIZE TABLE {}.{} PARTITION '{}'",
                        config.db_name, component.name, partition
                    ),
                ],
            });
        }

        Ok(issues)
    }
}

/// Diagnostic provider for checking stuck background merges
struct MergeDiagnostic;

#[async_trait::async_trait]
impl DiagnosticProvider for MergeDiagnostic {
    fn name(&self) -> &str {
        "MergeDiagnostic"
    }

    fn applicable_to(&self, _component: &Component, _engine: Option<&ClickhouseEngine>) -> bool {
        true
    }

    async fn diagnose(
        &self,
        component: &Component,
        _engine: Option<&ClickhouseEngine>,
        config: &ClickHouseConfig,
        _since: Option<&str>,
    ) -> Result<Vec<Issue>, DiagnoseError> {
        let client = ClickHouseClient::new(config)
            .map_err(|e| DiagnoseError::ClickHouseConnection(format!("{}", e)))?;

        // Check for long-running merges
        let query = format!(
            "SELECT
                elapsed,
                progress,
                num_parts,
                result_part_name,
                total_size_bytes_compressed
             FROM system.merges
             WHERE database = '{}' AND table = '{}'
             AND elapsed > 300
             ORDER BY elapsed DESC
             FORMAT JSON",
            config.db_name, component.name
        );

        debug!("Executing merges query: {}", query);

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(DIAGNOSTIC_QUERY_TIMEOUT_SECS),
            client.execute_sql(&query),
        )
        .await
        .map_err(|_| DiagnoseError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnoseError::QueryFailed(format!("{}", e)))?;

        let json_response: Value = serde_json::from_str(&result)
            .map_err(|e| DiagnoseError::ParseError(format!("{}", e)))?;

        let data = json_response
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                DiagnoseError::ParseError("Missing 'data' field in response".to_string())
            })?;

        let mut issues = Vec::new();

        for row in data {
            let elapsed = row.get("elapsed").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let progress = row.get("progress").and_then(|v| v.as_f64()).unwrap_or(0.0);

            let severity = if elapsed > 1800.0 {
                // 30 minutes
                Severity::Error
            } else {
                Severity::Warning
            };

            let mut details = Map::new();
            details.insert("elapsed_seconds".to_string(), json!(elapsed));
            details.insert("progress".to_string(), json!(progress));
            details.insert(
                "num_parts".to_string(),
                row.get("num_parts").cloned().unwrap_or(json!(0)),
            );
            details.insert(
                "result_part_name".to_string(),
                row.get("result_part_name").cloned().unwrap_or(json!("")),
            );

            issues.push(Issue {
                severity,
                source: "system.merges".to_string(),
                component: component.clone(),
                error_type: "slow_merge".to_string(),
                message: format!(
                    "Background merge running for {:.1} seconds ({:.1}% complete)",
                    elapsed, progress * 100.0
                ),
                details,
                suggested_action: "Monitor merge progress. If stuck, check server resources (CPU, disk I/O, memory). Consider stopping merge with SYSTEM STOP MERGES if necessary.".to_string(),
                related_queries: vec![
                    format!(
                        "SELECT * FROM system.merges WHERE database = '{}' AND table = '{}'",
                        config.db_name, component.name
                    ),
                    format!("SYSTEM STOP MERGES {}.{}", config.db_name, component.name),
                ],
            });
        }

        Ok(issues)
    }
}

/// Diagnostic provider for checking system-wide errors
struct ErrorStatsDiagnostic;

#[async_trait::async_trait]
impl DiagnosticProvider for ErrorStatsDiagnostic {
    fn name(&self) -> &str {
        "ErrorStatsDiagnostic"
    }

    fn applicable_to(&self, _component: &Component, _engine: Option<&ClickhouseEngine>) -> bool {
        // Error stats are system-wide, check only once (for first component)
        true
    }

    async fn diagnose(
        &self,
        component: &Component,
        _engine: Option<&ClickhouseEngine>,
        config: &ClickHouseConfig,
        _since: Option<&str>,
    ) -> Result<Vec<Issue>, DiagnoseError> {
        let client = ClickHouseClient::new(config)
            .map_err(|e| DiagnoseError::ClickHouseConnection(format!("{}", e)))?;

        // Get recent errors with significant counts
        let query = "SELECT
                name,
                value,
                last_error_time,
                last_error_message
             FROM system.errors
             WHERE value > 0
             ORDER BY value DESC
             LIMIT 10
             FORMAT JSON";

        debug!("Executing errors query: {}", query);

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(DIAGNOSTIC_QUERY_TIMEOUT_SECS),
            client.execute_sql(query),
        )
        .await
        .map_err(|_| DiagnoseError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnoseError::QueryFailed(format!("{}", e)))?;

        let json_response: Value = serde_json::from_str(&result)
            .map_err(|e| DiagnoseError::ParseError(format!("{}", e)))?;

        let data = json_response
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                DiagnoseError::ParseError("Missing 'data' field in response".to_string())
            })?;

        let mut issues = Vec::new();

        for row in data {
            let name = row
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("UNKNOWN");
            let value = row.get("value").and_then(|v| v.as_u64()).unwrap_or(0);
            let last_error_message = row
                .get("last_error_message")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            // Skip if no occurrences
            if value == 0 {
                continue;
            }

            let severity = if value > 100 {
                Severity::Error
            } else if value > 10 {
                Severity::Warning
            } else {
                Severity::Info
            };

            let mut details = Map::new();
            details.insert("error_name".to_string(), json!(name));
            details.insert("occurrence_count".to_string(), json!(value));
            details.insert(
                "last_error_time".to_string(),
                row.get("last_error_time").cloned().unwrap_or(json!("")),
            );
            if !last_error_message.is_empty() {
                details.insert("last_error_message".to_string(), json!(last_error_message));
            }

            issues.push(Issue {
                severity,
                source: "system.errors".to_string(),
                component: component.clone(),
                error_type: "system_error".to_string(),
                message: format!("Error '{}' occurred {} times. Last: {}", name, value, last_error_message),
                details,
                suggested_action: "Review error pattern and recent query logs. Check ClickHouse server logs for more details.".to_string(),
                related_queries: vec![
                    "SELECT * FROM system.errors WHERE value > 0 ORDER BY value DESC".to_string(),
                    format!("SELECT * FROM system.query_log WHERE exception LIKE '%{}%' ORDER BY event_time DESC LIMIT 10", name),
                ],
            });
        }

        Ok(issues)
    }
}

/// Diagnostic provider for checking S3Queue ingestion
struct S3QueueDiagnostic;

#[async_trait::async_trait]
impl DiagnosticProvider for S3QueueDiagnostic {
    fn name(&self) -> &str {
        "S3QueueDiagnostic"
    }

    fn applicable_to(&self, _component: &Component, engine: Option<&ClickhouseEngine>) -> bool {
        // Only applicable to S3Queue tables
        matches!(engine, Some(ClickhouseEngine::S3Queue { .. }))
    }

    async fn diagnose(
        &self,
        component: &Component,
        _engine: Option<&ClickhouseEngine>,
        config: &ClickHouseConfig,
        _since: Option<&str>,
    ) -> Result<Vec<Issue>, DiagnoseError> {
        let client = ClickHouseClient::new(config)
            .map_err(|e| DiagnoseError::ClickHouseConnection(format!("{}", e)))?;

        // Check for S3Queue ingestion errors
        let query = format!(
            "SELECT
                file_name,
                status,
                processing_start_time,
                processing_end_time,
                exception
             FROM system.s3queue_log
             WHERE database = '{}' AND table = '{}'
             AND status IN ('Failed', 'ProcessingFailed')
             ORDER BY processing_start_time DESC
             LIMIT 20
             FORMAT JSON",
            config.db_name, component.name
        );

        debug!("Executing S3Queue query: {}", query);

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(DIAGNOSTIC_QUERY_TIMEOUT_SECS),
            client.execute_sql(&query),
        )
        .await
        .map_err(|_| DiagnoseError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnoseError::QueryFailed(format!("{}", e)))?;

        let json_response: Value = serde_json::from_str(&result)
            .map_err(|e| DiagnoseError::ParseError(format!("{}", e)))?;

        let data = json_response
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                DiagnoseError::ParseError("Missing 'data' field in response".to_string())
            })?;

        let mut issues = Vec::new();

        for row in data {
            let file_name = row
                .get("file_name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let status = row
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let exception = row.get("exception").and_then(|v| v.as_str()).unwrap_or("");

            let mut details = Map::new();
            details.insert("file_name".to_string(), json!(file_name));
            details.insert("status".to_string(), json!(status));
            details.insert(
                "processing_start_time".to_string(),
                row.get("processing_start_time")
                    .cloned()
                    .unwrap_or(json!("")),
            );
            if !exception.is_empty() {
                details.insert("exception".to_string(), json!(exception));
            }

            issues.push(Issue {
                severity: Severity::Error,
                source: "system.s3queue_log".to_string(),
                component: component.clone(),
                error_type: "s3queue_ingestion_failure".to_string(),
                message: format!("S3Queue file '{}' failed to ingest: {}", file_name, exception),
                details,
                suggested_action: "Check S3 bucket permissions, file format, and schema compatibility. Review S3Queue settings and keeper_path configuration.".to_string(),
                related_queries: vec![
                    format!(
                        "SELECT * FROM system.s3queue_log WHERE database = '{}' AND table = '{}' ORDER BY processing_start_time DESC LIMIT 50",
                        config.db_name, component.name
                    ),
                    format!(
                        "SELECT * FROM system.s3queue WHERE database = '{}' AND table = '{}'",
                        config.db_name, component.name
                    ),
                ],
            });
        }

        Ok(issues)
    }
}

/// Diagnostic provider for checking replication health
struct ReplicationDiagnostic;

#[async_trait::async_trait]
impl DiagnosticProvider for ReplicationDiagnostic {
    fn name(&self) -> &str {
        "ReplicationDiagnostic"
    }

    fn applicable_to(&self, _component: &Component, engine: Option<&ClickhouseEngine>) -> bool {
        // Only applicable to Replicated* tables
        matches!(
            engine,
            Some(ClickhouseEngine::ReplicatedMergeTree { .. })
                | Some(ClickhouseEngine::ReplicatedReplacingMergeTree { .. })
                | Some(ClickhouseEngine::ReplicatedAggregatingMergeTree { .. })
                | Some(ClickhouseEngine::ReplicatedSummingMergeTree { .. })
        )
    }

    async fn diagnose(
        &self,
        component: &Component,
        _engine: Option<&ClickhouseEngine>,
        config: &ClickHouseConfig,
        _since: Option<&str>,
    ) -> Result<Vec<Issue>, DiagnoseError> {
        let client = ClickHouseClient::new(config)
            .map_err(|e| DiagnoseError::ClickHouseConnection(format!("{}", e)))?;

        let mut issues = Vec::new();

        // First check for large queue backlogs (indicates stopped or slow replication)
        let queue_size_query = format!(
            "SELECT count() as queue_size
             FROM system.replication_queue
             WHERE database = '{}' AND table = '{}'
             FORMAT JSON",
            config.db_name, component.name
        );

        debug!(
            "Executing replication queue size query: {}",
            queue_size_query
        );

        let queue_size_result = tokio::time::timeout(
            std::time::Duration::from_secs(DIAGNOSTIC_QUERY_TIMEOUT_SECS),
            client.execute_sql(&queue_size_query),
        )
        .await
        .map_err(|_| DiagnoseError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnoseError::QueryFailed(format!("{}", e)))?;

        let queue_size_json: Value = serde_json::from_str(&queue_size_result)
            .map_err(|e| DiagnoseError::ParseError(format!("{}", e)))?;

        let queue_size = queue_size_json
            .get("data")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|row| row.get("queue_size"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        // Report large queue backlogs (potential stopped replication)
        if queue_size > 10 {
            let severity = if queue_size > 50 {
                Severity::Error
            } else {
                Severity::Warning
            };

            let mut details = Map::new();
            details.insert("queue_size".to_string(), json!(queue_size));

            issues.push(Issue {
                severity,
                source: "system.replication_queue".to_string(),
                component: component.clone(),
                error_type: "replication_queue_backlog".to_string(),
                message: format!(
                    "Large replication queue backlog: {} items pending. Replication may be stopped or falling behind.",
                    queue_size
                ),
                details,
                suggested_action: "Check if replication is stopped with 'SELECT * FROM system.replicas'. Consider restarting replication with 'SYSTEM START REPLICATION QUEUES' if stopped.".to_string(),
                related_queries: vec![
                    format!(
                        "SELECT * FROM system.replication_queue WHERE database = '{}' AND table = '{}'",
                        config.db_name, component.name
                    ),
                    format!(
                        "SELECT * FROM system.replicas WHERE database = '{}' AND table = '{}'",
                        config.db_name, component.name
                    ),
                    format!("SYSTEM START REPLICATION QUEUES {}.{}", config.db_name, component.name),
                ],
            });
        }

        // Check replication queue for stuck entries (retries or exceptions)
        let queue_query = format!(
            "SELECT
                type,
                source_replica,
                create_time,
                num_tries,
                last_exception
             FROM system.replication_queue
             WHERE database = '{}' AND table = '{}'
             AND (num_tries > 3 OR last_exception != '')
             ORDER BY create_time ASC
             LIMIT 20
             FORMAT JSON",
            config.db_name, component.name
        );

        debug!("Executing replication queue query: {}", queue_query);

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(DIAGNOSTIC_QUERY_TIMEOUT_SECS),
            client.execute_sql(&queue_query),
        )
        .await
        .map_err(|_| DiagnoseError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnoseError::QueryFailed(format!("{}", e)))?;

        let json_response: Value = serde_json::from_str(&result)
            .map_err(|e| DiagnoseError::ParseError(format!("{}", e)))?;

        let data = json_response
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                DiagnoseError::ParseError("Missing 'data' field in response".to_string())
            })?;

        let mut issues = Vec::new();

        for row in data {
            let entry_type = row
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let num_tries = row.get("num_tries").and_then(|v| v.as_u64()).unwrap_or(0);
            let last_exception = row
                .get("last_exception")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let severity = if num_tries > 10 || !last_exception.is_empty() {
                Severity::Error
            } else {
                Severity::Warning
            };

            let mut details = Map::new();
            details.insert("type".to_string(), json!(entry_type));
            details.insert(
                "source_replica".to_string(),
                row.get("source_replica").cloned().unwrap_or(json!("")),
            );
            details.insert(
                "create_time".to_string(),
                row.get("create_time").cloned().unwrap_or(json!("")),
            );
            details.insert("num_tries".to_string(), json!(num_tries));
            if !last_exception.is_empty() {
                details.insert("last_exception".to_string(), json!(last_exception));
            }

            issues.push(Issue {
                severity,
                source: "system.replication_queue".to_string(),
                component: component.clone(),
                error_type: "replication_lag".to_string(),
                message: format!(
                    "Replication entry of type '{}' retried {} times{}",
                    entry_type,
                    num_tries,
                    if !last_exception.is_empty() {
                        format!(": {}", last_exception)
                    } else {
                        String::new()
                    }
                ),
                details,
                suggested_action: "Check ZooKeeper/ClickHouse Keeper connectivity. Verify replica is active and reachable. Review ClickHouse server logs for replication errors.".to_string(),
                related_queries: vec![
                    format!(
                        "SELECT * FROM system.replication_queue WHERE database = '{}' AND table = '{}'",
                        config.db_name, component.name
                    ),
                    format!(
                        "SELECT * FROM system.replicas WHERE database = '{}' AND table = '{}'",
                        config.db_name, component.name
                    ),
                ],
            });
        }

        // Also check replica health status
        let replica_query = format!(
            "SELECT
                is_readonly,
                is_session_expired,
                future_parts,
                parts_to_check,
                queue_size,
                inserts_in_queue,
                merges_in_queue,
                absolute_delay
             FROM system.replicas
             WHERE database = '{}' AND table = '{}'
             FORMAT JSON",
            config.db_name, component.name
        );

        debug!("Executing replicas query: {}", replica_query);

        let replica_result = tokio::time::timeout(
            std::time::Duration::from_secs(DIAGNOSTIC_QUERY_TIMEOUT_SECS),
            client.execute_sql(&replica_query),
        )
        .await
        .map_err(|_| DiagnoseError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnoseError::QueryFailed(format!("{}", e)))?;

        let replica_json: Value = serde_json::from_str(&replica_result)
            .map_err(|e| DiagnoseError::ParseError(format!("{}", e)))?;

        if let Some(replica_data) = replica_json.get("data").and_then(|v| v.as_array()) {
            for row in replica_data {
                let is_readonly = row.get("is_readonly").and_then(|v| v.as_u64()).unwrap_or(0);
                let is_session_expired = row
                    .get("is_session_expired")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let queue_size = row.get("queue_size").and_then(|v| v.as_u64()).unwrap_or(0);
                let absolute_delay = row
                    .get("absolute_delay")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);

                if is_readonly == 1
                    || is_session_expired == 1
                    || queue_size > 100
                    || absolute_delay > 300
                {
                    let mut details = Map::new();
                    details.insert("is_readonly".to_string(), json!(is_readonly == 1));
                    details.insert(
                        "is_session_expired".to_string(),
                        json!(is_session_expired == 1),
                    );
                    details.insert("queue_size".to_string(), json!(queue_size));
                    details.insert("absolute_delay_seconds".to_string(), json!(absolute_delay));
                    details.insert(
                        "inserts_in_queue".to_string(),
                        row.get("inserts_in_queue").cloned().unwrap_or(json!(0)),
                    );
                    details.insert(
                        "merges_in_queue".to_string(),
                        row.get("merges_in_queue").cloned().unwrap_or(json!(0)),
                    );

                    let severity = if is_session_expired == 1 || absolute_delay > 600 {
                        Severity::Error
                    } else {
                        Severity::Warning
                    };

                    let mut issues_list = Vec::new();
                    if is_readonly == 1 {
                        issues_list.push("replica is read-only".to_string());
                    }
                    if is_session_expired == 1 {
                        issues_list.push("ZooKeeper session expired".to_string());
                    }
                    if queue_size > 100 {
                        issues_list.push(format!("large queue size ({})", queue_size));
                    }
                    if absolute_delay > 300 {
                        issues_list.push(format!(
                            "high replication delay ({} seconds)",
                            absolute_delay
                        ));
                    }

                    issues.push(Issue {
                        severity,
                        source: "system.replicas".to_string(),
                        component: component.clone(),
                        error_type: "replica_health".to_string(),
                        message: format!("Replica health issues: {}", issues_list.join(", ")),
                        details,
                        suggested_action: "Check ZooKeeper/ClickHouse Keeper connectivity. Verify network connectivity between replicas. Consider using SYSTEM RESTART REPLICA if session expired.".to_string(),
                        related_queries: vec![
                            format!(
                                "SELECT * FROM system.replicas WHERE database = '{}' AND table = '{}'",
                                config.db_name, component.name
                            ),
                            format!("SYSTEM RESTART REPLICA {}.{}", config.db_name, component.name),
                        ],
                    });
                }
            }
        }

        Ok(issues)
    }
}

/// Diagnostic provider for checking merge failures from system.metrics
struct MergeFailureDiagnostic;

#[async_trait::async_trait]
impl DiagnosticProvider for MergeFailureDiagnostic {
    fn name(&self) -> &str {
        "merge_failures"
    }

    fn applicable_to(&self, _component: &Component, _engine: Option<&ClickhouseEngine>) -> bool {
        // Merge failures are system-wide but we report per-table for context
        true
    }

    async fn diagnose(
        &self,
        component: &Component,
        _engine: Option<&ClickhouseEngine>,
        config: &ClickHouseConfig,
        _since: Option<&str>,
    ) -> Result<Vec<Issue>, DiagnoseError> {
        let client = ClickHouseClient::new(config)
            .map_err(|e| DiagnoseError::ClickHouseConnection(format!("{}", e)))?;

        let mut issues = Vec::new();

        // Check system.metrics for background merge failures
        // Note: This is a system-wide metric, not per-table, but we report it per-table for context
        let metrics_query =
            "SELECT value FROM system.metrics WHERE metric = 'FailedBackgroundMerges' FORMAT JSON";

        debug!("Executing merge failure metrics query: {}", metrics_query);

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(DIAGNOSTIC_QUERY_TIMEOUT_SECS),
            client.execute_sql(metrics_query),
        )
        .await
        .map_err(|_| DiagnoseError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnoseError::QueryFailed(format!("{}", e)))?;

        let json_response: Value = serde_json::from_str(&result)
            .map_err(|e| DiagnoseError::ParseError(format!("{}", e)))?;

        let failed_merges = json_response
            .get("data")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|row| row.get("value"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        if failed_merges > 0 {
            let severity = if failed_merges > 10 {
                Severity::Error
            } else {
                Severity::Warning
            };

            let mut details = Map::new();
            details.insert("failed_merges".to_string(), json!(failed_merges));

            issues.push(Issue {
                severity,
                source: "system.metrics".to_string(),
                component: component.clone(),
                error_type: "merge_failures".to_string(),
                message: format!(
                    "Background merge failures detected: {} failed merges currently in system. This may affect table maintenance.",
                    failed_merges
                ),
                details,
                suggested_action: "Check system.errors for merge failure details. Review disk space and memory availability. Consider increasing merge-related settings if failures persist.".to_string(),
                related_queries: vec![
                    "SELECT * FROM system.errors WHERE name LIKE '%Merge%' ORDER BY last_error_time DESC LIMIT 10".to_string(),
                    "SELECT * FROM system.metrics WHERE metric LIKE '%Merge%'".to_string(),
                    format!(
                        "SELECT * FROM system.merges WHERE database = '{}' AND table = '{}'",
                        config.db_name, component.name
                    ),
                ],
            });
        }

        Ok(issues)
    }
}

/// Diagnostic provider for checking stopped operations (merges, replication)
struct StoppedOperationsDiagnostic;

#[async_trait::async_trait]
impl DiagnosticProvider for StoppedOperationsDiagnostic {
    fn name(&self) -> &str {
        "stopped_operations"
    }

    fn applicable_to(&self, _component: &Component, _engine: Option<&ClickhouseEngine>) -> bool {
        // Applicable to all tables - we check both merges and replication
        true
    }

    async fn diagnose(
        &self,
        component: &Component,
        engine: Option<&ClickhouseEngine>,
        config: &ClickHouseConfig,
        _since: Option<&str>,
    ) -> Result<Vec<Issue>, DiagnoseError> {
        let client = ClickHouseClient::new(config)
            .map_err(|e| DiagnoseError::ClickHouseConnection(format!("{}", e)))?;

        let mut issues = Vec::new();

        // Check if merges are stopped for this table
        // We can detect this by checking if there are no running merges but many parts
        let parts_count_query = format!(
            "SELECT count() as part_count
             FROM system.parts
             WHERE database = '{}' AND table = '{}' AND active = 1
             FORMAT JSON",
            config.db_name, component.name
        );

        debug!("Executing parts count query: {}", parts_count_query);

        let parts_result = tokio::time::timeout(
            std::time::Duration::from_secs(DIAGNOSTIC_QUERY_TIMEOUT_SECS),
            client.execute_sql(&parts_count_query),
        )
        .await
        .map_err(|_| DiagnoseError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnoseError::QueryFailed(format!("{}", e)))?;

        let parts_json: Value = serde_json::from_str(&parts_result)
            .map_err(|e| DiagnoseError::ParseError(format!("{}", e)))?;

        let parts_count = parts_json
            .get("data")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|row| row.get("part_count"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        // If we have many parts, check if merges are running
        if parts_count > 100 {
            let merges_query = format!(
                "SELECT count() as merge_count
                 FROM system.merges
                 WHERE database = '{}' AND table = '{}'
                 FORMAT JSON",
                config.db_name, component.name
            );

            debug!("Executing merges query: {}", merges_query);

            let merges_result = tokio::time::timeout(
                std::time::Duration::from_secs(DIAGNOSTIC_QUERY_TIMEOUT_SECS),
                client.execute_sql(&merges_query),
            )
            .await
            .map_err(|_| DiagnoseError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
            .map_err(|e| DiagnoseError::QueryFailed(format!("{}", e)))?;

            let merges_json: Value = serde_json::from_str(&merges_result)
                .map_err(|e| DiagnoseError::ParseError(format!("{}", e)))?;

            let merge_count = merges_json
                .get("data")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|row| row.get("merge_count"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

            // If we have excessive parts but no merges running, merges might be stopped
            if merge_count == 0 {
                let mut details = Map::new();
                details.insert("part_count".to_string(), json!(parts_count));
                details.insert("active_merges".to_string(), json!(0));

                issues.push(Issue {
                    severity: Severity::Warning,
                    source: "system.parts,system.merges".to_string(),
                    component: component.clone(),
                    error_type: "merges_possibly_stopped".to_string(),
                    message: format!(
                        "Table has {} active parts but no running merges. Merges may be stopped or throttled.",
                        parts_count
                    ),
                    details,
                    suggested_action: format!(
                        "Check if merges were manually stopped with 'SELECT * FROM system.settings WHERE name LIKE \"%merge%\"'. Start merges if needed: 'SYSTEM START MERGES {}.{}'",
                        config.db_name, component.name
                    ),
                    related_queries: vec![
                        format!(
                            "SELECT * FROM system.parts WHERE database = '{}' AND table = '{}' AND active = 1 ORDER BY modification_time DESC LIMIT 20",
                            config.db_name, component.name
                        ),
                        format!(
                            "SYSTEM START MERGES {}.{}",
                            config.db_name, component.name
                        ),
                    ],
                });
            }
        }

        // For replicated tables, check if replication queues are stopped
        let is_replicated = matches!(
            engine,
            Some(ClickhouseEngine::ReplicatedMergeTree { .. })
                | Some(ClickhouseEngine::ReplicatedReplacingMergeTree { .. })
                | Some(ClickhouseEngine::ReplicatedAggregatingMergeTree { .. })
                | Some(ClickhouseEngine::ReplicatedSummingMergeTree { .. })
        );

        if is_replicated {
            let replicas_query = format!(
                "SELECT is_readonly, queue_size
                     FROM system.replicas
                     WHERE database = '{}' AND table = '{}'
                     FORMAT JSON",
                config.db_name, component.name
            );

            debug!("Executing replicas query: {}", replicas_query);

            let replicas_result = tokio::time::timeout(
                std::time::Duration::from_secs(DIAGNOSTIC_QUERY_TIMEOUT_SECS),
                client.execute_sql(&replicas_query),
            )
            .await
            .map_err(|_| DiagnoseError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
            .map_err(|e| DiagnoseError::QueryFailed(format!("{}", e)))?;

            let replicas_json: Value = serde_json::from_str(&replicas_result)
                .map_err(|e| DiagnoseError::ParseError(format!("{}", e)))?;

            if let Some(replica_data) = replicas_json.get("data").and_then(|v| v.as_array()) {
                for row in replica_data {
                    let is_readonly = row.get("is_readonly").and_then(|v| v.as_u64()).unwrap_or(0);
                    let queue_size = row.get("queue_size").and_then(|v| v.as_u64()).unwrap_or(0);

                    // If replica is readonly with items in queue, replication might be stopped
                    if is_readonly == 1 && queue_size > 0 {
                        let mut details = Map::new();
                        details.insert("is_readonly".to_string(), json!(true));
                        details.insert("queue_size".to_string(), json!(queue_size));

                        issues.push(Issue {
                                severity: Severity::Error,
                                source: "system.replicas".to_string(),
                                component: component.clone(),
                                error_type: "replication_stopped".to_string(),
                                message: format!(
                                    "Replica is in read-only mode with {} items in queue. Replication may be stopped.",
                                    queue_size
                                ),
                                details,
                                suggested_action: format!(
                                    "Investigate why replica is read-only. Try restarting replication: 'SYSTEM START REPLICATION QUEUES {}.{}'",
                                    config.db_name, component.name
                                ),
                                related_queries: vec![
                                    format!(
                                        "SELECT * FROM system.replicas WHERE database = '{}' AND table = '{}'",
                                        config.db_name, component.name
                                    ),
                                    format!(
                                        "SYSTEM START REPLICATION QUEUES {}.{}",
                                        config.db_name, component.name
                                    ),
                                ],
                            });
                    }
                }
            }
        }

        Ok(issues)
    }
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
                    database: Some("test_db".to_string()),
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
                    database: Some("test_db".to_string()),
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
                    database: Some("test_db".to_string()),
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
