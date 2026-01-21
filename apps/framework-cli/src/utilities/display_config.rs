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
//! ```rust,no_run
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
//! ```rust,no_run
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

use arc_swap::ArcSwapOption;

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

    /// When true, prepend ISO 8601 timestamps to all output lines
    /// (e.g., "2024-01-15T10:30:45.123Z").
    /// Useful for debugging and correlating events across different runs.
    pub show_timestamps: bool,

    /// When true, show elapsed time for operations (e.g., "finished in 234ms").
    /// Helps identify performance bottlenecks during development.
    pub show_timing: bool,
}

/// Global display configuration using arc-swap for lock-free atomic access.
///
/// Initialized as empty and set at startup based on CLI flags or environment variables.
/// If not set, defaults are used on access.
///
/// # Performance
///
/// Loading this config is very cheap:
/// - No locks acquired
/// - Atomic pointer load
/// - Reference count increment
/// - Fallback to default if None (cheap clone of Copy type)
///
/// The loaded Arc can be held for the duration of an operation to ensure
/// consistent configuration throughout.
static DISPLAY_CONFIG: ArcSwapOption<DisplayConfig> = ArcSwapOption::const_empty();

/// Loads the current display configuration.
///
/// Returns an Arc-guarded reference to the current configuration.
/// If no configuration has been set, returns the default configuration.
/// This is very cheap (atomic pointer load + refcount increment).
///
/// # Example
///
/// ```rust,no_run
/// use crate::utilities::display_config::load_display_config;
///
/// let config = load_display_config();
/// if config.show_timing {
///     // Show timing information
/// }
/// ```
pub fn load_display_config() -> Arc<DisplayConfig> {
    DISPLAY_CONFIG
        .load_full()
        .unwrap_or_else(|| Arc::new(DisplayConfig::default()))
}

/// Updates the display configuration atomically.
///
/// This should typically only be called once at startup based on CLI flags
/// or environment variables.
///
/// # Example
///
/// ```rust,no_run
/// use crate::utilities::display_config::{update_display_config, DisplayConfig};
///
/// update_display_config(DisplayConfig {
///     no_ansi: true,
///     show_timestamps: false,
///     show_timing: true,
/// });
/// ```
pub fn update_display_config(config: DisplayConfig) {
    DISPLAY_CONFIG.store(Some(Arc::new(config)));
}

#[cfg(test)]
pub(crate) mod test_utils {
    use std::sync::Mutex;

    // Shared mutex to serialize ALL tests that modify global DISPLAY_CONFIG
    // This prevents tests from interfering with each other when running in parallel,
    // even across different test modules (display_config, timing, mod, etc.)
    pub static TEST_LOCK: Mutex<()> = Mutex::new(());
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_utils::TEST_LOCK;

    // Unit tests for DisplayConfig struct (no global state, no lock needed)

    #[test]
    fn test_display_config_default() {
        let config = DisplayConfig::default();
        assert!(!config.no_ansi);
        assert!(!config.show_timestamps);
        assert!(!config.show_timing);
    }

    #[test]
    fn test_display_config_clone() {
        let config1 = DisplayConfig {
            no_ansi: true,
            show_timestamps: true,
            show_timing: false,
        };
        let config2 = config1;
        assert_eq!(config1, config2);
    }

    #[test]
    fn test_display_config_equality() {
        let config1 = DisplayConfig {
            no_ansi: true,
            show_timestamps: false,
            show_timing: true,
        };
        let config2 = DisplayConfig {
            no_ansi: true,
            show_timestamps: false,
            show_timing: true,
        };
        assert_eq!(config1, config2);
    }

    #[test]
    fn test_display_config_inequality() {
        let config1 = DisplayConfig {
            no_ansi: true,
            show_timestamps: false,
            show_timing: false,
        };
        let config2 = DisplayConfig {
            no_ansi: false,
            show_timestamps: false,
            show_timing: false,
        };
        assert_ne!(config1, config2);
    }

    // Integration tests for global state (minimal, needs lock)

    #[test]
    fn test_global_load_and_update() {
        let _lock = TEST_LOCK.lock().unwrap();

        // Test that update and load work together
        let config = DisplayConfig {
            no_ansi: true,
            show_timestamps: true,
            show_timing: false,
        };

        update_display_config(config);
        let loaded = load_display_config();
        assert_eq!(*loaded, config);

        // Cleanup: restore default config to prevent test leakage
        update_display_config(DisplayConfig::default());
    }

    #[test]
    fn test_global_multiple_updates() {
        let _lock = TEST_LOCK.lock().unwrap();

        // Test that updates replace previous values atomically
        update_display_config(DisplayConfig {
            no_ansi: true,
            show_timestamps: false,
            show_timing: false,
        });
        let config1 = load_display_config();
        assert!(config1.no_ansi);
        assert!(!config1.show_timestamps);
        assert!(!config1.show_timing);

        update_display_config(DisplayConfig {
            no_ansi: false,
            show_timestamps: true,
            show_timing: true,
        });
        let config2 = load_display_config();
        assert!(!config2.no_ansi);
        assert!(config2.show_timestamps);
        assert!(config2.show_timing);

        // Cleanup: restore default config to prevent test leakage
        update_display_config(DisplayConfig::default());
    }
}
