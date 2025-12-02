//! SQL validation using sqlparser with ClickHouse dialect.
//!
//! Provides structured diagnostics for SQL syntax errors that can be
//! displayed in the CLI or converted to LSP diagnostics in the future.

use crate::framework::core::infrastructure::sql_resource::SqlResource;
use sqlparser::dialect::ClickHouseDialect;
use sqlparser::parser::Parser;
use std::collections::HashMap;

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

/// Validates all SQL statements in a SqlResource.
///
/// # Arguments
/// * `resource` - The SqlResource containing SQL statements to validate
///
/// # Returns
/// A vector of SqlDiagnostic for each invalid SQL statement found.
/// Empty vector if all SQL is valid.
pub fn validate_sql_resource(resource: &SqlResource) -> Vec<SqlDiagnostic> {
    let mut diagnostics = Vec::new();

    for sql in &resource.setup {
        if let Err(message) = validate_sql_statement(sql) {
            diagnostics.push(SqlDiagnostic {
                severity: DiagnosticSeverity::Error,
                message,
                source_file: resource.source_file.clone(),
                resource_name: resource.name.clone(),
                sql: sql.clone(),
            });
        }
    }

    for sql in &resource.teardown {
        if let Err(message) = validate_sql_statement(sql) {
            diagnostics.push(SqlDiagnostic {
                severity: DiagnosticSeverity::Error,
                message,
                source_file: resource.source_file.clone(),
                resource_name: resource.name.clone(),
                sql: sql.clone(),
            });
        }
    }

    diagnostics
}

/// Validates all SQL in an infrastructure map's sql_resources.
///
/// # Arguments
/// * `sql_resources` - HashMap of SqlResource objects to validate
///
/// # Returns
/// A vector of SqlDiagnostic for all invalid SQL found across all resources.
pub fn validate_infrastructure_sql(
    sql_resources: &HashMap<String, SqlResource>,
) -> Vec<SqlDiagnostic> {
    let mut diagnostics = Vec::new();

    for resource in sql_resources.values() {
        diagnostics.extend(validate_sql_resource(resource));
    }

    diagnostics
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

    #[test]
    fn test_validate_sql_resource_valid() {
        use crate::framework::core::infrastructure::sql_resource::SqlResource;

        let resource = SqlResource {
            name: "TestMV".to_string(),
            database: None,
            source_file: Some("app/views/test.ts".to_string()),
            setup: vec![
                "CREATE MATERIALIZED VIEW IF NOT EXISTS TestMV TO Target AS SELECT * FROM Source"
                    .to_string(),
            ],
            teardown: vec!["DROP VIEW IF EXISTS TestMV".to_string()],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };

        let diagnostics = validate_sql_resource(&resource);
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn test_validate_sql_resource_invalid() {
        use crate::framework::core::infrastructure::sql_resource::SqlResource;

        let resource = SqlResource {
            name: "BadMV".to_string(),
            database: None,
            source_file: Some("app/views/bad.ts".to_string()),
            setup: vec![
                "CREATE MATERIALIZED VIEW IF NOT EXISTS BadMV TO Target AS SELCT * FROM Source"
                    .to_string(),
            ],
            teardown: vec!["DROP VIEW IF EXISTS BadMV".to_string()],
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };

        let diagnostics = validate_sql_resource(&resource);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].resource_name, "BadMV");
        assert_eq!(
            diagnostics[0].source_file,
            Some("app/views/bad.ts".to_string())
        );
        assert!(diagnostics[0].message.contains("SELCT"));
    }

    #[test]
    fn test_validate_infrastructure_sql_mixed() {
        use crate::framework::core::infrastructure::sql_resource::SqlResource;
        use std::collections::HashMap;

        let mut sql_resources = HashMap::new();

        // Valid resource
        sql_resources.insert(
            "GoodMV".to_string(),
            SqlResource {
                name: "GoodMV".to_string(),
                database: None,
                source_file: Some("app/views/good.ts".to_string()),
                setup: vec!["CREATE VIEW GoodMV AS SELECT * FROM Source".to_string()],
                teardown: vec!["DROP VIEW IF EXISTS GoodMV".to_string()],
                pulls_data_from: vec![],
                pushes_data_to: vec![],
            },
        );

        // Invalid resource
        sql_resources.insert(
            "BadMV".to_string(),
            SqlResource {
                name: "BadMV".to_string(),
                database: None,
                source_file: Some("app/views/bad.ts".to_string()),
                setup: vec!["CREATE VIEW BadMV AS SELCT * FROM Source".to_string()],
                teardown: vec!["DROP VIEW IF EXISTS BadMV".to_string()],
                pulls_data_from: vec![],
                pushes_data_to: vec![],
            },
        );

        let diagnostics = validate_infrastructure_sql(&sql_resources);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].resource_name, "BadMV");
    }
}
