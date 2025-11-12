//! Diagnostic provider for checking system-wide errors

use log::debug;
use serde_json::{json, Map, Value};

use super::{Component, DiagnoseError, DiagnosticProvider, Issue, Severity};
use crate::infrastructure::olap::clickhouse::client::ClickHouseClient;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

/// Query timeout for diagnostic checks (30 seconds)
const DIAGNOSTIC_QUERY_TIMEOUT_SECS: u64 = 30;

/// Diagnostic provider for checking system-wide errors
pub struct ErrorStatsDiagnostic;

#[async_trait::async_trait]
impl DiagnosticProvider for ErrorStatsDiagnostic {
    fn name(&self) -> &str {
        "ErrorStatsDiagnostic"
    }

    fn applicable_to(&self, _component: &Component, _engine: Option<&ClickhouseEngine>) -> bool {
        // Error stats are system-wide, not component-specific
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
