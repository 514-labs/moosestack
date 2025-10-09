//! # Logs Tool
//!
//! This module implements the MCP tool for accessing Moose dev server logs.
//! It provides functionality to read, filter, and search through log files.

use chrono::Local;
use regex::Regex;
use rmcp::model::{Annotated, CallToolResult, RawContent, RawTextContent, Tool};
use serde_json::{json, Map, Value};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::Arc;

use crate::cli::logger::DEFAULT_LOG_FILE_FORMAT;
use crate::cli::settings::user_directory;

// Constants for validation
const MIN_LINES: u32 = 1;
const MAX_LINES: u32 = 10000;
const DEFAULT_LINES: u32 = 100;
const VALID_LOG_LEVELS: [&str; 5] = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"];

/// Error types for log retrieval operations
#[derive(Debug, thiserror::Error)]
pub enum LogError {
    #[error("Failed to read log file: {0}")]
    FileRead(#[from] std::io::Error),

    #[error("Failed to parse JSON log entry: {0}")]
    JsonParse(#[from] serde_json::Error),

    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),

    #[error("Invalid regex pattern '{pattern}': {error}")]
    InvalidRegex {
        pattern: String,
        #[source]
        error: regex::Error,
    },
}

/// Compiled search filter for efficient regex matching
#[derive(Debug)]
struct SearchFilter {
    pattern: String,
    regex: Regex,
}

impl SearchFilter {
    /// Create a new search filter with compiled regex
    fn new(pattern: String) -> Result<Self, LogError> {
        let regex = Regex::new(&pattern).map_err(|e| LogError::InvalidRegex {
            pattern: pattern.clone(),
            error: e,
        })?;
        Ok(Self { pattern, regex })
    }

    /// Check if a line matches the regex pattern
    fn is_match(&self, line: &str) -> bool {
        self.regex.is_match(line)
    }
}

/// Parameters for the get_logs tool
#[derive(Debug)]
struct GetLogsParams {
    /// Number of recent lines to retrieve (default: 100)
    lines: Option<u32>,
    /// Filter by log level (ERROR, WARN, INFO, DEBUG, TRACE)
    level: Option<String>,
    /// Search filter with precompiled regex
    search: Option<SearchFilter>,
}

/// Gets the path to the current day's log file using the shared format from logger module
fn get_log_file_path() -> PathBuf {
    let formatted_date = Local::now().format(DEFAULT_LOG_FILE_FORMAT).to_string();
    let mut path = user_directory();
    path.push(formatted_date);
    path
}

/// Helper to check if a log level string is valid
fn is_valid_log_level(level: &str) -> bool {
    VALID_LOG_LEVELS.contains(&level.to_uppercase().as_str())
}

/// Parses a text format log line and extracts the log level
/// Format: [timestamp LEVEL - target] message
fn extract_level_from_text(line: &str) -> Option<String> {
    // Find the first bracket section which contains the log metadata
    let bracket_end = line.find(']')?;
    let header = &line[..bracket_end];

    // Search for valid log levels in the header
    VALID_LOG_LEVELS
        .iter()
        .find(|&&level| header.contains(level))
        .map(|&level| level.to_string())
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

/// Checks if a line matches the level filter
fn matches_level_filter(line: &str, level_filter: &Option<String>) -> bool {
    let Some(target_level) = level_filter else {
        return true; // No filter means include all
    };

    let line_level = extract_level_from_json(line).or_else(|| extract_level_from_text(line));

    match line_level {
        Some(line_level) => line_level.eq_ignore_ascii_case(target_level),
        None => false, // Can't determine level, exclude when filter is set
    }
}

/// Checks if a line matches the search filter (regex pattern)
fn matches_search_filter(line: &str, search_filter: &Option<SearchFilter>) -> bool {
    match search_filter {
        Some(filter) => filter.is_match(line),
        None => true, // No filter means include all
    }
}

/// Filters a log line based on level and search criteria
fn should_include_line(
    line: &str,
    level_filter: &Option<String>,
    search_filter: &Option<SearchFilter>,
) -> bool {
    matches_level_filter(line, level_filter) && matches_search_filter(line, search_filter)
}

/// Returns the tool definition for the MCP server
pub fn tool_definition() -> Tool {
    let schema = json!({
        "type": "object",
        "properties": {
            "lines": {
                "type": "number",
                "description": format!("Number of recent log lines to retrieve (default: {}, max: {})", DEFAULT_LINES, MAX_LINES),
                "minimum": MIN_LINES,
                "maximum": MAX_LINES
            },
            "level": {
                "type": "string",
                "description": "Filter logs by level",
                "enum": VALID_LOG_LEVELS
            },
            "search": {
                "type": "string",
                "description": "Regex pattern to search for in log entries. Examples: 'error' (simple text), 'error|warning' (OR), 'user_\\d+' (with digits), '(?i)error' (case-insensitive)"
            }
        }
    });

    Tool {
        name: "get_logs".into(),
        description: Some(
            "Retrieve and filter Moose dev server logs. Access recent log entries from the current dev server session, filter by log level (ERROR, WARN, INFO, DEBUG, TRACE), and search with regex patterns (e.g., 'error|warn', '(?i)connection', 'user_\\d+').".into()
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
        if !(MIN_LINES..=MAX_LINES).contains(&lines_val) {
            return Err(LogError::InvalidParameter(format!(
                "lines must be between {} and {}, got {}",
                MIN_LINES, MAX_LINES, lines_val
            )));
        }
    }

    let level = args
        .and_then(|v| v.get("level"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Validate level if provided
    if let Some(ref level_val) = level {
        if !is_valid_log_level(level_val) {
            return Err(LogError::InvalidParameter(format!(
                "level must be one of {}; got {}",
                VALID_LOG_LEVELS.join(", "),
                level_val
            )));
        }
    }

    // Parse and compile search regex if provided
    let search = if let Some(pattern) = args.and_then(|v| v.get("search")).and_then(|v| v.as_str())
    {
        Some(SearchFilter::new(pattern.to_string())?)
    } else {
        None
    };

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

    let lines_limit = params.lines.unwrap_or(DEFAULT_LINES) as usize;
    let level_filter = params.level.as_ref().map(|l| l.to_uppercase());
    let search_filter = &params.search;

    // Read all lines and filter them
    let all_lines: Vec<String> = reader
        .lines()
        .map_while(Result::ok)
        .filter(|line| should_include_line(line, &level_filter, search_filter))
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
            if let Some(search) = search_filter {
                message.push_str(&format!("\n  - Search: {}", search.pattern));
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
        if let Some(search) = search_filter {
            output.push_str(&format!("\n  - Search pattern: {}", search.pattern));
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
    fn test_is_valid_log_level() {
        assert!(is_valid_log_level("ERROR"));
        assert!(is_valid_log_level("error"));
        assert!(is_valid_log_level("Error"));
        assert!(is_valid_log_level("INFO"));
        assert!(is_valid_log_level("DEBUG"));
        assert!(is_valid_log_level("WARN"));
        assert!(is_valid_log_level("TRACE"));

        assert!(!is_valid_log_level("INVALID"));
        assert!(!is_valid_log_level(""));
        assert!(!is_valid_log_level("info2"));
    }

    #[test]
    fn test_extract_level_from_text() {
        let line = "[2024-01-15T10:30:00Z INFO - moose_cli] Server started";
        assert_eq!(extract_level_from_text(line), Some("INFO".to_string()));

        let line = "[2024-01-15T10:30:00Z ERROR - moose_cli] Connection failed";
        assert_eq!(extract_level_from_text(line), Some("ERROR".to_string()));

        // Test line without brackets
        let line = "Invalid log line without brackets";
        assert_eq!(extract_level_from_text(line), None);

        // Test line with level outside brackets (in message)
        let line = "[2024-01-15T10:30:00Z INFO - moose_cli] ERROR in message";
        assert_eq!(extract_level_from_text(line), Some("INFO".to_string()));
    }

    #[test]
    fn test_extract_level_from_json() {
        let line = r#"{"timestamp":"2024-01-15T10:30:00Z","severity":"INFO","message":"Test"}"#;
        assert_eq!(extract_level_from_json(line), Some("INFO".to_string()));

        let line = r#"{"timestamp":"2024-01-15T10:30:00Z","level":"error","message":"Test"}"#;
        assert_eq!(extract_level_from_json(line), Some("ERROR".to_string()));

        // Test invalid JSON
        let line = "not valid json";
        assert_eq!(extract_level_from_json(line), None);

        // Test JSON without level fields
        let line = r#"{"timestamp":"2024-01-15T10:30:00Z","message":"Test"}"#;
        assert_eq!(extract_level_from_json(line), None);
    }

    #[test]
    fn test_matches_level_filter() {
        let line = "[2024-01-15T10:30:00Z INFO - moose_cli] Test message";

        // No filter should match
        assert!(matches_level_filter(line, &None));

        // Matching filter
        assert!(matches_level_filter(line, &Some("INFO".to_string())));
        assert!(matches_level_filter(line, &Some("info".to_string())));

        // Non-matching filter
        assert!(!matches_level_filter(line, &Some("ERROR".to_string())));

        // Line without level and filter set
        let invalid_line = "no level here";
        assert!(!matches_level_filter(
            invalid_line,
            &Some("INFO".to_string())
        ));
    }

    #[test]
    fn test_matches_search_filter() {
        let line = "[2024-01-15T10:30:00Z INFO - moose_cli] Connection established";

        // No filter should match
        assert!(matches_search_filter(line, &None));

        // Simple text matching (regex treats plain text as literal)
        let filter = SearchFilter::new("Connection".to_string()).unwrap();
        assert!(matches_search_filter(line, &Some(filter)));

        let filter = SearchFilter::new("established".to_string()).unwrap();
        assert!(matches_search_filter(line, &Some(filter)));

        let filter = SearchFilter::new("INFO".to_string()).unwrap();
        assert!(matches_search_filter(line, &Some(filter)));

        // Non-matching pattern
        let filter = SearchFilter::new("Database".to_string()).unwrap();
        assert!(!matches_search_filter(line, &Some(filter)));
    }

    #[test]
    fn test_matches_search_filter_regex() {
        let line = "[2024-01-15T10:30:00Z INFO - moose_cli] User user_123 connected";

        // Regex with digits
        let filter = SearchFilter::new("user_\\d+".to_string()).unwrap();
        assert!(matches_search_filter(line, &Some(filter)));

        // OR operator
        let filter = SearchFilter::new("INFO|ERROR".to_string()).unwrap();
        assert!(matches_search_filter(line, &Some(filter)));

        let filter = SearchFilter::new("WARN|DEBUG".to_string()).unwrap();
        assert!(!matches_search_filter(line, &Some(filter)));

        // Case-insensitive flag (matches "connected" with any case)
        let filter = SearchFilter::new("(?i)CONNECTED".to_string()).unwrap();
        assert!(matches_search_filter(line, &Some(filter)));

        // Word boundaries
        let filter = SearchFilter::new("\\buser_\\d+\\b".to_string()).unwrap();
        assert!(matches_search_filter(line, &Some(filter)));

        // More regex patterns
        let filter = SearchFilter::new("User.*connected".to_string()).unwrap();
        assert!(matches_search_filter(line, &Some(filter)));

        let filter = SearchFilter::new("^\\[\\d{4}".to_string()).unwrap(); // Starts with [YYYY
        assert!(matches_search_filter(line, &Some(filter)));
    }

    #[test]
    fn test_search_filter_invalid_regex() {
        // Invalid regex should return an error
        let result = SearchFilter::new("[invalid".to_string());
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid regex pattern"));

        // Valid regex
        let result = SearchFilter::new("valid.*pattern".to_string());
        assert!(result.is_ok());
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
        let filter = SearchFilter::new("Connection".to_string()).unwrap();
        assert!(should_include_line(line, &None, &Some(filter)));

        // Should not include when search pattern doesn't match
        let filter = SearchFilter::new("Database".to_string()).unwrap();
        assert!(!should_include_line(line, &None, &Some(filter)));
    }

    #[test]
    fn test_should_include_line_both_filters() {
        let line = "[2024-01-15T10:30:00Z ERROR - moose_cli] Connection failed";

        // Should include when both filters match
        let filter = SearchFilter::new("Connection".to_string()).unwrap();
        assert!(should_include_line(
            line,
            &Some("ERROR".to_string()),
            &Some(filter)
        ));

        // Should not include when level doesn't match
        let filter = SearchFilter::new("Connection".to_string()).unwrap();
        assert!(!should_include_line(
            line,
            &Some("INFO".to_string()),
            &Some(filter)
        ));

        // Should not include when search doesn't match
        let filter = SearchFilter::new("Database".to_string()).unwrap();
        assert!(!should_include_line(
            line,
            &Some("ERROR".to_string()),
            &Some(filter)
        ));
    }

    #[test]
    fn test_parse_params_valid() {
        use serde_json::json;

        // Test with all parameters
        let args = json!({
            "lines": 50,
            "level": "ERROR",
            "search": "connection"
        });
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());
        let params = result.unwrap();
        assert_eq!(params.lines, Some(50));
        assert_eq!(params.level, Some("ERROR".to_string()));
        assert!(params.search.is_some());
        assert_eq!(params.search.unwrap().pattern, "connection");

        // Test with no parameters
        let result = parse_params(None);
        assert!(result.is_ok());
        let params = result.unwrap();
        assert_eq!(params.lines, None);
        assert_eq!(params.level, None);
        assert!(params.search.is_none());

        // Test with only lines
        let args = json!({"lines": 100});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());

        // Test with regex pattern
        let args = json!({"search": "error|warning"});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());
        let params = result.unwrap();
        assert!(params.search.is_some());
        assert_eq!(params.search.unwrap().pattern, "error|warning");
    }

    #[test]
    fn test_parse_params_validation_errors() {
        use serde_json::json;

        // Invalid lines: too small
        let args = json!({"lines": 0});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("between 1 and 10000"));

        // Invalid lines: too large
        let args = json!({"lines": 10001});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());

        // Invalid level
        let args = json!({"level": "INVALID"});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("must be one of"));

        // Invalid regex pattern
        let args = json!({"search": "[invalid"});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid regex pattern"));

        // Valid edge cases
        let args = json!({"lines": MIN_LINES});
        let map = args.as_object().unwrap();
        assert!(parse_params(Some(map)).is_ok());

        let args = json!({"lines": MAX_LINES});
        let map = args.as_object().unwrap();
        assert!(parse_params(Some(map)).is_ok());
    }

    #[test]
    fn test_constants_consistency() {
        // Ensure constants are sensible
        assert!(MIN_LINES > 0);
        assert!(MAX_LINES > MIN_LINES);
        assert!(DEFAULT_LINES >= MIN_LINES);
        assert!(DEFAULT_LINES <= MAX_LINES);
        assert_eq!(VALID_LOG_LEVELS.len(), 5);
    }
}
