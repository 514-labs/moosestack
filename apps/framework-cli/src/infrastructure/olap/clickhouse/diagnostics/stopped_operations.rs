//! Diagnostic provider for checking stopped operations (merges, replication)

use serde_json::{json, Map, Value};
use tracing::debug;

use super::{Component, DiagnosticError, DiagnosticProvider, Issue, Severity};
use crate::infrastructure::olap::clickhouse::client::ClickHouseClient;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

/// Query timeout for diagnostic checks (30 seconds)
const DIAGNOSTIC_QUERY_TIMEOUT_SECS: u64 = 30;

/// Diagnostic provider for checking stopped operations (merges, replication)
///
/// Use `StoppedOperationsDiagnostic::new()` or `Default::default()` to construct.
#[derive(Default)]
pub struct StoppedOperationsDiagnostic(());

impl StoppedOperationsDiagnostic {
    /// Create a new StoppedOperationsDiagnostic provider
    pub const fn new() -> Self {
        Self(())
    }

    /// Parse parts count and merge count to detect stopped merges
    ///
    /// # Arguments
    /// * `parts_json_response` - JSON response from parts count query
    /// * `merges_json_response` - JSON response from merges count query
    /// * `component` - The component being diagnosed
    /// * `db_name` - Database name for generating related queries
    ///
    /// # Returns
    /// Vector of issues if merges appear to be stopped
    pub fn parse_stopped_merges_response(
        parts_json_response: &str,
        merges_json_response: &str,
        component: &Component,
        db_name: &str,
    ) -> Result<Vec<Issue>, DiagnosticError> {
        let parts_json: Value = serde_json::from_str(parts_json_response)
            .map_err(|e| DiagnosticError::ParseError(format!("{}", e)))?;

        let parts_count = parts_json
            .get("data")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|row| row.get("part_count"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let mut issues = Vec::new();

        // If we have many parts, check if merges are running
        if parts_count > 100 {
            let merges_json: Value = serde_json::from_str(merges_json_response)
                .map_err(|e| DiagnosticError::ParseError(format!("{}", e)))?;

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
                        db_name, component.name
                    ),
                    related_queries: vec![
                        format!(
                            "SELECT * FROM system.parts WHERE database = '{}' AND table = '{}' AND active = 1 ORDER BY modification_time DESC LIMIT 20",
                            db_name, component.name
                        ),
                        format!(
                            "SYSTEM START MERGES {}.{}",
                            db_name, component.name
                        ),
                    ],
                });
            }
        }

        Ok(issues)
    }

    /// Parse replica status to detect stopped replication
    ///
    /// # Arguments
    /// * `json_response` - JSON response from replicas query
    /// * `component` - The component being diagnosed
    /// * `db_name` - Database name for generating related queries
    ///
    /// # Returns
    /// Vector of issues if replication appears to be stopped
    pub fn parse_stopped_replication_response(
        json_response: &str,
        component: &Component,
        db_name: &str,
    ) -> Result<Vec<Issue>, DiagnosticError> {
        let replicas_json: Value = serde_json::from_str(json_response)
            .map_err(|e| DiagnosticError::ParseError(format!("{}", e)))?;

        let mut issues = Vec::new();

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
                            db_name, component.name
                        ),
                        related_queries: vec![
                            format!(
                                "SELECT * FROM system.replicas WHERE database = '{}' AND table = '{}'",
                                db_name, component.name
                            ),
                            format!(
                                "SYSTEM START REPLICATION QUEUES {}.{}",
                                db_name, component.name
                            ),
                        ],
                    });
                }
            }
        }

        Ok(issues)
    }
}

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
    ) -> Result<Vec<Issue>, DiagnosticError> {
        let client = ClickHouseClient::new(config)
            .map_err(|e| DiagnosticError::ConnectionFailed(format!("{}", e)))?;

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
        .map_err(|_| DiagnosticError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnosticError::QueryFailed(format!("{}", e)))?;

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
        .map_err(|_| DiagnosticError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
        .map_err(|e| DiagnosticError::QueryFailed(format!("{}", e)))?;

        issues.extend(Self::parse_stopped_merges_response(
            &parts_result,
            &merges_result,
            component,
            &config.db_name,
        )?);

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
            .map_err(|_| DiagnosticError::QueryTimeout(DIAGNOSTIC_QUERY_TIMEOUT_SECS))?
            .map_err(|e| DiagnosticError::QueryFailed(format!("{}", e)))?;

            issues.extend(Self::parse_stopped_replication_response(
                &replicas_result,
                component,
                &config.db_name,
            )?);
        }

        Ok(issues)
    }
}
