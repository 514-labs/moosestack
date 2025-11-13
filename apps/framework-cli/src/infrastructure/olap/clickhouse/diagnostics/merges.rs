//! Diagnostic provider for checking stuck background merges

use log::debug;
use serde_json::{json, Map, Value};

use super::{Component, DiagnosticError, DiagnosticProvider, Issue, Severity};
use crate::infrastructure::olap::clickhouse::client::ClickHouseClient;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

/// Query timeout for diagnostic checks (30 seconds)
const DIAGNOSTIC_QUERY_TIMEOUT_SECS: u64 = 30;

/// Diagnostic provider for checking stuck background merges
pub struct MergeDiagnostic;

impl MergeDiagnostic {
    /// Parse the ClickHouse JSON response and extract merge issues
    ///
    /// # Arguments
    /// * `json_response` - The raw JSON string from ClickHouse
    /// * `component` - The component being diagnosed
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

        let data = json_value
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                DiagnosticError::ParseError("Missing 'data' field in response".to_string())
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
                    elapsed,
                    progress * 100.0
                ),
                details,
                suggested_action: "Monitor merge progress. If stuck, check server resources (CPU, disk I/O, memory). Consider stopping merge with SYSTEM STOP MERGES if necessary.".to_string(),
                related_queries: vec![
                    format!(
                        "SELECT * FROM system.merges WHERE database = '{}' AND table = '{}'",
                        db_name, component.name
                    ),
                    format!("SYSTEM STOP MERGES {}.{}", db_name, component.name),
                ],
            });
        }

        Ok(issues)
    }
}

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
    ) -> Result<Vec<Issue>, DiagnosticError> {
        let client = ClickHouseClient::new(config)
            .map_err(|e| DiagnosticError::ConnectionFailed(format!("{}", e)))?;

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
        .map_err(|_| DiagnosticError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnosticError::QueryFailed(format!("{}", e)))?;

        Self::parse_response(&result, component, &config.db_name)
    }
}
