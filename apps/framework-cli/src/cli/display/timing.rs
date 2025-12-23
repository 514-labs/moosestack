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
//! When the SHOW_TIMING flag is enabled, these wrappers will display:
//! ```text
//! Planning finished in 234ms
//! Execution finished in 2.3s
//! ```

use crate::cli::display::{Message, MessageType};
use crate::utilities::constants::SHOW_TIMING;
use std::future::Future;
use std::sync::atomic::Ordering;
use std::time::Instant;

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
/// // "Database Query finished in 234ms"
/// ```
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
                details: format!("finished in {}", humantime::format_duration(elapsed)),
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
/// // "API Call finished in 1.2s"
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
                details: format!("finished in {}", humantime::format_duration(elapsed)),
            }
        });
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

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
