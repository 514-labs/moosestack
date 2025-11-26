//! Terminal utility functions and components for styled output.
//!
//! This module provides low-level terminal manipulation utilities using the crossterm
//! crate. It includes components for displaying styled text and managing
//! terminal state during CLI operations.

use crossterm::{
    execute,
    style::{
        Attribute, Color, Print, ResetColor, SetAttribute, SetBackgroundColor, SetForegroundColor,
    },
};
use std::io::{stdout, Result as IoResult};

/// Width of the action column in terminal output
pub const ACTION_WIDTH: usize = 15;

/// Base trait for terminal output components.
///
/// Each component manages its own terminal state and cleanup, ensuring
/// consistent behavior and proper resource management. Components can
/// be ephemeral (like spinners) or permanent (like messages).
///
/// # Design Principles
///
/// - Components are responsible for their own state management
/// - Proper cleanup prevents terminal corruption
/// - Graceful handling of start/stop cycles
/// - Non-blocking operation where possible
pub trait TerminalComponent {
    /// Start the component and display its initial state.
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, or an IO error if terminal operations fail
    fn start(&mut self) -> IoResult<()>;

    /// Stop the component and clean up its terminal state.
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, or an IO error if cleanup fails
    fn stop(&mut self) -> IoResult<()>;

    /// Ensure the terminal is ready for the next component.
    ///
    /// Default implementation prints a newline to ensure proper spacing.
    /// Components can override this for specific cleanup behavior.
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, or an IO error if terminal operations fail
    fn cleanup(&mut self) -> IoResult<()> {
        execute!(stdout(), Print("\n"))?;
        Ok(())
    }
}

/// Builder for creating styled terminal text with colors and formatting.
///
/// This struct provides a fluent interface for building styled text that
/// can be displayed in the terminal with various colors and attributes.
/// The styling is applied when the text is written to the terminal.
///
/// # Supported Styling
///
/// - **Foreground Colors**: cyan, green, yellow, red
/// - **Background Colors**: green background (on_green)
/// - **Attributes**: bold text
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::terminal::StyledText;
/// let styled = StyledText::new("Success".to_string())
///     .green()
///     .bold();
/// ```
#[derive(Debug, Clone, PartialEq)]
pub struct StyledText {
    text: String,
    foreground: Option<Color>,
    background: Option<Color>,
    bold: bool,
}

impl StyledText {
    /// Creates a new StyledText with the specified text content.
    ///
    /// # Arguments
    ///
    /// * `text` - The text content to be styled
    ///
    /// # Returns
    ///
    /// A new `StyledText` instance with no styling applied
    pub fn new(text: String) -> Self {
        Self {
            text,
            foreground: None,
            background: None,
            bold: false,
        }
    }

    /// Creates a new StyledText from a string slice for convenience.
    ///
    /// # Arguments
    ///
    /// * `text` - The text content to be styled
    ///
    /// # Returns
    ///
    /// A new `StyledText` instance with no styling applied
    pub fn from_str(text: &str) -> Self {
        Self::new(text.to_string())
    }

    /// Sets the foreground color to cyan.
    ///
    /// # Returns
    ///
    /// Self for method chaining
    pub fn cyan(mut self) -> Self {
        self.foreground = Some(Color::Cyan);
        self
    }

    /// Sets the foreground color to green.
    ///
    /// # Returns
    ///
    /// Self for method chaining
    pub fn green(mut self) -> Self {
        self.foreground = Some(Color::Green);
        self
    }

    /// Sets the foreground color to yellow.
    ///
    /// # Returns
    ///
    /// Self for method chaining
    pub fn yellow(mut self) -> Self {
        self.foreground = Some(Color::Yellow);
        self
    }

    /// Sets the foreground color to red.
    ///
    /// # Returns
    ///
    /// Self for method chaining
    pub fn red(mut self) -> Self {
        self.foreground = Some(Color::Red);
        self
    }

    /// Applies bold formatting to the text.
    ///
    /// # Returns
    ///
    /// Self for method chaining
    pub fn bold(mut self) -> Self {
        self.bold = true;
        self
    }

    /// Sets the background color to green.
    ///
    /// # Returns
    ///
    /// Self for method chaining
    pub fn on_green(mut self) -> Self {
        self.background = Some(Color::Green);
        self
    }
}

/// Writes a styled line to the terminal with consistent formatting.
///
/// This function handles the complex terminal operations needed to display
/// styled text with proper alignment and formatting. The action text is
/// right-aligned in a fixed-width column for visual consistency.
///
/// # Arguments
///
/// * `styled_text` - The styled text configuration for the action portion
/// * `message` - The main message content to display
/// * `no_ansi` - If true, disable ANSI color codes and formatting
///
/// # Returns
///
/// `Ok(())` on success, or an IO error if terminal operations fail
///
/// # Format
///
/// The output format is: `[ACTION (15 chars, right-aligned)] [message]`
/// where ACTION is styled according to the StyledText configuration.
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::terminal::{StyledText, write_styled_line};
/// let styled = StyledText::new("Success".to_string()).green().bold();
/// write_styled_line(&styled, "Operation completed successfully", false)?;
/// # Ok::<(), std::io::Error>(())
/// ```
pub fn write_styled_line(styled_text: &StyledText, message: &str, no_ansi: bool) -> IoResult<()> {
    let mut stdout = stdout();

    // Ensure action is exactly ACTION_WIDTH characters, right-aligned
    // Use character-aware truncation to avoid panics on multi-byte UTF-8 characters
    let truncated_action = if styled_text.text.chars().count() > ACTION_WIDTH {
        styled_text
            .text
            .chars()
            .take(ACTION_WIDTH)
            .collect::<String>()
    } else {
        styled_text.text.clone()
    };
    let padded_action = format!("{truncated_action:>ACTION_WIDTH$}");

    // Only apply ANSI styling if not disabled
    if !no_ansi {
        // Apply foreground color
        if let Some(color) = styled_text.foreground {
            execute!(stdout, SetForegroundColor(color))?;
        }

        // Apply background color
        if let Some(color) = styled_text.background {
            execute!(stdout, SetBackgroundColor(color))?;
        }

        // Apply bold
        if styled_text.bold {
            execute!(stdout, SetAttribute(Attribute::Bold))?;
        }
    }

    // Write the styled, right-aligned action text
    execute!(stdout, Print(&padded_action))?;

    // Reset styling before writing the message (only if ANSI was applied)
    if !no_ansi {
        execute!(stdout, ResetColor)?;
        if styled_text.bold {
            execute!(stdout, SetAttribute(Attribute::Reset))?;
        }
    }

    // Write separator and message
    execute!(stdout, Print(" "), Print(message), Print("\n"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_styled_text_new() {
        let _styled = StyledText::new("Test".to_string());
        // Just test that creation doesn't panic
    }

    #[test]
    fn test_styled_text_from_str() {
        let _styled = StyledText::from_str("Test");
        // Just test that creation doesn't panic
    }

    #[test]
    fn test_styled_text_colors() {
        let _styled1 = StyledText::from_str("Test").cyan();
        let _styled2 = StyledText::from_str("Test").green();
        let _styled3 = StyledText::from_str("Test").yellow();
        let _styled4 = StyledText::from_str("Test").red();
        // Just test that color methods don't panic
    }

    #[test]
    fn test_styled_text_background() {
        let _styled = StyledText::from_str("Test").on_green();
        // Just test that background method doesn't panic
    }

    #[test]
    fn test_styled_text_bold() {
        let _styled = StyledText::from_str("Test").bold();
        // Just test that bold method doesn't panic
    }

    #[test]
    fn test_styled_text_chaining() {
        let _styled = StyledText::from_str("Test").green().bold().on_green();
        // Just test that method chaining doesn't panic
    }

    #[test]
    fn test_styled_text_equality() {
        let styled1 = StyledText::from_str("Test").green().bold();
        let styled2 = StyledText::from_str("Test").green().bold();
        assert_eq!(styled1, styled2);
    }

    #[test]
    fn test_styled_text_clone() {
        let original = StyledText::from_str("Test").green().bold();
        let cloned = original.clone();
        assert_eq!(original, cloned);
    }

    #[test]
    fn test_action_width_constant() {
        assert_eq!(ACTION_WIDTH, 15);
    }

    #[test]
    fn test_unicode_styled_text() {
        let _styled = StyledText::from_str("🚀 Test").green();
        // Just test that Unicode text doesn't panic
    }

    #[test]
    fn test_empty_styled_text() {
        let _styled = StyledText::from_str("");
        // Just test that empty text doesn't panic
    }
    // Note: write_styled_line is difficult to test without mocking stdout,
    // but we can test that it doesn't panic with various inputs
    #[test]
    fn test_write_styled_line_doesnt_panic() {
        let styled = StyledText::from_str("Test").green().bold();
        // This test mainly ensures the function signature is correct
        // and doesn't panic during compilation
        let _ = write_styled_line(&styled, "test message", false);
    }
}
