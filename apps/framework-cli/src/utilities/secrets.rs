//! Runtime secret resolution utilities
//!
//! This module handles resolution of environment variable markers in infrastructure configuration.
//! It provides a secure way to defer secret resolution until runtime, preventing credentials
//! from being embedded in Docker images or deployment artifacts.
//!
//! # Marker Format
//!
//! Secrets are marked with the prefix `__MOOSE_ENV_SECRET__:` followed by the environment
//! variable name. For example: `__MOOSE_ENV_SECRET__:AWS_ACCESS_KEY_ID`
//!
//! # Usage
//!
//! ```rust
//! use framework_cli::utilities::secrets::{resolve_env_secret, resolve_optional_secret};
//!
//! let marker = "__MOOSE_ENV_SECRET__:AWS_ACCESS_KEY_ID";
//! let resolved = resolve_env_secret(marker)?;
//!
//! let optional_marker = Some("__MOOSE_ENV_SECRET__:AWS_SECRET_KEY".to_string());
//! let resolved_optional = resolve_optional_secret(&optional_marker)?;
//! ```

use std::env;

/// Prefix used to mark values that should be resolved from environment variables
pub const MOOSE_ENV_SECRET_PREFIX: &str = "__MOOSE_ENV_SECRET__:";

/// Resolves a value that may contain a Moose environment secret marker.
///
/// If the value starts with `__MOOSE_ENV_SECRET__:`, extracts the variable name
/// and reads it from the environment at runtime.
///
/// # Arguments
///
/// * `value` - The value to resolve (may be a marker or regular value)
///
/// # Returns
///
/// * `Result<String, SecretResolutionError>` - The resolved value
///
/// # Errors
///
/// Returns error if:
/// - Marker format is invalid (empty variable name)
/// - Environment variable is not set
///
/// # Example
///
/// ```rust
/// use framework_cli::utilities::secrets::resolve_env_secret;
///
/// // With a marker:
/// let value = "__MOOSE_ENV_SECRET__:AWS_ACCESS_KEY_ID";
/// let resolved = resolve_env_secret(value)?;
///
/// // Without a marker (returns as-is):
/// let value = "my-static-value";
/// let resolved = resolve_env_secret(value)?;
/// assert_eq!(resolved, "my-static-value");
/// ```
pub fn resolve_env_secret(value: &str) -> Result<String, SecretResolutionError> {
    if let Some(env_var_name) = value.strip_prefix(MOOSE_ENV_SECRET_PREFIX) {
        if env_var_name.is_empty() {
            return Err(SecretResolutionError::EmptyVariableName);
        }

        env::var(env_var_name).map_err(|_| SecretResolutionError::VariableNotFound {
            var_name: env_var_name.to_string(),
        })
    } else {
        // Not a marker, return as-is
        Ok(value.to_string())
    }
}

/// Resolves an optional secret value.
///
/// This is a convenience wrapper around `resolve_env_secret` for `Option<String>` values.
///
/// # Arguments
///
/// * `value` - Optional value to resolve
///
/// # Returns
///
/// * `Result<Option<String>, SecretResolutionError>` - The resolved optional value
///
/// # Example
///
/// ```rust
/// use framework_cli::utilities::secrets::resolve_optional_secret;
///
/// let value = Some("__MOOSE_ENV_SECRET__:MY_VAR".to_string());
/// let resolved = resolve_optional_secret(&value)?;
///
/// let none_value: Option<String> = None;
/// let resolved_none = resolve_optional_secret(&none_value)?;
/// assert!(resolved_none.is_none());
/// ```
pub fn resolve_optional_secret(
    value: &Option<String>,
) -> Result<Option<String>, SecretResolutionError> {
    match value {
        Some(v) => Ok(Some(resolve_env_secret(v)?)),
        None => Ok(None),
    }
}

/// Errors that can occur during secret resolution
#[derive(Debug, thiserror::Error)]
pub enum SecretResolutionError {
    /// Environment variable name in the marker is empty
    #[error("Environment variable name in secret marker cannot be empty")]
    EmptyVariableName,

    /// Environment variable not found in the environment
    #[error(
        "Environment variable '{var_name}' not found. Set this variable before running Moose.\n\
         Example: export {var_name}=\"your-secret-value\""
    )]
    VariableNotFound {
        /// Name of the environment variable that was not found
        var_name: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_env_secret_with_marker() {
        // Set a test environment variable
        env::set_var("TEST_SECRET_VAR", "test-secret-value");

        let marker = "__MOOSE_ENV_SECRET__:TEST_SECRET_VAR";
        let result = resolve_env_secret(marker);

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "test-secret-value");

        // Clean up
        env::remove_var("TEST_SECRET_VAR");
    }

    #[test]
    fn test_resolve_env_secret_without_marker() {
        let value = "plain-value";
        let result = resolve_env_secret(value);

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "plain-value");
    }

    #[test]
    fn test_resolve_env_secret_missing_variable() {
        // Ensure variable doesn't exist
        env::remove_var("NONEXISTENT_VAR");

        let marker = "__MOOSE_ENV_SECRET__:NONEXISTENT_VAR";
        let result = resolve_env_secret(marker);

        assert!(result.is_err());
        match result {
            Err(SecretResolutionError::VariableNotFound { var_name }) => {
                assert_eq!(var_name, "NONEXISTENT_VAR");
            }
            _ => panic!("Expected VariableNotFound error"),
        }
    }

    #[test]
    fn test_resolve_env_secret_empty_variable_name() {
        let marker = "__MOOSE_ENV_SECRET__:";
        let result = resolve_env_secret(marker);

        assert!(result.is_err());
        assert!(matches!(
            result,
            Err(SecretResolutionError::EmptyVariableName)
        ));
    }

    #[test]
    fn test_resolve_optional_secret_some() {
        env::set_var("TEST_OPTIONAL_VAR", "optional-value");

        let value = Some("__MOOSE_ENV_SECRET__:TEST_OPTIONAL_VAR".to_string());
        let result = resolve_optional_secret(&value);

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Some("optional-value".to_string()));

        env::remove_var("TEST_OPTIONAL_VAR");
    }

    #[test]
    fn test_resolve_optional_secret_none() {
        let value: Option<String> = None;
        let result = resolve_optional_secret(&value);

        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn test_resolve_optional_secret_plain_value() {
        let value = Some("plain-optional-value".to_string());
        let result = resolve_optional_secret(&value);

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Some("plain-optional-value".to_string()));
    }

    #[test]
    fn test_credential_rotation_detection() {
        // Simulate credential rotation by changing env var value
        env::set_var("ROTATION_TEST_VAR", "old_credential");
        let marker = "__MOOSE_ENV_SECRET__:ROTATION_TEST_VAR";
        let old_value = resolve_env_secret(marker).unwrap();

        env::set_var("ROTATION_TEST_VAR", "new_credential");
        let new_value = resolve_env_secret(marker).unwrap();

        // Different values should be returned
        assert_ne!(old_value, new_value);
        assert_eq!(old_value, "old_credential");
        assert_eq!(new_value, "new_credential");

        env::remove_var("ROTATION_TEST_VAR");
    }
}
