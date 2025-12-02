//! SQL validation using sqlparser with ClickHouse dialect.
//!
//! Provides structured diagnostics for SQL syntax errors that can be
//! displayed in the CLI or converted to LSP diagnostics in the future.

use sqlparser::dialect::ClickHouseDialect;
use sqlparser::parser::Parser;

/// Severity level for SQL diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
}

/// A diagnostic message for SQL validation errors.
///
/// Designed to be convertible to LSP Diagnostic in the future.
#[derive(Debug, Clone)]
pub struct SqlDiagnostic {
    /// Severity of the diagnostic (Error or Warning).
    pub severity: DiagnosticSeverity,
    /// Human-readable error message from sqlparser.
    pub message: String,
    /// Source file path where the SQL is defined (e.g., "app/views/barAggregated.ts").
    pub source_file: Option<String>,
    /// Name of the resource containing the SQL (e.g., "BarAggregated_MV").
    pub resource_name: String,
    /// The full SQL statement that failed validation.
    pub sql: String,
}

impl std::fmt::Display for SqlDiagnostic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Invalid SQL in '{}': {}",
            self.resource_name, self.message
        )
    }
}

impl std::error::Error for SqlDiagnostic {}

/// Validates a single SQL statement using sqlparser with ClickHouse dialect.
///
/// # Arguments
/// * `sql` - The SQL statement to validate
///
/// # Returns
/// * `Ok(())` if the SQL is syntactically valid
/// * `Err(String)` with the parser error message if invalid
pub fn validate_sql_statement(sql: &str) -> Result<(), String> {
    let dialect = ClickHouseDialect {};
    Parser::parse_sql(&dialect, sql)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_sql_statement_valid_select() {
        let sql = "SELECT * FROM users WHERE id = 1";
        assert!(validate_sql_statement(sql).is_ok());
    }

    #[test]
    fn test_validate_sql_statement_valid_materialized_view() {
        let sql =
            "CREATE MATERIALIZED VIEW IF NOT EXISTS test_mv TO target AS SELECT * FROM source";
        assert!(validate_sql_statement(sql).is_ok());
    }

    #[test]
    fn test_validate_sql_statement_invalid_typo() {
        let sql = "SELCT * FROM users";
        let result = validate_sql_statement(sql);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("SELCT"));
    }

    #[test]
    fn test_validate_sql_statement_invalid_syntax() {
        let sql = "SELECT * FORM users";
        let result = validate_sql_statement(sql);
        assert!(result.is_err());
    }
}
