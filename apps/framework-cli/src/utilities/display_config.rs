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
//! use crate::utilities::display_config::load_display_config;
//!
//! // Load the current configuration
//! let config = load_display_config();
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
//! use crate::utilities::display_config::{update_display_config, DisplayConfig};
//!
//! let new_config = DisplayConfig {
//!     no_ansi: true,
//!     show_timestamps: false,
//!     show_timing: true,
//! };
//!
//! update_display_config(new_config);
//! ```
//!
//! # References
//!
//! - [arc-swap documentation](https://docs.rs/arc-swap/latest/arc_swap/)
//! - [Kill All Setters pattern](https://blog.sentry.io/you-cant-rust-that/#kill-all-setters-2)

use std::sync::Arc;

use arc_swap::ArcSwap;
use lazy_static::lazy_static;

/// Display configuration flags for terminal output.
///
/// This struct is designed to be cheap to copy and is typically
/// wrapped in an Arc for sharing across threads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
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
    static ref DISPLAY_CONFIG: ArcSwap<DisplayConfig> = ArcSwap::from_pointee(DisplayConfig {
        no_ansi: false,
        show_timestamps: false,
        show_timing: false,
    });
}

/// Loads the current display configuration.
///
/// Returns an Arc-guarded reference to the current configuration.
/// This is very cheap (atomic pointer load + refcount increment).
///
/// # Example
///
/// ```rust
/// use crate::utilities::display_config::load_display_config;
///
/// let config = load_display_config();
/// if config.show_timing {
///     // Show timing information
/// }
/// ```
pub fn load_display_config() -> Arc<DisplayConfig> {
    DISPLAY_CONFIG.load_full()
}

/// Updates the display configuration atomically.
///
/// This should typically only be called once at startup based on CLI flags
/// or environment variables.
///
/// # Example
///
/// ```rust
/// use crate::utilities::display_config::{update_display_config, DisplayConfig};
///
/// update_display_config(DisplayConfig {
///     no_ansi: true,
///     show_timestamps: false,
///     show_timing: true,
/// });
/// ```
pub fn update_display_config(config: DisplayConfig) {
    DISPLAY_CONFIG.store(Arc::new(config));
}
