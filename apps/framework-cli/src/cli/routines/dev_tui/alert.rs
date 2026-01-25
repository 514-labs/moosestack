//! Alert modal component for the Dev TUI
//!
//! This module provides alert dialogs for displaying important messages,
//! errors, and confirmations to the user during development mode.

/// Alert severity level
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlertLevel {
    /// Informational message
    #[allow(dead_code)]
    Info,
    /// Warning that requires attention
    #[allow(dead_code)]
    Warning,
    /// Error that may require action
    Error,
}

impl AlertLevel {
    /// Returns the title prefix for this alert level
    #[allow(dead_code)]
    pub fn prefix(&self) -> &'static str {
        match self {
            AlertLevel::Info => "Info",
            AlertLevel::Warning => "Warning",
            AlertLevel::Error => "Error",
        }
    }
}

/// Action that can be taken in response to an alert
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlertAction {
    /// Dismiss the alert and continue
    Dismiss,
    /// Retry the failed operation
    Retry,
    /// Quit the application
    Quit,
}

impl AlertAction {
    /// Returns the display label for this action
    #[allow(dead_code)]
    pub fn label(&self) -> &'static str {
        match self {
            AlertAction::Dismiss => "Dismiss",
            AlertAction::Retry => "Retry",
            AlertAction::Quit => "Quit",
        }
    }
}

/// An alert modal to display to the user
#[derive(Debug, Clone)]
pub struct Alert {
    /// Severity level of the alert
    pub level: AlertLevel,
    /// Title of the alert
    pub title: String,
    /// Main message content
    pub message: String,
    /// Optional additional details (e.g., error details)
    pub details: Option<String>,
    /// Available actions with their labels
    pub actions: Vec<(AlertAction, String)>,
    /// Index of the currently selected action
    pub selected_action: usize,
}

impl Alert {
    /// Creates a new alert with the given properties
    pub fn new(level: AlertLevel, title: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            level,
            title: title.into(),
            message: message.into(),
            details: None,
            actions: vec![(AlertAction::Dismiss, "OK".to_string())],
            selected_action: 0,
        }
    }

    /// Adds details to the alert
    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }

    /// Sets the available actions for this alert
    pub fn with_actions(mut self, actions: Vec<(AlertAction, String)>) -> Self {
        self.actions = actions;
        self.selected_action = 0;
        self
    }

    /// Creates an alert for when Docker is not running
    pub fn docker_not_running() -> Self {
        Self::new(
            AlertLevel::Error,
            "Docker Not Running",
            "The Docker daemon is not running.\n\n\
             Please start Docker Desktop or the Docker\n\
             daemon and try again.",
        )
        .with_actions(vec![
            (AlertAction::Retry, "Retry".to_string()),
            (AlertAction::Quit, "Quit".to_string()),
        ])
    }

    /// Creates an alert for infrastructure timeout
    #[allow(dead_code)]
    pub fn infrastructure_timeout(service: &str) -> Self {
        Self::new(
            AlertLevel::Error,
            "Infrastructure Timeout",
            format!(
                "Timed out waiting for {} to become healthy.\n\n\
                 The service may be starting slowly or there\n\
                 may be a configuration issue.",
                service
            ),
        )
        .with_actions(vec![
            (AlertAction::Retry, "Retry".to_string()),
            (AlertAction::Dismiss, "Continue".to_string()),
            (AlertAction::Quit, "Quit".to_string()),
        ])
    }

    /// Creates an alert for a general infrastructure failure
    pub fn infrastructure_failed(error: &str) -> Self {
        let truncated_error = if error.len() > 200 {
            format!("{}...", &error[..200])
        } else {
            error.to_string()
        };

        Self::new(
            AlertLevel::Error,
            "Infrastructure Failed",
            "Failed to start local infrastructure.",
        )
        .with_details(truncated_error)
        .with_actions(vec![
            (AlertAction::Retry, "Retry".to_string()),
            (AlertAction::Quit, "Quit".to_string()),
        ])
    }

    /// Creates an info alert
    #[allow(dead_code)]
    pub fn info(title: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(AlertLevel::Info, title, message)
    }

    /// Creates a warning alert
    #[allow(dead_code)]
    pub fn warning(title: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(AlertLevel::Warning, title, message)
    }

    /// Creates an error alert
    #[allow(dead_code)]
    pub fn error(title: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(AlertLevel::Error, title, message)
    }

    /// Select the next action
    pub fn select_next(&mut self) {
        if !self.actions.is_empty() {
            self.selected_action = (self.selected_action + 1) % self.actions.len();
        }
    }

    /// Select the previous action
    pub fn select_prev(&mut self) {
        if !self.actions.is_empty() {
            self.selected_action = if self.selected_action == 0 {
                self.actions.len() - 1
            } else {
                self.selected_action - 1
            };
        }
    }

    /// Returns the currently selected action
    pub fn selected(&self) -> Option<AlertAction> {
        self.actions
            .get(self.selected_action)
            .map(|(action, _)| *action)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alert_level_prefix_returns_correct_values() {
        assert_eq!(AlertLevel::Info.prefix(), "Info");
        assert_eq!(AlertLevel::Warning.prefix(), "Warning");
        assert_eq!(AlertLevel::Error.prefix(), "Error");
    }

    #[test]
    fn alert_action_label_returns_correct_values() {
        assert_eq!(AlertAction::Dismiss.label(), "Dismiss");
        assert_eq!(AlertAction::Retry.label(), "Retry");
        assert_eq!(AlertAction::Quit.label(), "Quit");
    }

    #[test]
    fn alert_new_creates_with_defaults() {
        let alert = Alert::new(AlertLevel::Info, "Test Title", "Test message");
        assert_eq!(alert.level, AlertLevel::Info);
        assert_eq!(alert.title, "Test Title");
        assert_eq!(alert.message, "Test message");
        assert!(alert.details.is_none());
        assert_eq!(alert.actions.len(), 1);
        assert_eq!(alert.selected_action, 0);
    }

    #[test]
    fn alert_with_details_adds_details() {
        let alert = Alert::new(AlertLevel::Error, "Error", "Something went wrong")
            .with_details("Stack trace here");
        assert_eq!(alert.details, Some("Stack trace here".to_string()));
    }

    #[test]
    fn alert_with_actions_sets_actions() {
        let alert = Alert::new(AlertLevel::Error, "Error", "Message").with_actions(vec![
            (AlertAction::Retry, "Try Again".to_string()),
            (AlertAction::Quit, "Exit".to_string()),
        ]);
        assert_eq!(alert.actions.len(), 2);
        assert_eq!(alert.actions[0].0, AlertAction::Retry);
        assert_eq!(alert.actions[1].1, "Exit");
    }

    #[test]
    fn alert_docker_not_running_creates_correct_alert() {
        let alert = Alert::docker_not_running();
        assert_eq!(alert.level, AlertLevel::Error);
        assert_eq!(alert.title, "Docker Not Running");
        assert_eq!(alert.actions.len(), 2);
        assert_eq!(alert.actions[0].0, AlertAction::Retry);
        assert_eq!(alert.actions[1].0, AlertAction::Quit);
    }

    #[test]
    fn alert_infrastructure_timeout_includes_service_name() {
        let alert = Alert::infrastructure_timeout("ClickHouse");
        assert!(alert.message.contains("ClickHouse"));
    }

    #[test]
    fn alert_infrastructure_failed_truncates_long_errors() {
        let long_error = "a".repeat(300);
        let alert = Alert::infrastructure_failed(&long_error);
        assert!(alert.details.is_some());
        let details = alert.details.unwrap();
        assert!(details.len() < 250);
        assert!(details.ends_with("..."));
    }

    #[test]
    fn alert_select_next_cycles_through_actions() {
        let mut alert = Alert::new(AlertLevel::Info, "Test", "Message").with_actions(vec![
            (AlertAction::Dismiss, "OK".to_string()),
            (AlertAction::Retry, "Retry".to_string()),
            (AlertAction::Quit, "Quit".to_string()),
        ]);

        assert_eq!(alert.selected_action, 0);
        alert.select_next();
        assert_eq!(alert.selected_action, 1);
        alert.select_next();
        assert_eq!(alert.selected_action, 2);
        alert.select_next();
        assert_eq!(alert.selected_action, 0); // Wraps around
    }

    #[test]
    fn alert_select_prev_cycles_through_actions() {
        let mut alert = Alert::new(AlertLevel::Info, "Test", "Message").with_actions(vec![
            (AlertAction::Dismiss, "OK".to_string()),
            (AlertAction::Retry, "Retry".to_string()),
        ]);

        assert_eq!(alert.selected_action, 0);
        alert.select_prev();
        assert_eq!(alert.selected_action, 1); // Wraps to end
        alert.select_prev();
        assert_eq!(alert.selected_action, 0);
    }

    #[test]
    fn alert_selected_returns_correct_action() {
        let mut alert = Alert::new(AlertLevel::Info, "Test", "Message").with_actions(vec![
            (AlertAction::Dismiss, "OK".to_string()),
            (AlertAction::Retry, "Retry".to_string()),
        ]);

        assert_eq!(alert.selected(), Some(AlertAction::Dismiss));
        alert.select_next();
        assert_eq!(alert.selected(), Some(AlertAction::Retry));
    }

    #[test]
    fn alert_info_creates_info_alert() {
        let alert = Alert::info("Info Title", "Info message");
        assert_eq!(alert.level, AlertLevel::Info);
    }

    #[test]
    fn alert_warning_creates_warning_alert() {
        let alert = Alert::warning("Warning Title", "Warning message");
        assert_eq!(alert.level, AlertLevel::Warning);
    }

    #[test]
    fn alert_error_creates_error_alert() {
        let alert = Alert::error("Error Title", "Error message");
        assert_eq!(alert.level, AlertLevel::Error);
    }
}
