//! Diagnostic provider for checking data parts issues

use log::debug;
use serde_json::{json, Map, Value};

use super::{Component, DiagnosticError, DiagnosticProvider, Issue, Severity};
use crate::infrastructure::olap::clickhouse::client::ClickHouseClient;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

/// Query timeout for diagnostic checks (30 seconds)
const DIAGNOSTIC_QUERY_TIMEOUT_SECS: u64 = 30;

/// Diagnostic provider for checking data parts issues
pub struct PartsDiagnostic;

impl PartsDiagnostic {
    /// Parse the ClickHouse JSON response and extract parts issues
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
                    db_name, component.name, partition
                ),
                related_queries: vec![
                    format!(
                        "SELECT * FROM system.parts WHERE database = '{}' AND table = '{}' AND partition = '{}' AND active = 1",
                        db_name, component.name, partition
                    ),
                    format!(
                        "OPTIMIZE TABLE {}.{} PARTITION '{}'",
                        db_name, component.name, partition
                    ),
                ],
            });
        }

        Ok(issues)
    }
}

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
    ) -> Result<Vec<Issue>, DiagnosticError> {
        let client = ClickHouseClient::new(config)
            .map_err(|e| DiagnosticError::ConnectionFailed(format!("{}", e)))?;

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
        .map_err(|_| DiagnosticError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnosticError::QueryFailed(format!("{}", e)))?;

        Self::parse_response(&result, component, &config.db_name)
    }
}
