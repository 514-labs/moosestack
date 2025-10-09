//! # Logs Tool
//!
//! This module implements the MCP tool for accessing Moose dev server logs.
//! It provides functionality to read, filter, and search through log files.

use chrono::Local;
use rmcp::model::{Annotated, CallToolResult, RawContent, RawTextContent, Tool};
use serde_json::{json, Map, Value};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::Arc;

use crate::cli::settings::user_directory;

/// Error types for log retrieval operations
#[derive(Debug, thiserror::Error)]
pub enum LogError {
    #[error("Failed to read log file: {0}")]
    FileRead(#[from] std::io::Error),

    #[error("Failed to parse JSON log entry: {0}")]
    JsonParse(#[from] serde_json::Error),

    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
}

/// Parameters for the get_logs tool
#[derive(Debug)]
struct GetLogsParams {
    /// Number of recent lines to retrieve (default: 100)
    lines: Option<u32>,
    /// Filter by log level (ERROR, WARN, INFO, DEBUG, TRACE)
    level: Option<String>,
    /// Search pattern to filter log entries
    search: Option<String>,
}

/// Gets the path to the current day's log file
fn get_log_file_path() -> PathBuf {
    let date_format = "%Y-%m-%d-cli.log";
    let formatted_date = Local::now().format(date_format).to_string();
    let mut path = user_directory();
    path.push(formatted_date);
    path
}

/// Parses a text format log line and extracts the log level
/// Format: [timestamp LEVEL - target] message
fn extract_level_from_text(line: &str) -> Option<String> {
    // Find the first occurrence of a log level keyword
    let levels = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"];
    for level in &levels {
        if line.contains(level) {
            // Make sure it's not part of the message by checking if it's in brackets
            if let Some(bracket_end) = line.find(']') {
                let header = &line[..bracket_end];
                if header.contains(level) {
                    return Some(level.to_string());
                }
            }
        }
    }
    None
}

/// Parses a JSON format log line and extracts the log level
fn extract_level_from_json(line: &str) -> Option<String> {
    if let Ok(json) = serde_json::from_str::<Value>(line) {
        json.get("severity")
            .or_else(|| json.get("level"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_uppercase())
    } else {
        None
    }
}

/// Filters a log line based on level and search criteria
fn should_include_line(
    line: &str,
    level_filter: &Option<String>,
    search_filter: &Option<String>,
) -> bool {
    // Check level filter
    if let Some(target_level) = level_filter {
        let line_level = extract_level_from_json(line).or_else(|| extract_level_from_text(line));

        if let Some(line_level) = line_level {
            if !line_level.eq_ignore_ascii_case(target_level) {
                return false;
            }
        } else {
            // If we can't determine the level and a filter is set, exclude the line
            return false;
        }
    }

    // Check search filter
    if let Some(search_pattern) = search_filter {
        if !line.contains(search_pattern) {
            return false;
        }
    }

    true
}

/// Returns the tool definition for the MCP server
pub fn tool_definition() -> Tool {
    let schema = json!({
        "type": "object",
        "properties": {
            "lines": {
                "type": "number",
                "description": "Number of recent log lines to retrieve (default: 100)",
                "minimum": 1,
                "maximum": 10000
            },
            "level": {
                "type": "string",
                "description": "Filter logs by level",
                "enum": ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"]
            },
            "search": {
                "type": "string",
                "description": "Search pattern to filter log entries"
            }
        }
    });

    Tool {
        name: "get_logs".into(),
        description: Some(
            "Retrieve and filter Moose dev server logs. Access recent log entries from the current dev server session, filter by log level (ERROR, WARN, INFO, DEBUG, TRACE), and search for specific content.".into()
        ),
        input_schema: Arc::new(schema.as_object().unwrap().clone()),
        annotations: None,
        icons: None,
        output_schema: None,
        title: Some("Get Moose Dev Server Logs".into()),
    }
}

/// Parse and validate parameters from MCP arguments
fn parse_params(arguments: Option<&Map<String, Value>>) -> Result<GetLogsParams, LogError> {
    let args = arguments;

    let lines = args
        .and_then(|v| v.get("lines"))
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);

    // Validate lines if provided
    if let Some(lines_val) = lines {
        if !(1..=10000).contains(&lines_val) {
            return Err(LogError::InvalidParameter(format!(
                "lines must be between 1 and 10000, got {}",
                lines_val
            )));
        }
    }

    let level = args
        .and_then(|v| v.get("level"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Validate level if provided
    if let Some(ref level_val) = level {
        let valid_levels = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"];
        if !valid_levels.contains(&level_val.to_uppercase().as_str()) {
            return Err(LogError::InvalidParameter(format!(
                "level must be one of ERROR, WARN, INFO, DEBUG, TRACE; got {}",
                level_val
            )));
        }
    }

    let search = args
        .and_then(|v| v.get("search"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(GetLogsParams {
        lines,
        level,
        search,
    })
}

/// Handle the tool call with the given arguments
pub fn handle_call(arguments: Option<&Map<String, Value>>) -> CallToolResult {
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

    match execute_get_logs(params) {
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
                    text: format!("Error retrieving logs: {}", e),
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

/// Main function to retrieve and filter logs
fn execute_get_logs(params: GetLogsParams) -> Result<String, LogError> {
    let log_file_path = get_log_file_path();

    // Check if log file exists
    if !log_file_path.exists() {
        return Ok(format!(
            "No log file found at {}. The dev server may not be running or no logs have been written yet.",
            log_file_path.display()
        ));
    }

    let file = File::open(&log_file_path)?;
    let reader = BufReader::new(file);

    let lines_limit = params.lines.unwrap_or(100) as usize;
    let level_filter = params.level.as_ref().map(|l| l.to_uppercase());
    let search_filter = params.search.clone();

    // Read all lines and filter them
    let all_lines: Vec<String> = reader
        .lines()
        .map_while(Result::ok)
        .filter(|line| should_include_line(line, &level_filter, &search_filter))
        .collect();

    // Take the last N lines (most recent)
    let recent_lines: Vec<&String> = all_lines.iter().rev().take(lines_limit).collect();

    // Reverse to show oldest to newest
    let result_lines: Vec<&String> = recent_lines.into_iter().rev().collect();

    if result_lines.is_empty() {
        let mut message = format!("No log entries found in {}", log_file_path.display());

        if level_filter.is_some() || search_filter.is_some() {
            message.push_str(" matching the specified filters");
            if let Some(level) = &level_filter {
                message.push_str(&format!("\n  - Level: {}", level));
            }
            if let Some(ref search) = search_filter {
                message.push_str(&format!("\n  - Search: {}", search));
            }
        }

        return Ok(message);
    }

    // Format the output
    let mut output = format!(
        "Showing {} most recent log entries from {}",
        result_lines.len(),
        log_file_path.display()
    );

    if level_filter.is_some() || search_filter.is_some() {
        output.push_str("\nFilters applied:");
        if let Some(level) = &level_filter {
            output.push_str(&format!("\n  - Level: {}", level));
        }
        if let Some(ref search) = search_filter {
            output.push_str(&format!("\n  - Search: {}", search));
        }
    }

    output.push_str("\n\n");
    // Convert Vec<&String> to Vec<&str> for join
    let line_strs: Vec<&str> = result_lines.iter().map(|s| s.as_str()).collect();
    output.push_str(&line_strs.join("\n"));

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_level_from_text() {
        let line = "[2024-01-15T10:30:00Z INFO - moose_cli] Server started";
        assert_eq!(extract_level_from_text(line), Some("INFO".to_string()));

        let line = "[2024-01-15T10:30:00Z ERROR - moose_cli] Connection failed";
        assert_eq!(extract_level_from_text(line), Some("ERROR".to_string()));
    }

    #[test]
    fn test_extract_level_from_json() {
        let line = r#"{"timestamp":"2024-01-15T10:30:00Z","severity":"INFO","message":"Test"}"#;
        assert_eq!(extract_level_from_json(line), Some("INFO".to_string()));

        let line = r#"{"timestamp":"2024-01-15T10:30:00Z","level":"error","message":"Test"}"#;
        assert_eq!(extract_level_from_json(line), Some("ERROR".to_string()));
    }

    #[test]
    fn test_should_include_line_no_filters() {
        let line = "[2024-01-15T10:30:00Z INFO - moose_cli] Test message";
        assert!(should_include_line(line, &None, &None));
    }

    #[test]
    fn test_should_include_line_level_filter() {
        let line = "[2024-01-15T10:30:00Z INFO - moose_cli] Test message";

        // Should include when level matches
        assert!(should_include_line(line, &Some("INFO".to_string()), &None));

        // Should not include when level doesn't match
        assert!(!should_include_line(
            line,
            &Some("ERROR".to_string()),
            &None
        ));
    }

    #[test]
    fn test_should_include_line_search_filter() {
        let line = "[2024-01-15T10:30:00Z INFO - moose_cli] Connection established";

        // Should include when search pattern matches
        assert!(should_include_line(
            line,
            &None,
            &Some("Connection".to_string())
        ));

        // Should not include when search pattern doesn't match
        assert!(!should_include_line(
            line,
            &None,
            &Some("Database".to_string())
        ));
    }

    #[test]
    fn test_should_include_line_both_filters() {
        let line = "[2024-01-15T10:30:00Z ERROR - moose_cli] Connection failed";

        // Should include when both filters match
        assert!(should_include_line(
            line,
            &Some("ERROR".to_string()),
            &Some("Connection".to_string())
        ));

        // Should not include when level doesn't match
        assert!(!should_include_line(
            line,
            &Some("INFO".to_string()),
            &Some("Connection".to_string())
        ));

        // Should not include when search doesn't match
        assert!(!should_include_line(
            line,
            &Some("ERROR".to_string()),
            &Some("Database".to_string())
        ));
    }
}
