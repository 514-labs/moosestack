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
///
/// User-facing copy for invalid macro names: [`crate::utilities::constants::CLICKHOUSE_MACRO_CLUSTER_NAME_RULES`].
pub fn is_valid_clickhouse_cluster_name(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }

    let mut in_brace = false;
    let mut macro_len = 0;

    for c in name.chars() {
        if c == '{' {
            if in_brace {
                return false; // nested braces not allowed
            }
            in_brace = true;
            macro_len = 0;
        } else if c == '}' {
            if !in_brace || macro_len == 0 {
                return false; // unbalanced or empty braces not allowed
            }
            in_brace = false;
        } else if !c.is_ascii_alphanumeric() && c != '_' && c != '-' {
            return false; // invalid character
        } else if in_brace {
            macro_len += 1;
        }
    }

    if in_brace {
        return false; // unclosed brace
    }

    let first_char = name.chars().next().unwrap();
    if first_char.is_ascii_digit() || first_char == '-' {
        return false;
    }

    true
}

/// Classifies ClickHouse `{macro}` usage in a cluster name for static validation.
///
/// - `None` — no `{` or `}`; treat as a literal cluster name (match against config).
/// - `Some(true)` — macro syntax is present and the full string passes
///   [`is_valid_clickhouse_cluster_name`]; skip config cluster matching.
/// - `Some(false)` — `{` or `}` appears but the string is not a valid macro cluster name
///   (unbalanced braces, empty `{}`, invalid characters, etc.).
pub fn macro_use_legal(name: &str) -> Option<bool> {
    if !name.contains('{') && !name.contains('}') {
        return None;
    }
    Some(is_valid_clickhouse_cluster_name(name))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_clickhouse_cluster_name() {
        // Valid basic names
        assert!(is_valid_clickhouse_cluster_name("my_cluster"));
        assert!(is_valid_clickhouse_cluster_name("cluster-123"));
        assert!(is_valid_clickhouse_cluster_name("c1"));

        // Valid macro names
        assert!(is_valid_clickhouse_cluster_name("{cluster}"));
        assert!(is_valid_clickhouse_cluster_name("{my_cluster}"));
        assert!(is_valid_clickhouse_cluster_name("prefix_{cluster}_suffix"));

        // Invalid basic names
        assert!(!is_valid_clickhouse_cluster_name("")); // empty
        assert!(!is_valid_clickhouse_cluster_name("1cluster")); // starts with digit
        assert!(!is_valid_clickhouse_cluster_name("-cluster")); // starts with hyphen
        assert!(!is_valid_clickhouse_cluster_name("my cluster")); // contains space
        assert!(!is_valid_clickhouse_cluster_name("my@cluster")); // invalid char

        // Invalid macro names
        assert!(!is_valid_clickhouse_cluster_name("{}")); // empty braces
        assert!(!is_valid_clickhouse_cluster_name("{a{b}")); // nested braces
        assert!(!is_valid_clickhouse_cluster_name("}{")); // unbalanced braces
        assert!(!is_valid_clickhouse_cluster_name("{cluster")); // unclosed brace
        assert!(!is_valid_clickhouse_cluster_name("cluster}")); // unopened brace
    }

    #[test]
    fn test_macro_use_legal() {
        assert_eq!(macro_use_legal("my_cluster"), None);
        assert_eq!(macro_use_legal("{cluster}"), Some(true));
        assert_eq!(macro_use_legal("prefix_{cluster}_suffix"), Some(true));
        assert_eq!(macro_use_legal("}{"), Some(false));
        assert_eq!(macro_use_legal("{{a}}"), Some(false));
        assert_eq!(macro_use_legal("{cluster"), Some(false));
        assert_eq!(macro_use_legal("cluster}"), Some(false));
        assert_eq!(macro_use_legal("{}"), Some(false));
    }
}
