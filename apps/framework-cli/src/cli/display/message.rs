//! Message types and core structures for CLI display.
//!
//! This module defines the fundamental types used for displaying messages
//! in the CLI, including message types, message structures, and basic
//! display functionality.

use serde::Deserialize;

/// Types of messages that can be displayed to the user.
///
/// Each message type corresponds to a different visual style in the terminal
/// to help distinguish between different kinds of information. The styling
/// affects the color and formatting of the action portion of messages.
///
/// # Visual Styles
///
/// - `Info`: Cyan text with bold formatting for general information
/// - `Success`: Green text with bold formatting for successful operations
/// - `Warning`: Yellow text with bold formatting for warnings
/// - `Error`: Red text with bold formatting for error conditions
/// - `Highlight`: Text with green background and bold formatting for emphasis
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageType {
    /// Used for general information with cyan highlighting
    Info,
    /// Used for successful actions with green highlighting
    Success,
    /// Used for warnings with yellow highlighting
    Warning,
    /// Used for errors with red highlighting
    Error,
    /// Used for important information with green background
    Highlight,
}

/// A message to be displayed to the user in the CLI.
///
/// Messages consist of two parts:
/// - An action (displayed with color based on MessageType) that appears in a fixed-width column
/// - Details (the main content) that contains the descriptive text
///
/// The action is right-aligned in a 15-character column to provide consistent
/// visual alignment across different message types.
///
/// # Examples
///
/// ```rust
/// use crate::cli::display::message::Message;
///
/// let message = Message::new(
///     "Config".to_string(),
///     "Successfully loaded configuration file".to_string()
/// );
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    /// The action or category of the message, displayed with color
    /// This is limited to 15 characters.
    pub action: String,
    /// The main content or details of the message
    pub details: String,
}

impl Message {
    /// Creates a new Message with the specified action and details.
    ///
    /// # Arguments
    ///
    /// * `action` - The action or category of the message (displayed in colored column)
    /// * `details` - The main content or details of the message
    ///
    /// # Returns
    ///
    /// A new `Message` instance ready for display
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use crate::cli::display::message::Message;
    /// let msg = Message::new("Deploy".to_string(), "Application deployed successfully".to_string());
    /// ```
    pub fn new(action: String, details: String) -> Self {
        Self { action, details }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_new() {
        let message = Message::new("Test".to_string(), "Test details".to_string());
        assert_eq!(message.action, "Test");
        assert_eq!(message.details, "Test details");
    }

    #[test]
    fn test_message_equality() {
        let msg1 = Message::new("Test".to_string(), "Details".to_string());
        let msg2 = Message::new("Test".to_string(), "Details".to_string());
        assert_eq!(msg1, msg2);
    }

    #[test]
    fn test_message_type_equality() {
        assert_eq!(MessageType::Info, MessageType::Info);
        assert_ne!(MessageType::Info, MessageType::Success);
    }

    #[test]
    fn test_message_type_debug() {
        let msg_type = MessageType::Success;
        let debug_str = format!("{msg_type:?}");
        assert_eq!(debug_str, "Success");
    }

    #[test]
    fn test_message_clone() {
        let original = Message::new("Original".to_string(), "Original details".to_string());
        let cloned = original.clone();
        assert_eq!(original, cloned);

        // Ensure they are separate instances
        assert_eq!(original.action, cloned.action);
        assert_eq!(original.details, cloned.details);
    }
    #[test]
    fn test_message_type_copy() {
        let original = MessageType::Error;
        let copied = original;
        assert_eq!(original, copied);
    }

    #[test]
    fn test_empty_message() {
        let message = Message::new("".to_string(), "".to_string());
        assert_eq!(message.action, "");
        assert_eq!(message.details, "");
    }

    #[test]
    fn test_unicode_message() {
        let message = Message::new(
            "🚀 Deploy".to_string(),
            "Successfully deployed 🎉".to_string(),
        );
        assert_eq!(message.action, "🚀 Deploy");
        assert_eq!(message.details, "Successfully deployed 🎉");
    }

    #[test]
    fn test_multiline_message() {
        let message = Message::new(
            "Multi\nLine".to_string(),
            "Details\nwith\nnewlines".to_string(),
        );
        assert_eq!(message.action, "Multi\nLine");
        assert_eq!(message.details, "Details\nwith\nnewlines");
    }
}
