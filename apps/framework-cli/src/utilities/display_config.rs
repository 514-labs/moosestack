//! Display configuration management using arc-swap for lock-free atomic access.
//!
//! This module consolidates display-related configuration flags into a single
//! immutable struct that can be atomically swapped. This follows the "Kill All
//! Setters" pattern for managing global configuration in concurrent contexts.
//!
//! # Design Rationale
//!
//! Using `arc-swap` instead of `Arc<RwLock<DisplayConfig>>` provides:
//! - **Lock-free reads**: No contention on the read path (critical for display operations)
//! - **Atomic consistency**: All configuration values loaded together atomically
//! - **Better performance**: Faster than RwLock for read-heavy workloads
//! - **Write-once pattern**: Config set at startup, read many times during execution
//!
//! # Usage
//!
//! ```rust
//! use crate::utilities::display_config::DISPLAY_CONFIG;
//!
//! // Load the current configuration
//! let config = DISPLAY_CONFIG.load();
//!
//! // Access individual fields
//! if config.no_ansi {
//!     // Skip ANSI color codes
//! }
//! if config.show_timestamps {
//!     // Prepend timestamps
//! }
//! if config.show_timing {
//!     // Show operation timing
//! }
//! ```
//!
//! # Updating Configuration
//!
//! Configuration is typically set once at startup:
//!
//! ```rust
//! use std::sync::Arc;
//! use crate::utilities::display_config::{DISPLAY_CONFIG, DisplayConfig};
//!
//! let new_config = DisplayConfig {
//!     no_ansi: true,
//!     show_timestamps: false,
//!     show_timing: true,
//! };
//!
//! DISPLAY_CONFIG.store(Arc::new(new_config));
//! ```
//!
//! # References
//!
//! - [arc-swap documentation](https://docs.rs/arc-swap/latest/arc_swap/)
//! - [Kill All Setters pattern](https://blog.sentry.io/you-cant-rust-that/#kill-all-setters-2)

use arc_swap::ArcSwap;
use lazy_static::lazy_static;

/// Display configuration flags for terminal output.
///
/// This struct is designed to be cheap to copy (3 bytes) and is typically
/// wrapped in an Arc for sharing across threads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DisplayConfig {
    /// When true, disable ANSI escape codes in terminal output.
    /// This is useful for environments that don't support ANSI colors
    /// or when output is redirected to files.
    pub no_ansi: bool,

    /// When true, prepend HH:MM:SS.mmm timestamps to all output lines.
    /// Useful for debugging and correlating events across different runs.
    pub show_timestamps: bool,

    /// When true, show elapsed time for operations (e.g., "finished in 234ms").
    /// Helps identify performance bottlenecks during development.
    pub show_timing: bool,
}

impl Default for DisplayConfig {
    fn default() -> Self {
        Self {
            no_ansi: false,
            show_timestamps: false,
            show_timing: false,
        }
    }
}

lazy_static! {
    /// Global display configuration using arc-swap for lock-free atomic access.
    ///
    /// This is initialized with default values and should be updated once at
    /// startup based on CLI flags or environment variables.
    ///
    /// # Performance
    ///
    /// Loading this config is very cheap:
    /// - No locks acquired
    /// - Atomic pointer load
    /// - Reference count increment
    ///
    /// The loaded Arc can be held for the duration of an operation to ensure
    /// consistent configuration throughout.
    pub static ref DISPLAY_CONFIG: ArcSwap<DisplayConfig> = ArcSwap::from_pointee(DisplayConfig {
        no_ansi: false,
        show_timestamps: false,
        show_timing: false,
    });
}
