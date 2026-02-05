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
/// - Contain only alphanumeric characters and underscores
/// - Not start with a digit
///
/// This prevents SQL/XML injection and ensures compatibility with ClickHouse's naming rules.
/// Used by both the ClickHouse client and Docker utilities.
pub fn is_valid_clickhouse_identifier(name: &str) -> bool {
    !name.is_empty()
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !name.chars().next().unwrap().is_ascii_digit()
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
    } else {
        "contains invalid characters (only alphanumeric and underscore allowed)"
    };

    Err(ClickhouseError::InvalidIdentifier {
        identifier_type: identifier_type.to_string(),
        name: name.to_string(),
        reason: reason.to_string(),
    })
}
