//! Dev TUI - Interactive Terminal User Interface for Moose development mode
//!
//! This module provides a rich terminal interface for monitoring and debugging
//! Moose applications during development. Inspired by k9s and lazygit.

pub mod alert;
mod app;
mod event;
mod handler;
pub mod infra_status;
pub mod log_collector;
pub mod resource_panel;
#[cfg(test)]
mod testable_tui;
mod tui;
mod ui;

/// Result type for Dev TUI operations
#[allow(dead_code)] // TODO(PR5): Remove once entry points use this
pub type DevTuiResult<T> = std::result::Result<T, Box<dyn std::error::Error>>;

/// Test utilities for the dev_tui module
#[cfg(test)]
pub(crate) mod test_utils {
    use super::app::*;
    use crate::framework::languages::SupportedLanguages;
    use crate::project::Project;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use std::path::Path;
    use std::sync::Arc;

    /// Creates a mock Project for testing
    ///
    /// Uses the project's test directory which must exist for canonicalize to work.
    pub fn mock_project() -> Arc<Project> {
        // Create a temp directory that will live for the duration of the test
        let temp_dir = std::env::temp_dir();
        Arc::new(Project::new(
            Path::new(&temp_dir),
            "test-project".to_string(),
            SupportedLanguages::Typescript,
        ))
    }

    /// Creates a DevTuiApp with test defaults
    pub fn test_app() -> DevTuiApp {
        DevTuiApp::new(mock_project())
    }

    /// Creates app with pre-populated logs using fixed timestamps for deterministic tests
    pub fn test_app_with_logs(count: usize) -> DevTuiApp {
        use chrono::TimeZone;

        let mut app = test_app();
        // Use a fixed base timestamp for deterministic snapshots
        let base_time = chrono::Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        for i in 0..count {
            let timestamp = base_time + chrono::Duration::seconds(i as i64);
            app.logs.push(LogEntry {
                timestamp,
                source: LogSource::System,
                level: LogLevel::Info,
                message: format!("Test message {}", i),
            });
        }
        app
    }

    /// Helper to create KeyEvent with no modifiers
    pub fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::empty())
    }

    /// Helper to create KeyEvent with CONTROL modifier
    pub fn ctrl_key(c: char) -> KeyEvent {
        KeyEvent::new(KeyCode::Char(c), KeyModifiers::CONTROL)
    }
}
