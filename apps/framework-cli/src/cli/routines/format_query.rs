//! Module for formatting SQL queries as code literals.
//!
//! Supports formatting SQL queries with delimiter-aware escaping for Python and TypeScript
//! string literals. Automatically detects conflicts and falls back to safer delimiters.
//!
//! # Usage
//!
//! ```rust
//! use moose_cli::cli::routines::format_query::*;
//!
//! // With explicit delimiter
//! let formatted = format_as_code_with_delimiter(
//!     "SELECT * FROM users",
//!     r#"r""""#,  // Python raw triple-quote
//!     false
//! ).unwrap();
//!
//! // With language default
//! let formatted = format_as_code(
//!     "SELECT * FROM users",
//!     CodeLanguage::Python,
//!     false
//! ).unwrap();
//! ```
//!
//! # Supported Delimiters
//!
//! ## Python
//! - Raw strings: `r"""`, `r'''`, `r"`, `r'`
//! - Regular strings: `"""`, `'''`, `"`, `'`
//! - F-strings: `f"""`, `f'''`, `f"`, `f'`
//!
//! ## TypeScript
//! - Template literals: `` ` ``
//! - Strings: `"`, `'`
//!
//! # Automatic Fallback
//!
//! When SQL content conflicts with the chosen delimiter (e.g., SQL contains `"""`
//! when using `r"""`), the formatter automatically falls back to a safer delimiter:
//!
//! - `r"""` → `r'''` → `"""` → `'''`
//! - `` ` `` → `"` → `'`

use crate::cli::display::Message;
use crate::cli::routines::string_format::StringFormat;
use crate::cli::routines::RoutineFailure;
use sqlparser::ast::Statement;
use sqlparser::dialect::ClickHouseDialect;
use sqlparser::parser::Parser;

/// Supported languages for code formatting
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeLanguage {
    Python,
    TypeScript,
}

impl CodeLanguage {
    /// Parse language string into CodeLanguage enum
    pub fn from_str(s: &str) -> Result<Self, RoutineFailure> {
        match s.to_lowercase().as_str() {
            "python" | "py" => Ok(CodeLanguage::Python),
            "typescript" | "ts" => Ok(CodeLanguage::TypeScript),
            _ => Err(RoutineFailure::error(Message::new(
                "Format Query".to_string(),
                format!(
                    "Unsupported language: '{}'. Supported: python, typescript",
                    s
                ),
            ))),
        }
    }
}

/// Parse SQL using ClickHouse dialect
fn parse_sql(sql: &str) -> Result<Vec<Statement>, RoutineFailure> {
    let dialect = ClickHouseDialect {};
    Parser::parse_sql(&dialect, sql).map_err(|e| {
        RoutineFailure::error(Message::new(
            "SQL Parsing".to_string(),
            format!("Invalid SQL syntax: {}", e),
        ))
    })
}

/// Validate SQL syntax using sqlparser.
///
/// Parses the SQL query to ensure it's syntactically valid before formatting or execution.
///
/// # Arguments
///
/// * `sql` - The SQL query string to validate
///
/// # Returns
///
/// * `Result<(), RoutineFailure>` - Ok if valid, error with helpful message if invalid
pub fn validate_sql(sql: &str) -> Result<(), RoutineFailure> {
    parse_sql(sql)?;
    Ok(())
}

/// Prettify SQL query using sqlparser's pretty printing.
///
/// Parses the SQL and formats it with proper indentation and line breaks.
///
/// # Arguments
///
/// * `sql` - The SQL query string to prettify
///
/// # Returns
///
/// * `Result<String, RoutineFailure>` - Prettified SQL string or error
fn prettify_sql(sql: &str) -> Result<String, RoutineFailure> {
    let statements = parse_sql(sql)?;

    // Format all statements with pretty printing
    let formatted: Vec<String> = statements
        .iter()
        .map(|stmt| format!("{:#}", stmt))
        .collect();

    Ok(formatted.join(";\n"))
}

/// Format SQL query as a code literal for the specified language.
///
/// # Arguments
///
/// * `sql` - The SQL query string to format
/// * `language` - Target language (Python or TypeScript)
/// * `prettify` - Whether to prettify SQL before formatting
///
/// # Returns
///
/// * `Result<String, RoutineFailure>` - Formatted code literal or error
pub fn format_as_code(
    sql: &str,
    language: CodeLanguage,
    prettify: bool,
) -> Result<String, RoutineFailure> {
    let default_delimiter = get_default_delimiter(language);
    format_as_code_with_delimiter(sql, default_delimiter, prettify)
}

/// Get the default recommended delimiter for a language
pub fn get_default_delimiter(language: CodeLanguage) -> &'static str {
    match language {
        CodeLanguage::Python => r#"r""""#, // Raw triple-quote for multi-line
        CodeLanguage::TypeScript => "`",   // Template literal for multi-line
    }
}

/// Format SQL query as a code literal with specific delimiter.
///
/// # Arguments
///
/// * `sql` - The SQL query string to format
/// * `delimiter` - String delimiter (e.g., `r"""`, `` ` ``, `"`)
/// * `prettify` - Whether to prettify SQL before formatting
///
/// # Returns
///
/// * `Result<String, RoutineFailure>` - Formatted code literal or error
pub fn format_as_code_with_delimiter(
    sql: &str,
    delimiter: &str,
    prettify: bool,
) -> Result<String, RoutineFailure> {
    // 1. Validate SQL syntax first
    validate_sql(sql)?;

    // 2. Optionally prettify
    let sql_to_format = if prettify {
        prettify_sql(sql)?
    } else {
        sql.to_string()
    };

    // 3. Parse delimiter to StringFormat
    let format = StringFormat::from_delimiter(delimiter)?;

    // 4. Resolve conflicts with automatic fallback
    let final_format = format.resolve(&sql_to_format);

    // 5. Escape and wrap
    let escaped = final_format.escape(&sql_to_format);
    let wrapped = final_format.wrap(&escaped);

    Ok(wrapped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_language_from_str() {
        assert_eq!(
            CodeLanguage::from_str("python").unwrap(),
            CodeLanguage::Python
        );
        assert_eq!(CodeLanguage::from_str("py").unwrap(), CodeLanguage::Python);
        assert_eq!(
            CodeLanguage::from_str("typescript").unwrap(),
            CodeLanguage::TypeScript
        );
        assert_eq!(
            CodeLanguage::from_str("ts").unwrap(),
            CodeLanguage::TypeScript
        );
        assert!(CodeLanguage::from_str("java").is_err());
    }

    #[test]
    fn test_format_as_code_python() {
        let sql = "SELECT 1";
        let result = format_as_code(sql, CodeLanguage::Python, false).unwrap();
        assert_eq!(result, "r\"\"\"\nSELECT 1\n\"\"\"");
    }

    #[test]
    fn test_format_as_code_typescript() {
        let sql = "SELECT 1";
        let result = format_as_code(sql, CodeLanguage::TypeScript, false).unwrap();
        assert_eq!(result, "`\nSELECT 1\n`");
    }

    #[test]
    fn test_prettify_sql_basic() {
        let sql = "SELECT id, name FROM users WHERE active = 1 ORDER BY name";
        let result = prettify_sql(sql).unwrap();

        assert!(result.contains("SELECT"));
        assert!(result.contains("FROM"));
        assert!(result.contains("users"));
        assert!(result.contains("WHERE"));
        // Should have line breaks with sqlparser formatting
        assert!(result.contains('\n'));
    }

    #[test]
    fn test_prettify_sql_preserves_values() {
        let sql = "SELECT * FROM users WHERE email = 'test@example.com'";
        let result = prettify_sql(sql).unwrap();

        // Should preserve the email value
        assert!(result.contains("test@example.com"));
    }

    #[test]
    fn test_format_as_code_with_prettify() {
        let sql = "SELECT id, name FROM users WHERE active = 1";

        // With prettify
        let result = format_as_code(sql, CodeLanguage::Python, true).unwrap();
        assert!(result.starts_with("r\"\"\""));
        assert!(result.contains('\n'));
        assert!(result.contains("SELECT"));

        // Without prettify
        let result_no_prettify = format_as_code(sql, CodeLanguage::Python, false).unwrap();
        assert!(result_no_prettify.starts_with("r\"\"\""));
        assert!(result_no_prettify.contains("SELECT id, name FROM users"));
    }

    #[test]
    fn test_prettify_with_complex_query() {
        let sql = "SELECT u.id, u.name, o.total FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.active = 1 AND o.total > 100 ORDER BY o.total DESC LIMIT 10";
        let result = prettify_sql(sql).unwrap();

        assert!(result.contains("SELECT"));
        assert!(result.contains("FROM"));
        assert!(result.contains("users"));
        assert!(result.contains("JOIN"));
        assert!(result.contains("WHERE"));
        assert!(result.contains("LIMIT"));
    }

    #[test]
    fn test_validate_sql_valid() {
        let sql = "SELECT * FROM users WHERE id = 1";
        assert!(validate_sql(sql).is_ok());
    }

    #[test]
    fn test_validate_sql_invalid() {
        let sql = "INVALID SQL SYNTAX ;;; NOT VALID";
        assert!(validate_sql(sql).is_err());
    }

    // Task 10: Tests for format_as_code_with_delimiter
    #[test]
    fn test_format_as_code_with_delimiter_python_raw() {
        let sql = "SELECT * FROM users WHERE id = 1";
        let result = format_as_code_with_delimiter(sql, r#"r""""#, false).unwrap();
        assert_eq!(result, "r\"\"\"\nSELECT * FROM users WHERE id = 1\n\"\"\"");
    }

    #[test]
    fn test_format_as_code_with_delimiter_typescript_template() {
        let sql = "SELECT * FROM users WHERE id = 1";
        let result = format_as_code_with_delimiter(sql, "`", false).unwrap();
        assert_eq!(result, "`\nSELECT * FROM users WHERE id = 1\n`");
    }

    #[test]
    fn test_format_as_code_with_delimiter_handles_conflict() {
        let sql = r#"SELECT '"""' AS col"#;
        let result = format_as_code_with_delimiter(sql, r#"r""""#, false).unwrap();
        // Should fall back to r''' since r""" conflicts
        assert!(result.starts_with("r'''"));
    }

    #[test]
    fn test_format_as_code_with_delimiter_prettifies() {
        let sql = "SELECT id, name FROM users WHERE active = 1";
        let result = format_as_code_with_delimiter(sql, r#"r""""#, true).unwrap();
        // Should contain prettified SQL
        assert!(result.contains("SELECT"));
        assert!(result.contains("FROM"));
    }

    #[test]
    fn test_format_as_code_with_delimiter_validates_sql() {
        let sql = "INVALID SQL SYNTAX ;;; NOT VALID";
        let result = format_as_code_with_delimiter(sql, r#"r""""#, false);
        assert!(result.is_err());
    }

    // Task 12: Tests for default delimiter selection
    #[test]
    fn test_get_default_delimiter_python() {
        let delimiter = get_default_delimiter(CodeLanguage::Python);
        assert_eq!(delimiter, r#"r""""#);
    }

    #[test]
    fn test_get_default_delimiter_typescript() {
        let delimiter = get_default_delimiter(CodeLanguage::TypeScript);
        assert_eq!(delimiter, "`");
    }
}

#[cfg(test)]
#[path = "format_query_e2e_tests.rs"]
mod format_query_e2e_tests;
