//! Module for formatting SQL queries as code literals.
//!
//! Supports formatting SQL queries as Python raw strings or TypeScript template literals
//! for easy copy-pasting into application code.

use crate::cli::display::Message;
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
    let sql_to_format = if prettify {
        prettify_sql(sql)?
    } else {
        sql.to_string()
    };

    let formatted = match language {
        CodeLanguage::Python => format_python(&sql_to_format),
        CodeLanguage::TypeScript => format_typescript(&sql_to_format),
    };

    Ok(formatted)
}

/// Format SQL as Python raw triple-quoted string
fn format_python(sql: &str) -> String {
    format!("r\"\"\"\n{}\n\"\"\"", sql.trim())
}

/// Format SQL as TypeScript template literal
fn format_typescript(sql: &str) -> String {
    format!("`\n{}\n`", sql.trim())
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
    fn test_format_python() {
        let sql = "SELECT * FROM users\nWHERE id = 1";
        let result = format_python(sql);
        assert_eq!(result, "r\"\"\"\nSELECT * FROM users\nWHERE id = 1\n\"\"\"");
    }

    #[test]
    fn test_format_python_with_regex() {
        let sql = r"SELECT * FROM users WHERE email REGEXP '[a-z]+'";
        let result = format_python(sql);
        assert!(result.starts_with("r\"\"\""));
        assert!(result.contains(r"REGEXP '[a-z]+'"));
    }

    #[test]
    fn test_format_typescript() {
        let sql = "SELECT * FROM users\nWHERE id = 1";
        let result = format_typescript(sql);
        assert_eq!(result, "`\nSELECT * FROM users\nWHERE id = 1\n`");
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
    fn test_format_python_multiline_complex() {
        let sql = r#"SELECT
    user_id,
    email,
    created_at
FROM users
WHERE email REGEXP '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    AND status = 'active'
ORDER BY created_at DESC"#;
        let result = format_python(sql);
        assert!(result.starts_with("r\"\"\""));
        assert!(result.ends_with("\"\"\""));
        assert!(result.contains("REGEXP"));
        assert!(result.contains("ORDER BY"));
        // Verify backslashes are preserved as-is in raw string
        assert!(result.contains(r"[a-zA-Z0-9._%+-]+"));
    }

    #[test]
    fn test_format_python_complex_regex_patterns() {
        // Test various regex special characters
        let sql = r"SELECT * FROM logs WHERE message REGEXP '\\d{4}-\\d{2}-\\d{2}\\s+\\w+'";
        let result = format_python(sql);
        assert!(result.contains(r"\\d{4}-\\d{2}-\\d{2}\\s+\\w+"));

        // Test with character classes and quantifiers
        let sql2 = r"SELECT * FROM data WHERE field REGEXP '[A-Z]{3,5}\-\d+'";
        let result2 = format_python(sql2);
        assert!(result2.contains(r"[A-Z]{3,5}\-\d+"));
    }

    #[test]
    fn test_format_typescript_multiline_complex() {
        let sql = r#"SELECT
    order_id,
    customer_email,
    total_amount
FROM orders
WHERE customer_email REGEXP '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
    AND total_amount > 100
LIMIT 50"#;
        let result = format_typescript(sql);
        assert!(result.starts_with("`"));
        assert!(result.ends_with("`"));
        assert!(result.contains("REGEXP"));
        assert!(result.contains("LIMIT 50"));
    }

    #[test]
    fn test_format_preserves_indentation() {
        let sql = "SELECT *\n    FROM users\n        WHERE id = 1";
        let python_result = format_python(sql);
        let typescript_result = format_typescript(sql);

        // Both should preserve the indentation
        assert!(python_result.contains("    FROM users"));
        assert!(python_result.contains("        WHERE id = 1"));
        assert!(typescript_result.contains("    FROM users"));
        assert!(typescript_result.contains("        WHERE id = 1"));
    }

    #[test]
    fn test_format_python_with_quotes_and_backslashes() {
        // SQL with single quotes and backslashes
        let sql = r"SELECT * FROM data WHERE pattern REGEXP '\\b(foo|bar)\\b' AND name = 'test'";
        let result = format_python(sql);
        // Raw strings should preserve everything as-is
        assert!(result.contains(r"\\b(foo|bar)\\b"));
        assert!(result.contains("name = 'test'"));
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
}
