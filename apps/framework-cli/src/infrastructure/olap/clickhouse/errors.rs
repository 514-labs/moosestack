#[derive(Debug, thiserror::Error)]
#[error("failed interact with clickhouse")]
#[non_exhaustive]
pub enum ClickhouseError {
    #[error("Clickhouse - Unsupported data type: {type_name}")]
    UnsupportedDataType {
        type_name: String,
    },
    #[error("Clickhouse - Invalid parameters: {message}")]
    InvalidParameters {
        message: String,
    },
    #[error("Clickhouse - Invalid {identifier_type}: '{name}' - {reason}")]
    InvalidIdentifier {
        identifier_type: String,
        name: String,
        reason: String,
    },
    QueryRender(#[from] handlebars::RenderError),
}

/// Checks if a string is a valid ClickHouse identifier.
///
/// ClickHouse identifiers (database names, table names, cluster names, etc.) must:
/// - Be non-empty
/// - Contain only alphanumeric characters, underscores, and hyphens
/// - Not start with a digit
///
/// Hyphens are allowed because cloud-hosted ClickHouse instances commonly use
/// hyphenated database names (e.g. `my-project-db-main`). All SQL queries use
/// backtick quoting (`\`name\``) to handle these safely.
///
/// This prevents SQL/XML injection and ensures compatibility with ClickHouse's naming rules.
/// Used by both the ClickHouse client and Docker utilities.
pub fn is_valid_clickhouse_identifier(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        && !name.chars().next().unwrap().is_ascii_digit()
        && !name.starts_with('-')
}

/// Checks if a string is a valid ClickHouse cluster name.
/// Allows `{` and `}` for macro patterns like `{cluster}`.
pub fn is_valid_clickhouse_cluster_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '{' || c == '}')
        && !name.chars().next().unwrap().is_ascii_digit()
        && !name.starts_with('-')
}

/// Validates a cluster name, allowing ClickHouse macro patterns like `{cluster}`.
pub fn validate_clickhouse_cluster_name(name: &str) -> Result<(), ClickhouseError> {
    if is_valid_clickhouse_cluster_name(name) {
        return Ok(());
    }
    Err(ClickhouseError::InvalidIdentifier {
        identifier_type: "Cluster name".to_string(),
        name: name.to_string(),
        reason: "contains invalid characters (only alphanumeric, underscore, hyphen, and {} for macros allowed)".to_string(),
    })
}

/// Validates that a string is a valid ClickHouse identifier, returning a typed error on failure.
///
/// This delegates to `is_valid_clickhouse_identifier` for the boolean check and only
/// constructs a detailed error message when validation fails.
pub fn validate_clickhouse_identifier(
    name: &str,
    identifier_type: &str,
) -> Result<(), ClickhouseError> {
    if is_valid_clickhouse_identifier(name) {
        return Ok(());
    }

    // Determine the specific reason for failure to provide a helpful error message
    let reason = if name.is_empty() {
        "cannot be empty"
    } else if name.chars().next().unwrap().is_ascii_digit() {
        "cannot start with a digit"
    } else if name.starts_with('-') {
        "cannot start with a hyphen"
    } else {
        "contains invalid characters (only alphanumeric, underscore, and hyphen allowed)"
    };

    Err(ClickhouseError::InvalidIdentifier {
        identifier_type: identifier_type.to_string(),
        name: name.to_string(),
        reason: reason.to_string(),
    })
}

/// Validates that a SQL expression does not contain characters that could enable SQL injection
/// when the expression is interpolated directly into a query string.
///
/// Rejects semicolons (statement terminators) and comment markers (`--`, `/*`, `*/`) since
/// these can be used to escape the intended expression context even when the expression is
/// wrapped in parentheses by the caller.
pub fn validate_clickhouse_expression(
    expression: &str,
    expression_type: &str,
) -> Result<(), ClickhouseError> {
    const FORBIDDEN: &[(&str, &str)] = &[
        (";", "semicolons are not allowed in expressions"),
        (
            "--",
            "SQL line comment markers (--) are not allowed in expressions",
        ),
        (
            "/*",
            "SQL block comment openers (/*) are not allowed in expressions",
        ),
        (
            "*/",
            "SQL block comment closers (*/) are not allowed in expressions",
        ),
    ];

    for (pattern, reason) in FORBIDDEN {
        if expression.contains(pattern) {
            return Err(ClickhouseError::InvalidIdentifier {
                identifier_type: expression_type.to_string(),
                name: expression.to_string(),
                reason: reason.to_string(),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_expression_accepts_valid() {
        assert!(validate_clickhouse_expression("len(col) <= 32", "test").is_ok());
        assert!(validate_clickhouse_expression("col IN (1, 2, 3)", "test").is_ok());
        assert!(validate_clickhouse_expression("isNotNull(col)", "test").is_ok());
    }

    #[test]
    fn test_validate_expression_rejects_semicolon() {
        assert!(validate_clickhouse_expression("col = 1; DROP TABLE foo", "test").is_err());
    }

    #[test]
    fn test_validate_expression_rejects_line_comment() {
        assert!(validate_clickhouse_expression("col = 1 -- bypass", "test").is_err());
    }

    #[test]
    fn test_validate_expression_rejects_block_comment_open() {
        assert!(validate_clickhouse_expression("col = 1 /* inject", "test").is_err());
    }

    #[test]
    fn test_validate_expression_rejects_block_comment_close() {
        assert!(validate_clickhouse_expression("*/ UNION SELECT 1", "test").is_err());
    }
}
