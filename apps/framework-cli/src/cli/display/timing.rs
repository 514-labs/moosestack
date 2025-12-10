//! Timing utilities for displaying operation elapsed times.
//!
//! This module provides utilities for tracking and displaying elapsed times
//! for operations when the --timing flag is enabled. Times are shown in
//! human-readable format ("completed in 234ms" or "completed in 2.3s").
//!
//! # Usage
//!
//! ```rust
//! use crate::cli::display::timing::{with_timing, with_timing_async};
//!
//! // Synchronous operation
//! let result = with_timing("Planning", || {
//!     expensive_operation()
//! });
//!
//! // Asynchronous operation
//! let result = with_timing_async("Execution", async {
//!     async_operation().await
//! }).await;
//! ```
//!
//! When the SHOW_TIMING flag is enabled, these wrappers will display:
//! ```text
//! Planning completed in 234ms
//! Execution completed in 2.3s
//! ```

use crate::cli::display::{Message, MessageType};
use crate::show_message;
use crate::utilities::constants::SHOW_TIMING;
use std::future::Future;
use std::sync::atomic::Ordering;
use std::time::Instant;

/// Format a duration as a human-readable string.
///
/// Formats durations using appropriate units:
/// - Milliseconds (< 1000ms): "234ms"
/// - Seconds (>= 1s): "2.3s" (1 decimal place)
///
/// # Arguments
///
/// * `duration` - The duration to format
///
/// # Returns
///
/// A formatted string like "234ms" or "2.3s"
fn format_duration(duration: std::time::Duration) -> String {
    let millis = duration.as_millis();
    if millis < 1000 {
        format!("{millis}ms")
    } else {
        format!("{:.1}s", duration.as_secs_f64())
    }
}

/// Wraps a synchronous operation with timing information.
///
/// If SHOW_TIMING is enabled, displays the elapsed time after completion
/// using the show_message! macro with Info type.
///
/// # Arguments
///
/// * `operation_name` - Description of the operation (e.g., "Planning")
/// * `f` - The function to execute
///
/// # Returns
///
/// The result of the function execution, unchanged
///
/// # Examples
///
/// ```rust
/// use crate::cli::display::timing::with_timing;
///
/// let result = with_timing("Database Query", || {
///     execute_query()
/// });
/// // If --timing flag is enabled, displays:
/// // "Database Query completed in 234ms"
/// ```
#[allow(dead_code)]
pub fn with_timing<F, R>(operation_name: &str, f: F) -> R
where
    F: FnOnce() -> R,
{
    let start = Instant::now();
    let result = f();

    if SHOW_TIMING.load(Ordering::Relaxed) {
        let elapsed = start.elapsed();
        show_message!(MessageType::Info, {
            Message {
                action: operation_name.to_string(),
                details: format!("completed in {}", format_duration(elapsed)),
            }
        });
    }

    result
}

/// Wraps an asynchronous operation with timing information.
///
/// If SHOW_TIMING is enabled, displays the elapsed time after completion.
/// This is the async version of `with_timing`.
///
/// # Arguments
///
/// * `operation_name` - Description of the operation (e.g., "Planning")
/// * `f` - The async function to execute
///
/// # Returns
///
/// The result of the async function execution, unchanged
///
/// # Examples
///
/// ```rust
/// use crate::cli::display::timing::with_timing_async;
///
/// let result = with_timing_async("API Call", async {
///     make_api_call().await
/// }).await;
/// // If --timing flag is enabled, displays:
/// // "API Call completed in 1.2s"
/// ```
pub async fn with_timing_async<F, R>(operation_name: &str, f: F) -> R
where
    F: Future<Output = R>,
{
    let start = Instant::now();
    let result = f.await;

    if SHOW_TIMING.load(Ordering::Relaxed) {
        let elapsed = start.elapsed();
        show_message!(MessageType::Info, {
            Message {
                action: operation_name.to_string(),
                details: format!("completed in {}", format_duration(elapsed)),
            }
        });
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_duration_milliseconds() {
        let duration = std::time::Duration::from_millis(234);
        assert_eq!(format_duration(duration), "234ms");
    }

    #[test]
    fn test_format_duration_sub_millisecond() {
        let duration = std::time::Duration::from_micros(500);
        assert_eq!(format_duration(duration), "0ms");
    }

    #[test]
    fn test_format_duration_seconds() {
        let duration = std::time::Duration::from_millis(2345);
        assert_eq!(format_duration(duration), "2.3s");
    }

    #[test]
    fn test_format_duration_exact_second() {
        let duration = std::time::Duration::from_millis(1000);
        assert_eq!(format_duration(duration), "1.0s");
    }

    #[test]
    fn test_format_duration_edge_case_999ms() {
        let duration = std::time::Duration::from_millis(999);
        assert_eq!(format_duration(duration), "999ms");
    }

    #[test]
    fn test_format_duration_large() {
        let duration = std::time::Duration::from_secs(65);
        assert_eq!(format_duration(duration), "65.0s");
    }

    #[test]
    fn test_with_timing_returns_value() {
        SHOW_TIMING.store(false, Ordering::Relaxed);
        let result = with_timing("Test", || 42);
        assert_eq!(result, 42);
    }

    #[tokio::test]
    async fn test_with_timing_async_returns_value() {
        SHOW_TIMING.store(false, Ordering::Relaxed);
        let result = with_timing_async("Test", async { 42 }).await;
        assert_eq!(result, 42);
    }
}
