//! # Query OLAP Tool
//!
//! This module implements the MCP tool for executing read-only SQL queries
//! against the ClickHouse OLAP database for data exploration and debugging.

use tracing::{debug, info};
use rmcp::model::{Annotated, CallToolResult, RawContent, RawTextContent, Tool};
use serde_json::{json, Map, Value};
use sqlparser::ast::Statement;
use sqlparser::dialect::ClickHouseDialect;
use sqlparser::parser::Parser;
use std::sync::Arc;

use crate::infrastructure::olap::clickhouse::client::ClickHouseClient;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;

// Constants for validation and limits
const DEFAULT_LIMIT: u32 = 100;
const MAX_LIMIT: u32 = 1000;
const MIN_LIMIT: u32 = 1;

/// Error types for query operations
#[derive(Debug, thiserror::Error)]
pub enum QueryError {
    #[error("Failed to parse SQL: {0}")]
    ParseError(#[from] sqlparser::parser::ParserError),

    #[error("Empty query provided")]
    EmptyQuery,

    #[error("Multiple statements not allowed. Only one statement can be executed at a time.")]
    MultipleStatements,

    #[error("Write operation not allowed: {0}. Only read operations (SELECT, SHOW, DESCRIBE, EXPLAIN) are permitted.")]
    WriteOperation(&'static str),

    #[error("DDL operation not allowed: {0}. Only read operations (SELECT, SHOW, DESCRIBE, EXPLAIN) are permitted.")]
    DdlOperation(&'static str),

    #[error(
        "Unsupported statement type. Only SELECT, SHOW, DESCRIBE, and EXPLAIN queries are allowed."
    )]
    UnsupportedStatement,

    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),

    #[error("Failed to execute query: {0}")]
    ExecutionError(String),

    #[error("Failed to format results: {0}")]
    FormattingError(String),
}

/// Parameters for the query_olap tool
#[derive(Debug)]
struct QueryOlapParams {
    /// SQL query to execute
    query: String,
    /// Maximum number of rows to return
    limit: u32,
    /// Output format (json or table)
    format: String,
}

/// Analysis result for a SQL query
#[derive(Debug)]
struct QueryAnalysis {
    /// Whether this query type supports LIMIT clause
    supports_limit: bool,
    /// Whether the query already has a LIMIT clause
    has_limit: bool,
}

/// Validates that a SQL query is read-only and analyzes its LIMIT characteristics.
/// This function parses the SQL once and returns analysis information.
///
/// # Returns
/// * `Ok(QueryAnalysis)` - Query is valid and read-only with LIMIT analysis
/// * `Err(QueryError)` - Query validation failed
fn validate_and_analyze_query(sql: &str) -> Result<QueryAnalysis, QueryError> {
    let dialect = ClickHouseDialect {};
    let ast = Parser::parse_sql(&dialect, sql)?;

    // Ensure we have exactly one statement
    if ast.is_empty() {
        return Err(QueryError::EmptyQuery);
    }

    if ast.len() > 1 {
        return Err(QueryError::MultipleStatements);
    }

    // Check if the statement is read-only and determine if it supports LIMIT
    match &ast[0] {
        // Query statements (SELECT, WITH, etc.) - check if LIMIT already exists
        Statement::Query(query) => {
            let has_limit = query.limit_clause.is_some();
            Ok(QueryAnalysis {
                supports_limit: true,
                has_limit,
            })
        }

        // SHOW statements that support LIMIT
        Statement::ShowTables { .. } => Ok(QueryAnalysis {
            supports_limit: true,
            has_limit: false,
        }),
        Statement::ShowDatabases { .. } => Ok(QueryAnalysis {
            supports_limit: true,
            has_limit: false,
        }),
        Statement::ShowColumns { .. } => Ok(QueryAnalysis {
            supports_limit: true,
            has_limit: false,
        }),
        Statement::ShowFunctions { .. } => Ok(QueryAnalysis {
            supports_limit: true,
            has_limit: false,
        }),

        // These do NOT support LIMIT (only FORMAT)
        Statement::ExplainTable { .. } => Ok(QueryAnalysis {
            supports_limit: false,
            has_limit: false,
        }), // DESCRIBE
        Statement::ShowCreate { .. } => Ok(QueryAnalysis {
            supports_limit: false,
            has_limit: false,
        }), // SHOW CREATE TABLE
        Statement::Explain { .. } => Ok(QueryAnalysis {
            supports_limit: false,
            has_limit: false,
        }), // EXPLAIN
        Statement::ShowVariables { .. } => Ok(QueryAnalysis {
            supports_limit: false,
            has_limit: false,
        }),

        // Block all write operations
        Statement::Insert { .. } => Err(QueryError::WriteOperation("INSERT")),
        Statement::Update { .. } => Err(QueryError::WriteOperation("UPDATE")),
        Statement::Delete { .. } => Err(QueryError::WriteOperation("DELETE")),
        Statement::Copy { .. } => Err(QueryError::WriteOperation("COPY")),
        Statement::CopyIntoSnowflake { .. } => Err(QueryError::WriteOperation("COPY INTO")),

        // Block all DDL operations
        Statement::CreateTable { .. } => Err(QueryError::DdlOperation("CREATE TABLE")),
        Statement::CreateView { .. } => Err(QueryError::DdlOperation("CREATE VIEW")),
        Statement::CreateIndex { .. } => Err(QueryError::DdlOperation("CREATE INDEX")),
        Statement::AlterTable { .. } => Err(QueryError::DdlOperation("ALTER TABLE")),
        Statement::AlterIndex { .. } => Err(QueryError::DdlOperation("ALTER INDEX")),
        Statement::Drop { .. } => Err(QueryError::DdlOperation("DROP")),
        Statement::Truncate { .. } => Err(QueryError::DdlOperation("TRUNCATE")),

        // Reject anything else as unsupported
        _ => Err(QueryError::UnsupportedStatement),
    }
}

/// Applies a LIMIT clause to the query if the query type supports it
///
/// # Parameters
/// * `query` - The SQL query to modify
/// * `max_rows` - Maximum number of rows to return
/// * `analysis` - Query analysis information from validate_and_analyze_query
fn apply_limit_to_query(query: &str, max_rows: u32, analysis: &QueryAnalysis) -> String {
    let trimmed = query.trim();

    // Don't add LIMIT for queries that don't support it
    if !analysis.supports_limit {
        return trimmed.to_string();
    }

    // Check if query already has a LIMIT clause (from AST analysis, not string matching)
    if analysis.has_limit {
        // Query already has LIMIT, wrap it with a subquery to enforce max
        format!("SELECT * FROM ({}) LIMIT {}", trimmed, max_rows)
    } else {
        // No LIMIT, append one
        format!("{} LIMIT {}", trimmed, max_rows)
    }
}

/// Formats the query result as JSON
fn format_as_json(result: &str) -> Result<String, QueryError> {
    // Try to parse as JSON and pretty-print
    match serde_json::from_str::<Value>(result) {
        Ok(json_value) => serde_json::to_string_pretty(&json_value)
            .map_err(|e| QueryError::FormattingError(format!("Failed to format JSON: {}", e))),
        Err(_) => {
            // If not JSON, return as-is (e.g., for SHOW commands)
            Ok(result.to_string())
        }
    }
}

/// Formats the query result as a markdown table
fn format_as_table(result: &str) -> Result<String, QueryError> {
    // Try to parse as JSON array
    let json_value: Value = serde_json::from_str(result)
        .map_err(|_| QueryError::FormattingError("Unable to parse result as JSON".to_string()))?;

    let rows = json_value
        .as_array()
        .ok_or_else(|| QueryError::FormattingError("Result is not a JSON array".to_string()))?;

    if rows.is_empty() {
        return Ok("No rows returned.".to_string());
    }

    // Extract column names from the first row
    let first_row = rows[0]
        .as_object()
        .ok_or_else(|| QueryError::FormattingError("First row is not a JSON object".to_string()))?;

    let columns: Vec<&String> = first_row.keys().collect();

    // Build markdown table
    let mut table = String::new();

    // Header row
    table.push_str("| ");
    let column_names: Vec<&str> = columns.iter().map(|s| s.as_str()).collect();
    table.push_str(&column_names.join(" | "));
    table.push_str(" |\n");

    // Separator row
    table.push('|');
    for _ in &columns {
        table.push_str(" --- |");
    }
    table.push('\n');

    // Data rows
    for row in rows {
        let row_obj = row
            .as_object()
            .ok_or_else(|| QueryError::FormattingError("Row is not a JSON object".to_string()))?;

        table.push_str("| ");
        let values: Vec<String> = columns
            .iter()
            .map(|col| {
                row_obj
                    .get(*col)
                    .map(|v| match v {
                        Value::String(s) => s.clone(),
                        Value::Null => "NULL".to_string(),
                        _ => v.to_string(),
                    })
                    .unwrap_or_else(|| "".to_string())
            })
            .collect();
        table.push_str(&values.join(" | "));
        table.push_str(" |\n");
    }

    Ok(table)
}

/// Returns the tool definition for the MCP server
pub fn tool_definition() -> Tool {
    let schema = json!({
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "SQL query to execute. Only read operations are allowed (SELECT, SHOW, DESCRIBE, EXPLAIN). Example: 'SELECT * FROM system.tables LIMIT 10'"
            },
            "limit": {
                "type": "number",
                "description": format!("Maximum number of rows to return (default: {}, max: {})", DEFAULT_LIMIT, MAX_LIMIT),
                "minimum": MIN_LIMIT,
                "maximum": MAX_LIMIT,
                "default": DEFAULT_LIMIT
            },
            "format": {
                "type": "string",
                "description": "Output format for results",
                "enum": ["json", "table"],
                "default": "json"
            }
        },
        "required": ["query"]
    });

    Tool {
        name: "query_olap".into(),
        description: Some(
            "Execute read-only SQL queries against the ClickHouse OLAP database. Queries automatically use the configured database as the default context, so you can query tables without fully-qualifying them. Use this tool to explore data, check table schemas, and analyze stored information. Supports SELECT queries, system table queries (e.g., system.tables, system.columns), and metadata commands (SHOW, DESCRIBE, EXPLAIN).".into()
        ),
        input_schema: Arc::new(schema.as_object().unwrap().clone()),
        annotations: None,
        icons: None,
        output_schema: None,
        title: Some("Query OLAP Database".into()),
    }
}

/// Parse and validate parameters from MCP arguments
fn parse_params(arguments: Option<&Map<String, Value>>) -> Result<QueryOlapParams, QueryError> {
    let args = arguments
        .ok_or_else(|| QueryError::InvalidParameter("No arguments provided".to_string()))?;

    // Extract and validate query
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or_else(|| QueryError::InvalidParameter("query parameter is required".to_string()))?
        .to_string();

    if query.trim().is_empty() {
        return Err(QueryError::InvalidParameter(
            "query cannot be empty".to_string(),
        ));
    }

    // Extract and validate limit
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .unwrap_or(DEFAULT_LIMIT);

    if !(MIN_LIMIT..=MAX_LIMIT).contains(&limit) {
        return Err(QueryError::InvalidParameter(format!(
            "limit must be between {} and {}, got {}",
            MIN_LIMIT, MAX_LIMIT, limit
        )));
    }

    // Extract and validate format
    let format = args
        .get("format")
        .and_then(|v| v.as_str())
        .unwrap_or("json")
        .to_string();

    if format != "json" && format != "table" {
        return Err(QueryError::InvalidParameter(format!(
            "format must be 'json' or 'table', got '{}'",
            format
        )));
    }

    Ok(QueryOlapParams {
        query,
        limit,
        format,
    })
}

/// Execute the query against ClickHouse
async fn execute_query(
    config: &ClickHouseConfig,
    query: &str,
    limit: u32,
    analysis: &QueryAnalysis,
) -> Result<String, QueryError> {
    // Create ClickHouse client
    let client = ClickHouseClient::new(config)
        .map_err(|e| QueryError::ExecutionError(format!("Failed to create client: {}", e)))?;

    // Apply limit to query (if query type supports it)
    let limited_query = apply_limit_to_query(query, limit, analysis);

    debug!(
        "Executing query with limit {} in database '{}': {}",
        limit, config.db_name, limited_query
    );

    // Add FORMAT JSON to get structured output
    let query_with_format = format!("{} FORMAT JSON", limited_query);

    // Execute the query with timeout, using the configured database as the default context
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        client.execute_sql_with_database(&query_with_format, Some(&config.db_name)),
    )
    .await
    .map_err(|_| QueryError::ExecutionError("Query timeout after 30 seconds".to_string()))?
    .map_err(|e| QueryError::ExecutionError(format!("Query failed: {}", e)))?;

    Ok(result)
}

/// Main execution function for the query_olap tool
async fn execute_query_olap(
    config: &ClickHouseConfig,
    params: QueryOlapParams,
) -> Result<String, QueryError> {
    info!(
        "Executing OLAP query with limit {} and format {}",
        params.limit, params.format
    );
    debug!("Query: {}", params.query);

    // Validate query is read-only and analyze LIMIT characteristics (single parse)
    let analysis = validate_and_analyze_query(&params.query)?;

    // Execute query
    let raw_result = execute_query(config, &params.query, params.limit, &analysis).await?;

    // Parse the ClickHouse JSON format response
    // ClickHouse returns JSON in format: {"meta": [...], "data": [...], "rows": n, ...}
    let json_response: Value = serde_json::from_str(&raw_result).map_err(|e| {
        QueryError::FormattingError(format!("Failed to parse ClickHouse response: {}", e))
    })?;

    // Extract the data array
    let data = json_response.get("data").ok_or_else(|| {
        QueryError::FormattingError("Missing 'data' field in response".to_string())
    })?;

    let data_str = serde_json::to_string(data)
        .map_err(|e| QueryError::FormattingError(format!("Failed to serialize data: {}", e)))?;

    // Format based on requested format
    let formatted_result = match params.format.as_str() {
        "json" => format_as_json(&data_str)?,
        "table" => format_as_table(&data_str)?,
        _ => data_str, // Should not happen due to validation
    };

    // Add metadata
    let rows_count = json_response
        .get("rows")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let mut output = String::new();
    output.push_str(&format!(
        "Query executed successfully. Rows returned: {}\n\n",
        rows_count
    ));
    output.push_str(&formatted_result);

    Ok(output)
}

/// Handle the tool call with the given arguments
pub async fn handle_call(
    config: &ClickHouseConfig,
    arguments: Option<&Map<String, Value>>,
) -> CallToolResult {
    let params = match parse_params(arguments) {
        Ok(p) => p,
        Err(e) => {
            return CallToolResult {
                content: vec![Annotated {
                    raw: RawContent::Text(RawTextContent {
                        text: format!("Parameter validation error: {}", e),
                        meta: None,
                    }),
                    annotations: None,
                }],
                is_error: Some(true),
                meta: None,
                structured_content: None,
            };
        }
    };

    match execute_query_olap(config, params).await {
        Ok(content) => CallToolResult {
            content: vec![Annotated {
                raw: RawContent::Text(RawTextContent {
                    text: content,
                    meta: None,
                }),
                annotations: None,
            }],
            is_error: Some(false),
            meta: None,
            structured_content: None,
        },
        Err(e) => CallToolResult {
            content: vec![Annotated {
                raw: RawContent::Text(RawTextContent {
                    text: format!("Query execution error: {}", e),
                    meta: None,
                }),
                annotations: None,
            }],
            is_error: Some(true),
            meta: None,
            structured_content: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_select_query() {
        let query = "SELECT * FROM users LIMIT 10";
        let result = validate_and_analyze_query(query);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert!(analysis.supports_limit); // SELECT supports LIMIT
        assert!(analysis.has_limit); // Query already has LIMIT
    }

    #[test]
    fn test_validate_with_subquery() {
        let query = "SELECT id, name FROM (SELECT * FROM users WHERE active = true)";
        let result = validate_and_analyze_query(query);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert!(analysis.supports_limit);
        assert!(!analysis.has_limit);
    }

    #[test]
    fn test_validate_show_tables() {
        let query = "SHOW TABLES";
        let result = validate_and_analyze_query(query);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert!(analysis.supports_limit); // SHOW TABLES supports LIMIT
        assert!(!analysis.has_limit);
    }

    #[test]
    fn test_validate_describe_table() {
        let query = "DESCRIBE TABLE users";
        let result = validate_and_analyze_query(query);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert!(!analysis.supports_limit); // DESCRIBE does not support LIMIT
        assert!(!analysis.has_limit);
    }

    #[test]
    fn test_validate_describe() {
        let query = "DESCRIBE users";
        let result = validate_and_analyze_query(query);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert!(!analysis.supports_limit); // DESCRIBE does not support LIMIT
        assert!(!analysis.has_limit);
    }

    #[test]
    fn test_validate_desc() {
        let query = "DESC users";
        let result = validate_and_analyze_query(query);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert!(!analysis.supports_limit); // DESC does not support LIMIT
        assert!(!analysis.has_limit);
    }

    #[test]
    fn test_validate_show_databases() {
        let query = "SHOW DATABASES";
        let result = validate_and_analyze_query(query);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert!(analysis.supports_limit); // SHOW DATABASES supports LIMIT
        assert!(!analysis.has_limit);
    }

    #[test]
    fn test_validate_show_functions() {
        let query = "SHOW FUNCTIONS";
        let result = validate_and_analyze_query(query);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert!(analysis.supports_limit); // SHOW FUNCTIONS supports LIMIT
        assert!(!analysis.has_limit);
    }

    #[test]
    fn test_validate_show_columns() {
        let query = "SHOW COLUMNS FROM users";
        let result = validate_and_analyze_query(query);
        if result.is_err() {
            println!("SHOW COLUMNS error: {:?}", result);
        }
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert!(analysis.supports_limit); // SHOW COLUMNS supports LIMIT
        assert!(!analysis.has_limit);
    }

    #[test]
    fn test_validate_show_create_table() {
        let query = "SHOW CREATE TABLE users";
        let result = validate_and_analyze_query(query);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert!(!analysis.supports_limit); // SHOW CREATE does not support LIMIT
        assert!(!analysis.has_limit);
    }

    #[test]
    fn test_validate_explain() {
        let query = "EXPLAIN SELECT * FROM users";
        let result = validate_and_analyze_query(query);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert!(!analysis.supports_limit); // EXPLAIN does not support LIMIT
        assert!(!analysis.has_limit);
    }

    #[test]
    fn test_validate_system_tables() {
        let query = "SELECT * FROM system.tables";
        assert!(validate_and_analyze_query(query).is_ok());
    }

    #[test]
    fn test_reject_insert() {
        let query = "INSERT INTO users VALUES (1, 'test')";
        let result = validate_and_analyze_query(query);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("INSERT"));
    }

    #[test]
    fn test_reject_update() {
        let query = "UPDATE users SET name = 'test' WHERE id = 1";
        let result = validate_and_analyze_query(query);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("UPDATE"));
    }

    #[test]
    fn test_reject_delete() {
        let query = "DELETE FROM users WHERE id = 1";
        let result = validate_and_analyze_query(query);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("DELETE"));
    }

    #[test]
    fn test_reject_create_table() {
        let query = "CREATE TABLE test (id INT)";
        let result = validate_and_analyze_query(query);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("CREATE TABLE"));
    }

    #[test]
    fn test_reject_drop() {
        let query = "DROP TABLE users";
        let result = validate_and_analyze_query(query);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("DROP"));
    }

    #[test]
    fn test_reject_alter_table() {
        let query = "ALTER TABLE users ADD COLUMN email VARCHAR(255)";
        let result = validate_and_analyze_query(query);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("ALTER TABLE"));
    }

    #[test]
    fn test_reject_truncate() {
        let query = "TRUNCATE TABLE users";
        let result = validate_and_analyze_query(query);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("TRUNCATE"));
    }

    #[test]
    fn test_reject_multiple_statements() {
        let query = "SELECT * FROM users; SELECT * FROM orders";
        let result = validate_and_analyze_query(query);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Multiple statements"));
    }

    #[test]
    fn test_reject_empty_query() {
        let query = "";
        let result = validate_and_analyze_query(query);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Empty query"));
    }

    #[test]
    fn test_apply_limit_without_existing_limit() {
        let query = "SELECT * FROM users";
        let analysis = QueryAnalysis {
            supports_limit: true,
            has_limit: false,
        };
        let result = apply_limit_to_query(query, 100, &analysis);
        assert_eq!(result, "SELECT * FROM users LIMIT 100");
    }

    #[test]
    fn test_apply_limit_with_existing_limit() {
        let query = "SELECT * FROM users LIMIT 500";
        let analysis = QueryAnalysis {
            supports_limit: true,
            has_limit: true,
        };
        let result = apply_limit_to_query(query, 100, &analysis);
        assert_eq!(
            result,
            "SELECT * FROM (SELECT * FROM users LIMIT 500) LIMIT 100"
        );
    }

    #[test]
    fn test_describe_no_limit() {
        let query = "DESCRIBE TABLE users";
        let analysis = QueryAnalysis {
            supports_limit: false,
            has_limit: false,
        };
        let result = apply_limit_to_query(query, 100, &analysis);
        // DESCRIBE should not have LIMIT added
        assert_eq!(result, "DESCRIBE TABLE users");
    }

    #[test]
    fn test_show_create_no_limit() {
        let query = "SHOW CREATE TABLE users";
        let analysis = QueryAnalysis {
            supports_limit: false,
            has_limit: false,
        };
        let result = apply_limit_to_query(query, 100, &analysis);
        // SHOW CREATE should not have LIMIT added
        assert_eq!(result, "SHOW CREATE TABLE users");
    }

    #[test]
    fn test_explain_no_limit() {
        let query = "EXPLAIN SELECT * FROM users";
        let analysis = QueryAnalysis {
            supports_limit: false,
            has_limit: false,
        };
        let result = apply_limit_to_query(query, 100, &analysis);
        // EXPLAIN should not have LIMIT added
        assert_eq!(result, "EXPLAIN SELECT * FROM users");
    }

    #[test]
    fn test_show_tables_with_limit() {
        let query = "SHOW TABLES";
        let analysis = QueryAnalysis {
            supports_limit: true,
            has_limit: false,
        };
        let result = apply_limit_to_query(query, 100, &analysis);
        // SHOW TABLES should support LIMIT
        assert_eq!(result, "SHOW TABLES LIMIT 100");
    }

    #[test]
    fn test_show_databases_with_limit() {
        let query = "SHOW DATABASES";
        let analysis = QueryAnalysis {
            supports_limit: true,
            has_limit: false,
        };
        let result = apply_limit_to_query(query, 100, &analysis);
        // SHOW DATABASES should support LIMIT
        assert_eq!(result, "SHOW DATABASES LIMIT 100");
    }

    #[test]
    fn test_format_as_json_array() {
        let input = r#"[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]"#;
        let result = format_as_json(input).unwrap();
        assert!(result.contains("Alice"));
        assert!(result.contains("Bob"));
    }

    #[test]
    fn test_format_as_table() {
        let input = r#"[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]"#;
        let result = format_as_table(input).unwrap();
        assert!(result.contains("| id | name |"));
        assert!(result.contains("| 1 | Alice |"));
        assert!(result.contains("| 2 | Bob |"));
    }

    #[test]
    fn test_format_empty_result_as_table() {
        let input = r#"[]"#;
        let result = format_as_table(input).unwrap();
        assert_eq!(result, "No rows returned.");
    }

    #[test]
    fn test_parse_params_valid() {
        let args = json!({
            "query": "SELECT * FROM users",
            "limit": 50,
            "format": "json"
        });
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());
        let params = result.unwrap();
        assert_eq!(params.query, "SELECT * FROM users");
        assert_eq!(params.limit, 50);
        assert_eq!(params.format, "json");
    }

    #[test]
    fn test_parse_params_defaults() {
        let args = json!({
            "query": "SELECT * FROM users"
        });
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());
        let params = result.unwrap();
        assert_eq!(params.limit, DEFAULT_LIMIT);
        assert_eq!(params.format, "json");
    }

    #[test]
    fn test_parse_params_missing_query() {
        let args = json!({
            "limit": 50
        });
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("query parameter is required"));
    }

    #[test]
    fn test_parse_params_invalid_limit() {
        let args = json!({
            "query": "SELECT * FROM users",
            "limit": 2000
        });
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("limit must be"));
    }

    #[test]
    fn test_parse_params_invalid_format() {
        let args = json!({
            "query": "SELECT * FROM users",
            "format": "xml"
        });
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("format must be"));
    }
}
