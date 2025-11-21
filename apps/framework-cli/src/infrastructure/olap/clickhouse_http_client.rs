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
use futures::Stream;
use serde_json::Value;
use std::pin::Pin;

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

/// Execute a SELECT query and return results as JSON stream
///
/// # Arguments
/// * `client` - Configured ClickHouse client
/// * `query` - SQL query string
///
/// # Returns
/// * Stream of JSON objects (one per row)
pub async fn query_as_json_stream(
    client: &ConfiguredDBClient,
    query: &str,
) -> Result<
    Pin<Box<dyn Stream<Item = Result<Value, clickhouse::error::Error>> + Send>>,
    clickhouse::error::Error,
> {
    // TODO: Implement in next task
    todo!()
}
