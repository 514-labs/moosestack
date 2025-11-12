#[derive(Debug, thiserror::Error)]
pub enum TemporalExecutionError {
    #[error("Temportal connection error: {0}")]
    TemporalConnectionError(#[from] tonic::transport::Error),

    #[error("Temportal client error: {0}")]
    TemporalClientError(String),

    #[error("Timeout error: {0}")]
    TimeoutError(String),
}

/// Parses various schedule formats into a valid Temporal cron expression
///
/// # Arguments
/// * `schedule` - Optional string containing the schedule format
///
/// # Returns
/// A String containing the parsed cron expression or empty string if invalid
///
/// # Formats Supported
/// * Standard cron expressions (e.g., "* * * * *")
/// * Interval notation (e.g., "*/5 * * * *")
/// * Simple duration formats:
///   - "5m" → "*/5 * * * *" (every 5 minutes)
///   - "2h" → "0 */2 * * *" (every 2 hours)
///
/// Falls back to empty string (no schedule) if format is invalid
pub fn parse_schedule(schedule: &str) -> String {
    if schedule.is_empty() {
        return String::new();
    }

    match schedule {
        // Handle interval-based formats
        s if s.contains('/') => s.to_string(),
        // Handle standard cron expressions
        s if s.contains('*') || s.contains(' ') => s.to_string(),
        // Convert simple duration to cron (e.g., "5m" -> "*/5 * * * *")
        s if s.ends_with('m') => {
            let mins = s.trim_end_matches('m');
            format!("*/{mins} * * * *")
        }
        s if s.ends_with('h') => {
            let hours = s.trim_end_matches('h');
            format!("0 */{hours} * * *")
        }
        // Default to original string if format is unrecognized
        s => s.to_string(),
    }
}

pub fn parse_timeout_to_seconds(timeout: &str) -> Result<i64, TemporalExecutionError> {
    if timeout.is_empty() {
        return Err(TemporalExecutionError::TimeoutError(
            "Timeout string is empty".to_string(),
        ));
    }

    // Use character-aware slicing to handle multi-byte UTF-8 characters correctly
    let unit_char = timeout
        .chars()
        .last()
        .ok_or_else(|| TemporalExecutionError::TimeoutError("Timeout string is empty".to_string()))?;

    // Get the byte index where the last character starts
    let value_str = &timeout[..timeout.len() - unit_char.len_utf8()];

    let value: u64 = value_str
        .parse()
        .map_err(|_| TemporalExecutionError::TimeoutError("Invalid number format".to_string()))?;

    let seconds = match unit_char {
        'h' => value * 3600,
        'm' => value * 60,
        's' => value,
        _ => {
            return Err(TemporalExecutionError::TimeoutError(
                "Invalid time unit. Must be h, m, or s for hours, minutes, or seconds respectively"
                    .to_string(),
            ))
        }
    };

    Ok(seconds as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        /// Test that parse_schedule never panics on arbitrary strings
        #[test]
        fn test_parse_schedule_never_panics(s in "\\PC{0,100}") {
            let _ = parse_schedule(&s);
            // If we reach here, the function didn't panic
        }

        /// Test that parse_timeout_to_seconds never panics on arbitrary strings
        /// FIXED: Now uses character-aware slicing instead of byte-level split_at
        #[test]
        fn test_parse_timeout_never_panics(s in "\\PC{0,100}") {
            let _ = parse_timeout_to_seconds(&s);
            // If we reach here, the function didn't panic
        }

        /// Test that valid timeout formats always parse successfully
        #[test]
        fn test_timeout_valid_formats(
            value in 1u64..1000,
            unit in prop_oneof![Just("h"), Just("m"), Just("s")],
        ) {
            let timeout = format!("{}{}", value, unit);
            let result = parse_timeout_to_seconds(&timeout);

            prop_assert!(result.is_ok(), "Failed to parse valid timeout '{}'", timeout);

            let seconds = result.unwrap();
            let expected = match unit {
                "h" => (value * 3600) as i64,
                "m" => (value * 60) as i64,
                "s" => value as i64,
                _ => unreachable!(),
            };

            prop_assert_eq!(seconds, expected, "Incorrect conversion for '{}'", timeout);
        }

        /// Test that schedule formats with 'm' suffix produce valid cron expressions
        #[test]
        fn test_schedule_minutes_format(mins in 1u32..60) {
            let schedule = format!("{}m", mins);
            let result = parse_schedule(&schedule);

            prop_assert_eq!(result, format!("*/{} * * * *", mins));
        }

        /// Test that schedule formats with 'h' suffix produce valid cron expressions
        #[test]
        fn test_schedule_hours_format(hours in 1u32..24) {
            let schedule = format!("{}h", hours);
            let result = parse_schedule(&schedule);

            prop_assert_eq!(result, format!("0 */{} * * *", hours));
        }

        /// Test that cron expressions are preserved
        #[test]
        fn test_schedule_cron_preserved(expr in "[0-9*/]+ [0-9*/]+ [0-9*/]+ [0-9*/]+ [0-9*/]+") {
            let result = parse_schedule(&expr);
            prop_assert_eq!(result, expr, "Cron expression should be preserved");
        }
    }

    // =========================================================
    // Regression Tests for Specific Bugs
    // These are marked with #[ignore] until the bugs are fixed
    // Each bug fix should be a separate commit/change
    // =========================================================

    /// Regression test for Issue #2: parse_timeout_to_seconds Panics on Multi-byte UTF-8
    /// See PROPTEST_FINDINGS.md for details
    ///
    /// FIXED: Now uses character-aware slicing with .chars().last() and .len_utf8()
    #[test]
    fn test_regression_timeout_multibyte_utf8() {
        // This currently panics: byte index 1 is not a char boundary
        let result = parse_timeout_to_seconds("®");
        assert!(result.is_err(), "Should return error for invalid timeout format");
    }
}
