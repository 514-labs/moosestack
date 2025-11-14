//! Module for executing arbitrary SQL queries against ClickHouse.
//!
//! This module provides functionality to execute raw SQL queries and return
//! results as JSON for debugging and exploration purposes.

use crate::cli::display::Message;
use crate::cli::routines::{setup_redis_client, RoutineFailure, RoutineSuccess};
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::olap::clickhouse_alt_client::get_pool;
use crate::project::Project;

use clickhouse_rs::types::Options;
use futures::StreamExt;
use log::info;
use serde_json::Value;
use std::io::Read;
use std::path::PathBuf;
use std::sync::Arc;

/// Reads SQL query from argument, file, or stdin.
///
/// # Arguments
///
/// * `sql` - Optional SQL query string from command line
/// * `file` - Optional file path containing SQL query
///
/// # Returns
///
/// * `Result<String, RoutineFailure>` - SQL query string or error
fn get_sql_input(sql: Option<String>, file: Option<PathBuf>) -> Result<String, RoutineFailure> {
    if let Some(query_str) = sql {
        // SQL provided as argument
        Ok(query_str)
    } else if let Some(file_path) = file {
        // Read SQL from file
        std::fs::read_to_string(&file_path).map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Query".to_string(),
                    format!("Failed to read file: {}", file_path.display()),
                ),
                e,
            )
        })
    } else {
        // Read SQL from stdin
        let mut buffer = String::new();
        std::io::stdin().read_to_string(&mut buffer).map_err(|e| {
            RoutineFailure::new(
                Message::new("Query".to_string(), "Failed to read from stdin".to_string()),
                e,
            )
        })?;

        if buffer.trim().is_empty() {
            return Err(RoutineFailure::error(Message::new(
                "Query".to_string(),
                "No SQL query provided (use argument, --file, or stdin)".to_string(),
            )));
        }

        Ok(buffer)
    }
}

/// Executes a SQL query against ClickHouse and displays results as JSON.
///
/// Allows users to run arbitrary SQL queries against the ClickHouse database
/// for exploration and debugging. Results are streamed as JSON to stdout.
///
/// # Arguments
///
/// * `project` - The project configuration to use
/// * `sql` - Optional SQL query string
/// * `file` - Optional file path containing SQL query
/// * `limit` - Maximum number of rows to return (via ClickHouse settings)
///
/// # Returns
///
/// * `Result<RoutineSuccess, RoutineFailure>` - Success or failure of the operation
pub async fn query(
    project: Arc<Project>,
    sql: Option<String>,
    file: Option<PathBuf>,
    limit: u64,
) -> Result<RoutineSuccess, RoutineFailure> {
    let sql_query = get_sql_input(sql, file)?;
    info!("Executing SQL: {}", sql_query);

    // More implementation in next task
    todo!()
}
