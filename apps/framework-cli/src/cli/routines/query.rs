//! Module for executing arbitrary SQL queries against ClickHouse.
//!
//! This module provides functionality to execute raw SQL queries and return
//! results as JSON for debugging and exploration purposes.

use crate::cli::display::Message;
use crate::cli::routines::{setup_redis_client, RoutineFailure, RoutineSuccess};
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::olap::clickhouse_http_client::create_query_client;
use crate::project::Project;

use tracing::info;
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
/// * `format_query` - Optional language name to format query as code literal instead of executing
/// * `prettify` - Whether to prettify SQL before formatting
///
/// # Returns
///
/// * `Result<RoutineSuccess, RoutineFailure>` - Success or failure of the operation
pub async fn query(
    project: Arc<Project>,
    sql: Option<String>,
    file: Option<PathBuf>,
    limit: u64,
    format_query: Option<String>,
    prettify: bool,
) -> Result<RoutineSuccess, RoutineFailure> {
    let sql_query = get_sql_input(sql, file)?;

    // Validate SQL syntax before any operation
    use crate::cli::routines::format_query::validate_sql;
    validate_sql(&sql_query)?;

    // If format_query flag is present, format and exit without executing
    if let Some(lang_str) = format_query {
        use crate::cli::routines::format_query::{format_as_code, CodeLanguage};

        let language = CodeLanguage::from_str(&lang_str)?;
        let formatted = format_as_code(&sql_query, language, prettify)?;

        println!("{}", formatted);

        return Ok(RoutineSuccess::success(Message::new(
            "Format Query".to_string(),
            format!(
                "Formatted as {} code{}",
                lang_str,
                if prettify { " (prettified)" } else { "" }
            ),
        )));
    }

    info!("Executing SQL: {}", sql_query);

    // Get HTTP-based ClickHouse client
    let client = create_query_client(&project.clickhouse_config);

    let redis_client = setup_redis_client(project.clone()).await.map_err(|e| {
        RoutineFailure::error(Message {
            action: "Query".to_string(),
            details: format!("Failed to setup redis client: {e:?}"),
        })
    })?;

    // Validate that infrastructure state exists and is accessible.
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
                "No infrastructure state found. Is 'moose dev' running?".to_string(),
            ))
        })?;

    // Execute query and get results
    let rows = crate::infrastructure::olap::clickhouse_http_client::query_as_json_stream(
        &client, &sql_query,
    )
    .await
    .map_err(|e| {
        RoutineFailure::error(Message::new(
            "Query".to_string(),
            format!("ClickHouse query error: {}", e),
        ))
    })?;

    // Stream results to stdout
    let success_count = rows.len().min(limit as usize);
    for (idx, row) in rows.iter().enumerate() {
        if idx >= limit as usize {
            info!("Reached limit of {} rows", limit);
            break;
        }

        let json = serde_json::to_string(row).map_err(|e| {
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
    }

    // Add newline for output cleanliness
    println!();

    Ok(RoutineSuccess::success(Message::new(
        "Query".to_string(),
        format!("{} rows", success_count),
    )))
}
