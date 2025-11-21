//! Diagnostic provider for checking merge failures from system.metrics

use tracing::debug;
use serde_json::{json, Map, Value};

use super::{Component, DiagnosticError, DiagnosticProvider, Issue, Severity};
use crate::infrastructure::olap::clickhouse::client::ClickHouseClient;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

/// Query timeout for diagnostic checks (30 seconds)
const DIAGNOSTIC_QUERY_TIMEOUT_SECS: u64 = 30;

/// Diagnostic provider for checking merge failures from system.metrics
///
/// Use `MergeFailureDiagnostic::new()` or `Default::default()` to construct.
#[derive(Default)]
pub struct MergeFailureDiagnostic(());

impl MergeFailureDiagnostic {
    /// Create a new MergeFailureDiagnostic provider
    pub const fn new() -> Self {
        Self(())
    }

    /// Parse the ClickHouse JSON response and extract merge failure issues
    ///
    /// # Arguments
    /// * `json_response` - The raw JSON string from ClickHouse
    /// * `component` - The component being diagnosed (used for system-wide context)
    /// * `db_name` - Database name for generating related queries
    ///
    /// # Returns
    /// Vector of issues found in the response
    pub fn parse_response(
        json_response: &str,
        component: &Component,
        db_name: &str,
    ) -> Result<Vec<Issue>, DiagnosticError> {
        let json_value: Value = serde_json::from_str(json_response)
            .map_err(|e| DiagnosticError::ParseError(format!("{}", e)))?;

        let failed_merges = json_value
            .get("data")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|row| row.get("value"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let mut issues = Vec::new();

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
                        db_name, component.name
                    ),
                ],
            });
        }

        Ok(issues)
    }
}

#[async_trait::async_trait]
impl DiagnosticProvider for MergeFailureDiagnostic {
    fn name(&self) -> &str {
        "merge_failures"
    }

    fn applicable_to(&self, _component: &Component, _engine: Option<&ClickhouseEngine>) -> bool {
        // Merge failures from system.metrics are system-wide, not component-specific
        // This should be run separately outside the component loop
        false
    }

    fn is_system_wide(&self) -> bool {
        true
    }

    async fn diagnose(
        &self,
        component: &Component,
        _engine: Option<&ClickhouseEngine>,
        config: &ClickHouseConfig,
        _since: Option<&str>,
    ) -> Result<Vec<Issue>, DiagnosticError> {
        let client = ClickHouseClient::new(config)
            .map_err(|e| DiagnosticError::ConnectionFailed(format!("{}", e)))?;

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
        .map_err(|_| DiagnosticError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnosticError::QueryFailed(format!("{}", e)))?;

        Self::parse_response(&result, component, &config.db_name)
    }
}
