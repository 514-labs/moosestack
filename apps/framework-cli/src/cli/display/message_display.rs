//! Message display functionality and macros.
//!
//! This module provides the core message display functionality including
//! the show_message macro and related display functions for CLI output.

use super::{
    message::{Message, MessageType},
    terminal::{write_styled_line, StyledText},
};
use crate::utilities::constants::NO_ANSI;
use std::sync::atomic::Ordering;
use tracing::info;

/// Displays a message about a batch database insertion.
///
/// This function provides standardized messaging for database operations,
/// showing the number of rows inserted and the target table name.
///
/// # Arguments
///
/// * `count` - The number of rows successfully inserted
/// * `table_name` - The name of the database table
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::message_display::batch_inserted;
/// batch_inserted(150, "user_events");
/// // Displays: "[DB] 150 row(s) successfully written to DB table (user_events)"
/// ```
pub fn batch_inserted(count: usize, table_name: &str) {
    let message = Message {
        action: "[DB]".to_string(),
        details: format!("{count} row(s) successfully written to DB table ({table_name})"),
    };
    let no_ansi = NO_ANSI.load(Ordering::Relaxed);
    let _ = show_message_impl(MessageType::Info, message, true, no_ansi);
}

/// Wrapper function for the show_message macro.
///
/// This function allows calling the show_message functionality from contexts
/// where macros cannot be used directly. Messages displayed through this
/// function are not logged to avoid potential recursion in logging contexts.
///
/// # Arguments
///
/// * `message_type` - The type of message to display
/// * `message` - The message to display
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::message_display::show_message_wrapper;
/// # use crate::cli::display::message::{MessageType, Message};
/// show_message_wrapper(
///     MessageType::Error,
///     Message::new("Failed".to_string(), "Operation could not be completed".to_string())
/// );
/// ```
pub fn show_message_wrapper(message_type: MessageType, message: Message) {
    let no_ansi = NO_ANSI.load(Ordering::Relaxed);
    let _ = show_message_impl(message_type, message, false, no_ansi);
}

/// Internal implementation for the show_message macro.
///
/// This function handles the actual display logic for messages, including
/// styling based on message type and optional logging.
///
/// # Arguments
///
/// * `message_type` - The type of message determining visual style
/// * `message` - The message to display
/// * `should_log` - Whether to log the message
/// * `no_ansi` - If true, disable ANSI color codes and formatting
///
/// # Returns
///
/// `Ok(())` on success, or an IO error if terminal operations fail
pub fn show_message_impl(
    message_type: MessageType,
    message: Message,
    should_log: bool,
    no_ansi: bool,
) -> std::io::Result<()> {
    let action = message.action.clone();
    let details = message.details.clone();

    // Create styled prefix based on message type
    let styled_prefix = match message_type {
        MessageType::Info => StyledText::new(action.clone()).cyan().bold(),
        MessageType::Success => StyledText::new(action.clone()).green().bold(),
        MessageType::Error => StyledText::new(action.clone()).red().bold(),
        MessageType::Highlight => StyledText::new(action.clone()).on_green().bold(),
    };

    // Write styled prefix and details in one line
    write_styled_line(&styled_prefix, &details, no_ansi)?;

    if should_log {
        let log_action = action.replace('\n', " ");
        let log_details = details.replace('\n', " ");
        info!("{} {}", log_action.trim(), log_details.trim());
    }

    Ok(())
}

/// Macro for displaying styled messages to the terminal.
///
/// This macro provides a unified interface for displaying messages with consistent
/// formatting and optional logging. It handles the styling based on message type
/// and ensures proper terminal output. ANSI color codes are automatically disabled
/// when the `no_ansi` setting is enabled in logger configuration.
///
/// # Syntax
///
/// - `show_message!(message_type, message)` - Display and log the message
/// - `show_message!(message_type, message, no_log)` - Display only, skip logging
///
/// # Arguments
///
/// * `message_type` - A `MessageType` enum value determining the visual style
/// * `message` - A `Message` struct containing the action and details
/// * `no_log` - Optional boolean to disable logging (when present, logging is skipped)
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::message::{MessageType, Message};
/// // Standard usage with logging
/// show_message!(
///     MessageType::Success,
///     Message::new("Deploy".to_string(), "Application deployed successfully".to_string())
/// );
///
/// // Skip logging (useful for log output itself)
/// show_message!(
///     MessageType::Info,
///     Message::new("Log".to_string(), "Debug information".to_string()),
///     true
/// );
/// ```
#[macro_export]
macro_rules! show_message {
    ($message_type:expr, $message:expr) => {{
        use std::sync::atomic::Ordering;
        use $crate::utilities::constants::NO_ANSI;
        let no_ansi = NO_ANSI.load(Ordering::Relaxed);
        $crate::cli::display::message_display::show_message_impl(
            $message_type,
            $message,
            true,
            no_ansi,
        )
        .expect("failed to write message to terminal");
    }};

    ($message_type:expr, $message:expr, $no_log:expr) => {{
        use std::sync::atomic::Ordering;
        use $crate::utilities::constants::NO_ANSI;
        let no_ansi = NO_ANSI.load(Ordering::Relaxed);
        $crate::cli::display::message_display::show_message_impl(
            $message_type,
            $message,
            false,
            no_ansi,
        )
        .expect("failed to write message to terminal");
    }};
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_show_message_impl_info() {
        let message = Message::new("Test".to_string(), "Test message".to_string());
        let result = show_message_impl(MessageType::Info, message, false);
        assert!(result.is_ok());
    }

    #[test]
    fn test_show_message_impl_success() {
        let message = Message::new("Success".to_string(), "Operation completed".to_string());
        let result = show_message_impl(MessageType::Success, message, false);
        assert!(result.is_ok());
    }

    #[test]
    fn test_show_message_impl_error() {
        let message = Message::new("Error".to_string(), "Something went wrong".to_string());
        let result = show_message_impl(MessageType::Error, message, false);
        assert!(result.is_ok());
    }

    #[test]
    fn test_show_message_impl_highlight() {
        let message = Message::new("Important".to_string(), "Pay attention to this".to_string());
        let result = show_message_impl(MessageType::Highlight, message, false);
        assert!(result.is_ok());
    }

    #[test]
    fn test_show_message_impl_with_logging() {
        let message = Message::new("Log".to_string(), "This should be logged".to_string());
        let result = show_message_impl(MessageType::Info, message, true);
        assert!(result.is_ok());
    }

    #[test]
    fn test_show_message_impl_multiline() {
        let message = Message::new(
            "Multi\nLine".to_string(),
            "Details\nwith\nnewlines".to_string(),
        );
        let result = show_message_impl(MessageType::Info, message, false);
        assert!(result.is_ok());
    }

    #[test]
    fn test_show_message_impl_unicode() {
        let message = Message::new(
            "🚀 Deploy".to_string(),
            "Successfully deployed 🎉".to_string(),
        );
        let result = show_message_impl(MessageType::Success, message, false);
        assert!(result.is_ok());
    }

    #[test]
    fn test_show_message_impl_empty() {
        let message = Message::new("".to_string(), "".to_string());
        let result = show_message_impl(MessageType::Info, message, false);
        assert!(result.is_ok());
    }

    #[test]
    fn test_show_message_wrapper() {
        let message = Message::new(
            "Wrapper".to_string(),
            "Testing wrapper function".to_string(),
        );
        // This should not panic
        show_message_wrapper(MessageType::Info, message);
    }

    #[test]
    fn test_batch_inserted() {
        // This should not panic
        batch_inserted(100, "test_table");
    }

    #[test]
    fn test_batch_inserted_zero() {
        // This should not panic
        batch_inserted(0, "empty_table");
    }

    #[test]
    fn test_batch_inserted_unicode_table() {
        // This should not panic
        batch_inserted(50, "测试表");
    }

    // Test the macro itself
    #[test]
    fn test_show_message_macro() {
        let message = Message::new("Macro".to_string(), "Testing macro".to_string());

        // Test with logging (default)
        show_message!(MessageType::Info, message.clone());

        // Test without logging
        show_message!(MessageType::Success, message, true);
    }

    #[test]
    fn test_show_message_macro_all_types() {
        let message = Message::new("Test".to_string(), "Message".to_string());

        show_message!(MessageType::Info, message.clone());
        show_message!(MessageType::Success, message.clone());
        show_message!(MessageType::Error, message.clone());
        show_message!(MessageType::Highlight, message);
    }
}
