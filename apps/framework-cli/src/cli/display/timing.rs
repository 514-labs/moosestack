//! Timing utilities for displaying operation elapsed times.
//!
//! This module provides utilities for tracking and displaying elapsed times
//! for operations when the --timing flag is enabled. Times are shown in
//! human-readable format ("finished in 234ms" or "finished in 2.3s").
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
//! When `DisplayConfig.show_timing` is enabled (via the --timing CLI flag), these wrappers will display:
//! ```text
//! Planning finished in 234ms
//! Execution finished in 2.3s
//! ```

use crate::cli::display::{Message, MessageType};
use crate::utilities::display_config::load_display_config;
use std::future::Future;
use std::time::Instant;

/// Wraps a synchronous operation with timing information.
///
/// If `DisplayConfig.show_timing` is enabled (via --timing CLI flag), displays the elapsed time after completion
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
/// // "Database Query finished in 234ms"
/// ```
pub fn with_timing<F, R>(operation_name: &str, f: F) -> R
where
    F: FnOnce() -> R,
{
    let start = Instant::now();
    let result = f();

    if load_display_config().show_timing {
        let elapsed = start.elapsed();
        show_message!(MessageType::Info, {
            Message {
                action: operation_name.to_string(),
                details: format!("finished in {}", humantime::format_duration(elapsed)),
            }
        });
    }

    result
}

/// Wraps an asynchronous operation with timing information.
///
/// If `DisplayConfig.show_timing` is enabled (via --timing CLI flag), displays the elapsed time after completion.
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
/// // "API Call finished in 1.2s"
/// ```
pub async fn with_timing_async<F, R>(operation_name: &str, f: F) -> R
where
    F: Future<Output = R>,
{
    let start = Instant::now();
    let result = f.await;

    if load_display_config().show_timing {
        let elapsed = start.elapsed();
        show_message!(MessageType::Info, {
            Message {
                action: operation_name.to_string(),
                details: format!("finished in {}", humantime::format_duration(elapsed)),
            }
        });
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utilities::display_config::{
        test_utils::TEST_LOCK, update_display_config, DisplayConfig,
    };

    #[test]
    fn test_with_timing_returns_value() {
        let _lock = TEST_LOCK.lock().unwrap();

        update_display_config(DisplayConfig {
            no_ansi: false,
            show_timestamps: false,
            show_timing: false,
        });
        let result = with_timing("Test", || 42);
        assert_eq!(result, 42);
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn test_with_timing_async_returns_value() {
        let _lock = TEST_LOCK.lock().unwrap();

        update_display_config(DisplayConfig {
            no_ansi: false,
            show_timestamps: false,
            show_timing: false,
        });

        // Hold the lock across the await for proper test isolation
        // The future `async { 42 }` resolves immediately, so there's no actual
        // concurrency that would cause deadlock issues (Clippy warning suppressed above)
        let result = with_timing_async("Test", async { 42 }).await;
        assert_eq!(result, 42);
    }
}
