//! Diagnostic provider for checking replication health

use log::debug;
use serde_json::{json, Map, Value};

use super::{Component, DiagnoseError, DiagnosticProvider, Issue, Severity};
use crate::infrastructure::olap::clickhouse::client::ClickHouseClient;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

/// Query timeout for diagnostic checks (30 seconds)
const DIAGNOSTIC_QUERY_TIMEOUT_SECS: u64 = 30;

/// Diagnostic provider for checking replication health
pub struct ReplicationDiagnostic;

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
