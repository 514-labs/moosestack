//! Diagnostic provider for checking S3Queue ingestion

use log::debug;
use serde_json::{json, Map, Value};

use super::{Component, DiagnoseError, DiagnosticProvider, Issue, Severity};
use crate::infrastructure::olap::clickhouse::client::ClickHouseClient;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

/// Query timeout for diagnostic checks (30 seconds)
const DIAGNOSTIC_QUERY_TIMEOUT_SECS: u64 = 30;

/// Diagnostic provider for checking S3Queue ingestion
pub struct S3QueueDiagnostic;

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
