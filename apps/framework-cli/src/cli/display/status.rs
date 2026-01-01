//! Status message formatting utilities
//!
//! Provides consistent status indicators and formatting functions for CLI output.
//! These are used across all commands to provide a uniform user experience.

/// Success status indicator
pub const STATUS_SUCCESS: &str = "✓";

/// Warning status indicator
pub const STATUS_WARNING: &str = "⚠️";

/// Error status indicator
pub const STATUS_ERROR: &str = "✗";

/// Formats a success status message
///
/// # Example
/// ```
/// let msg = format_success("my_table", "created successfully");
/// // Returns: "✓ my_table: created successfully"
/// ```
pub fn format_success(item: &str, message: &str) -> String {
    format!("{} {}: {}", STATUS_SUCCESS, item, message)
}

/// Formats a warning status message
///
/// # Example
/// ```
/// let msg = format_warning("my_table", "schema may differ");
/// // Returns: "⚠️  my_table: schema may differ"
/// ```
pub fn format_warning(item: &str, message: &str) -> String {
    format!("{}  {}: {}", STATUS_WARNING, item, message)
}

/// Formats an error status message
///
/// # Example
/// ```
/// let msg = format_error("my_table", "failed to create");
/// // Returns: "✗ my_table: failed to create"
/// ```
pub fn format_error(item: &str, message: &str) -> String {
    format!("{} {}: {}", STATUS_ERROR, item, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_success() {
        let result = format_success("table1", "created");
        assert_eq!(result, "✓ table1: created");
    }

    #[test]
    fn test_format_warning() {
        let result = format_warning("table2", "warning message");
        assert_eq!(result, "⚠️  table2: warning message");
    }

    #[test]
    fn test_format_error() {
        let result = format_error("table3", "failed");
        assert_eq!(result, "✗ table3: failed");
    }

    #[test]
    fn test_constants() {
        assert_eq!(STATUS_SUCCESS, "✓");
        assert_eq!(STATUS_WARNING, "⚠️");
        assert_eq!(STATUS_ERROR, "✗");
    }
}
