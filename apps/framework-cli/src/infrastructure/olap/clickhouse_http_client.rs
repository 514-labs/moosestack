//! HTTP-based ClickHouse client for query operations
//!
//! This module provides query functionality using the HTTP-based `clickhouse` crate.
//! Unlike the native protocol client (clickhouse-rs), this client:
//! - Supports all ClickHouse types including LowCardinality
//! - Uses JSON format for data serialization
//! - Is actively maintained
//! - Aligns with how consumption APIs access ClickHouse

use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::olap::clickhouse::{create_client, ConfiguredDBClient};
use tracing::debug;
use serde_json::Value;

/// Create a configured HTTP client for query operations
///
/// # Arguments
/// * `clickhouse_config` - ClickHouse configuration
///
/// # Returns
/// * `ConfiguredDBClient` - Configured client ready for queries
pub fn create_query_client(clickhouse_config: &ClickHouseConfig) -> ConfiguredDBClient {
    create_client(clickhouse_config.clone())
}

/// Execute a SELECT query and return results as JSON
///
/// # Arguments
/// * `client` - Configured ClickHouse client
/// * `query` - SQL query string
///
/// # Returns
/// * Vec of JSON objects (one per row)
///
/// # Implementation Note
/// Uses direct HTTP request to ClickHouse with JSONEachRow format since the
/// clickhouse crate doesn't natively support serde_json::Value deserialization.
pub async fn query_as_json_stream(
    client: &ConfiguredDBClient,
    query: &str,
) -> Result<Vec<Value>, Box<dyn std::error::Error + Send + Sync>> {
    debug!("Executing HTTP query: {}", query);

    let config = &client.config;
    let protocol = if config.use_ssl { "https" } else { "http" };
    let url = format!("{}://{}:{}", protocol, config.host, config.host_port);

    // Use reqwest to make a raw HTTP request with JSONEachRow format
    let http_client = reqwest::Client::new();
    let response = http_client
        .post(&url)
        .query(&[("database", &config.db_name)])
        .query(&[("default_format", "JSONEachRow")])
        .basic_auth(&config.user, Some(&config.password))
        .body(query.to_string())
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("ClickHouse query failed ({}): {}", status, error_text).into());
    }

    let text = response.text().await?;

    // Parse each line as a separate JSON object (JSONEachRow format)
    let mut results = Vec::new();
    for line in text.lines() {
        if !line.trim().is_empty() {
            let value: Value = serde_json::from_str(line)?;
            results.push(value);
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Requires running ClickHouse instance
    async fn test_query_as_json_stream() {
        let config = ClickHouseConfig {
            db_name: "default".to_string(),
            host: "localhost".to_string(),
            host_port: 8123,
            native_port: 9000,
            user: "default".to_string(),
            password: "".to_string(),
            use_ssl: false,
            host_data_path: None,
            additional_databases: vec![],
            clusters: None,
        };

        let client = create_query_client(&config);
        let rows = query_as_json_stream(&client, "SELECT 1 as num, 'test' as text")
            .await
            .expect("Query should succeed");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["num"], 1);
        assert_eq!(rows[0]["text"], "test");
    }
}
