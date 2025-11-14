//! Module for executing arbitrary SQL queries against ClickHouse.
//!
//! This module provides functionality to execute raw SQL queries and return
//! results as JSON for debugging and exploration purposes.

use crate::cli::display::Message;
use crate::cli::routines::{setup_redis_client, RoutineFailure, RoutineSuccess};
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::olap::clickhouse_alt_client::{get_pool, row_to_json};
use crate::project::Project;

use futures::StreamExt;
use log::info;
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

    // Get ClickHouse connection pool
    // TODO: Apply max_result_rows setting to limit results without modifying user's SQL
    let pool = get_pool(&project.clickhouse_config);

    let mut client = pool.get_handle().await.map_err(|_| {
        RoutineFailure::error(Message::new(
            "Failed".to_string(),
            "Error connecting to storage".to_string(),
        ))
    })?;

    let redis_client = setup_redis_client(project.clone()).await.map_err(|e| {
        RoutineFailure::error(Message {
            action: "Query".to_string(),
            details: format!("Failed to setup redis client: {e:?}"),
        })
    })?;

    let _infra = InfrastructureMap::load_from_redis(&redis_client)
        .await
        .map_err(|_| {
            RoutineFailure::error(Message::new(
                "Failed".to_string(),
                "Error retrieving current state".to_string(),
            ))
        })?
        .ok_or_else(|| {
            RoutineFailure::error(Message::new(
                "Failed".to_string(),
                "No state found".to_string(),
            ))
        })?;

    // Execute query and stream results
    let mut stream = client.query(&sql_query).stream();

    let mut success_count = 0;
    let mut enum_mappings: Option<Vec<Option<Vec<&str>>>> = None;

    while let Some(row_result) = stream.next().await {
        match row_result {
            Ok(row) => {
                // Create enum mappings on first row (one None entry per column)
                if enum_mappings.is_none() {
                    enum_mappings = Some(vec![None; row.len()]);
                }

                // Reuse peek's row_to_json with enum mappings
                let value = row_to_json(&row, enum_mappings.as_ref().unwrap()).map_err(|e| {
                    RoutineFailure::new(
                        Message::new(
                            "Query".to_string(),
                            "Failed to convert row to JSON".to_string(),
                        ),
                        e,
                    )
                })?;

                let json = serde_json::to_string(&value).map_err(|e| {
                    RoutineFailure::new(
                        Message::new(
                            "Query".to_string(),
                            "Failed to serialize result".to_string(),
                        ),
                        e,
                    )
                })?;

                println!("{}", json);
                info!("{}", json);
                success_count += 1;

                // Check limit to avoid unbounded queries
                if success_count >= limit {
                    info!("Reached limit of {} rows", limit);
                    break;
                }
            }
            Err(e) => {
                return Err(RoutineFailure::new(
                    Message::new("Query".to_string(), "ClickHouse query error".to_string()),
                    e,
                ));
            }
        }
    }

    // Add newline for output cleanliness (like peek does)
    println!();

    Ok(RoutineSuccess::success(Message::new(
        "Query".to_string(),
        format!("{} rows", success_count),
    )))
}
