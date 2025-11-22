//! Diagnostic provider for checking stuck or failed mutations

use tracing::debug;
use serde_json::{json, Map, Value};

use super::{Component, DiagnosticError, DiagnosticProvider, Issue, Severity};
use crate::infrastructure::olap::clickhouse::client::ClickHouseClient;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

/// Query timeout for diagnostic checks (30 seconds)
const DIAGNOSTIC_QUERY_TIMEOUT_SECS: u64 = 30;

/// Diagnostic provider for checking stuck or failed mutations
///
/// Use `MutationDiagnostic::new()` or `Default::default()` to construct.
#[derive(Default)]
pub struct MutationDiagnostic(());

impl MutationDiagnostic {
    /// Create a new MutationDiagnostic provider
    pub const fn new() -> Self {
        Self(())
    }

    /// Parse the ClickHouse JSON response and extract mutation issues
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
                    db_name, component.name, mutation_id
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
    ) -> Result<Vec<Issue>, DiagnosticError> {
        let client = ClickHouseClient::new(config)
            .map_err(|e| DiagnosticError::ConnectionFailed(format!("{}", e)))?;

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
        .map_err(|_| DiagnosticError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnosticError::QueryFailed(format!("{}", e)))?;

        Self::parse_response(&result, component, &config.db_name)
    }
}
