//! Runtime environment variable resolution utilities
//!
//! This module handles resolution of environment variable markers in infrastructure configuration.
//! It provides a way to defer configuration resolution until runtime, preventing credentials
//! from being embedded in Docker images or deployment artifacts.
//!
//! # Marker Format
//!
//! Runtime environment variables are marked with the prefix `__MOOSE_RUNTIME_ENV__:` followed
//! by the environment variable name. For example: `__MOOSE_RUNTIME_ENV__:AWS_ACCESS_KEY_ID`
//!
//! # Usage
//!
//! ```rust
//! use framework_cli::utilities::secrets::{resolve_runtime_env, resolve_optional_runtime_env};
//!
//! let marker = "__MOOSE_RUNTIME_ENV__:AWS_ACCESS_KEY_ID";
//! let resolved = resolve_runtime_env(marker)?;
//!
//! let optional_marker = Some("__MOOSE_RUNTIME_ENV__:AWS_SECRET_ACCESS_KEY".to_string());
//! let resolved_optional = resolve_optional_runtime_env(&optional_marker)?;
//! ```

use std::env;

/// Prefix used to mark values that should be resolved from environment variables
pub const MOOSE_RUNTIME_ENV_PREFIX: &str = "__MOOSE_RUNTIME_ENV__:";

/// Legacy prefix for backwards compatibility
#[deprecated(note = "Use MOOSE_RUNTIME_ENV_PREFIX instead")]
pub const MOOSE_ENV_SECRET_PREFIX: &str = "__MOOSE_RUNTIME_ENV__:";

/// Resolves a value that may contain a Moose runtime environment variable marker.
///
/// If the value starts with `__MOOSE_RUNTIME_ENV__:`, extracts the variable name
/// and reads it from the environment at runtime.
///
/// # Arguments
///
/// * `value` - The value to resolve (may be a marker or regular value)
///
/// # Returns
///
/// * `Result<String, RuntimeEnvResolutionError>` - The resolved value
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
/// use framework_cli::utilities::secrets::resolve_runtime_env;
///
/// // With a marker:
/// let value = "__MOOSE_RUNTIME_ENV__:AWS_ACCESS_KEY_ID";
/// let resolved = resolve_runtime_env(value)?;
///
/// // Without a marker (returns as-is):
/// let value = "my-static-value";
/// let resolved = resolve_runtime_env(value)?;
/// assert_eq!(resolved, "my-static-value");
/// ```
pub fn resolve_runtime_env(value: &str) -> Result<String, RuntimeEnvResolutionError> {
    if let Some(env_var_name) = value.strip_prefix(MOOSE_RUNTIME_ENV_PREFIX) {
        if env_var_name.is_empty() {
            return Err(RuntimeEnvResolutionError::EmptyVariableName);
        }

        env::var(env_var_name).map_err(|_| RuntimeEnvResolutionError::VariableNotFound {
            var_name: env_var_name.to_string(),
        })
    } else {
        // Not a marker, return as-is
        Ok(value.to_string())
    }
}

/// Resolves an optional runtime environment variable value.
///
/// This is a convenience wrapper around `resolve_runtime_env` for `Option<String>` values.
///
/// # Arguments
///
/// * `value` - Optional value to resolve
///
/// # Returns
///
/// * `Result<Option<String>, RuntimeEnvResolutionError>` - The resolved optional value
///
/// # Example
///
/// ```rust
/// use framework_cli::utilities::secrets::resolve_optional_runtime_env;
///
/// let value = Some("__MOOSE_RUNTIME_ENV__:MY_VAR".to_string());
/// let resolved = resolve_optional_runtime_env(&value)?;
///
/// let none_value: Option<String> = None;
/// let resolved_none = resolve_optional_runtime_env(&none_value)?;
/// assert!(resolved_none.is_none());
/// ```
pub fn resolve_optional_runtime_env(
    value: &Option<String>,
) -> Result<Option<String>, RuntimeEnvResolutionError> {
    match value {
        Some(v) => Ok(Some(resolve_runtime_env(v)?)),
        None => Ok(None),
    }
}

/// Legacy function for backwards compatibility
#[deprecated(note = "Use resolve_runtime_env instead")]
pub fn resolve_env_secret(value: &str) -> Result<String, RuntimeEnvResolutionError> {
    resolve_runtime_env(value)
}

/// Legacy function for backwards compatibility
#[deprecated(note = "Use resolve_optional_runtime_env instead")]
pub fn resolve_optional_secret(
    value: &Option<String>,
) -> Result<Option<String>, RuntimeEnvResolutionError> {
    resolve_optional_runtime_env(value)
}

/// Errors that can occur during runtime environment variable resolution
#[derive(Debug, thiserror::Error)]
pub enum RuntimeEnvResolutionError {
    /// Environment variable name in the marker is empty
    #[error("Environment variable name in runtime marker cannot be empty")]
    EmptyVariableName,

    /// Environment variable not found in the environment
    #[error(
        "Environment variable '{var_name}' not found. Set this variable before running Moose.\n\
         Example: export {var_name}=\"your-value\""
    )]
    VariableNotFound {
        /// Name of the environment variable that was not found
        var_name: String,
    },
}

/// Legacy type alias for backwards compatibility
#[deprecated(note = "Use RuntimeEnvResolutionError instead")]
pub type SecretResolutionError = RuntimeEnvResolutionError;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_runtime_env_with_marker() {
        // Set a test environment variable
        env::set_var("TEST_RUNTIME_VAR", "test-runtime-value");

        let marker = "__MOOSE_RUNTIME_ENV__:TEST_RUNTIME_VAR";
        let result = resolve_runtime_env(marker);

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "test-runtime-value");

        // Clean up
        env::remove_var("TEST_RUNTIME_VAR");
    }

    #[test]
    fn test_resolve_runtime_env_without_marker() {
        let value = "plain-value";
        let result = resolve_runtime_env(value);

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "plain-value");
    }

    #[test]
    fn test_resolve_runtime_env_missing_variable() {
        // Ensure variable doesn't exist
        env::remove_var("NONEXISTENT_VAR");

        let marker = "__MOOSE_RUNTIME_ENV__:NONEXISTENT_VAR";
        let result = resolve_runtime_env(marker);

        assert!(result.is_err());
        match result {
            Err(RuntimeEnvResolutionError::VariableNotFound { var_name }) => {
                assert_eq!(var_name, "NONEXISTENT_VAR");
            }
            _ => panic!("Expected VariableNotFound error"),
        }
    }

    #[test]
    fn test_resolve_runtime_env_empty_variable_name() {
        let marker = "__MOOSE_RUNTIME_ENV__:";
        let result = resolve_runtime_env(marker);

        assert!(result.is_err());
        assert!(matches!(
            result,
            Err(RuntimeEnvResolutionError::EmptyVariableName)
        ));
    }

    #[test]
    fn test_resolve_optional_runtime_env_some() {
        env::set_var("TEST_OPTIONAL_VAR", "optional-value");

        let value = Some("__MOOSE_RUNTIME_ENV__:TEST_OPTIONAL_VAR".to_string());
        let result = resolve_optional_runtime_env(&value);

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Some("optional-value".to_string()));

        env::remove_var("TEST_OPTIONAL_VAR");
    }

    #[test]
    fn test_resolve_optional_runtime_env_none() {
        let value: Option<String> = None;
        let result = resolve_optional_runtime_env(&value);

        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn test_resolve_optional_runtime_env_plain_value() {
        let value = Some("plain-optional-value".to_string());
        let result = resolve_optional_runtime_env(&value);

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Some("plain-optional-value".to_string()));
    }

    #[test]
    fn test_config_rotation_detection() {
        // Simulate configuration rotation by changing env var value
        env::set_var("ROTATION_TEST_VAR", "old_value");
        let marker = "__MOOSE_RUNTIME_ENV__:ROTATION_TEST_VAR";
        let old_value = resolve_runtime_env(marker).unwrap();

        env::set_var("ROTATION_TEST_VAR", "new_value");
        let new_value = resolve_runtime_env(marker).unwrap();

        // Different values should be returned
        assert_ne!(old_value, new_value);
        assert_eq!(old_value, "old_value");
        assert_eq!(new_value, "new_value");

        env::remove_var("ROTATION_TEST_VAR");
    }
}
