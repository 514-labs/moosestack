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
/// Internal helper that writes a styled action line to any writer.
/// This allows for testing by capturing output to a buffer.
fn write_styled_line_to<W: std::io::Write>(
    writer: &mut W,
    styled_text: &StyledText,
    message: &str,
    no_ansi: bool,
) -> IoResult<()> {
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
            execute!(writer, SetForegroundColor(color))?;
        }

        // Apply background color
        if let Some(color) = styled_text.background {
            execute!(writer, SetBackgroundColor(color))?;
        }

        // Apply bold
        if styled_text.bold {
            execute!(writer, SetAttribute(Attribute::Bold))?;
        }
    }

    // Write the styled, right-aligned action text
    execute!(writer, Print(&padded_action))?;

    // Reset styling before writing the message (only if ANSI was applied)
    if !no_ansi {
        execute!(writer, ResetColor)?;
        if styled_text.bold {
            execute!(writer, SetAttribute(Attribute::Reset))?;
        }
    }

    // Write separator and message
    execute!(writer, Print(" "), Print(message), Print("\n"))?;

    Ok(())
}

pub fn write_styled_line(styled_text: &StyledText, message: &str, no_ansi: bool) -> IoResult<()> {
    let mut stdout = stdout();
    write_styled_line_to(&mut stdout, styled_text, message, no_ansi)
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
    // Tests that actually verify ANSI codes are present/absent in output
    // by using write_styled_line_to with a buffer

    #[test]
    fn test_write_styled_line_with_ansi_contains_escape_codes() {
        let mut buffer = Vec::new();
        let styled = StyledText::from_str("Test").green().bold();

        // no_ansi = false means ANSI codes SHOULD be present
        write_styled_line_to(&mut buffer, &styled, "test message", false).unwrap();
        let output = String::from_utf8(buffer).unwrap();

        // Check for ANSI escape code prefix (\x1b[ or ESC[)
        assert!(
            output.contains("\x1b["),
            "Output with no_ansi=false should contain ANSI escape codes. Got: {:?}",
            output
        );
    }

    #[test]
    fn test_write_styled_line_without_ansi_no_escape_codes() {
        let mut buffer = Vec::new();
        let styled = StyledText::from_str("Test").green().bold();

        // no_ansi = true means ANSI codes should NOT be present
        write_styled_line_to(&mut buffer, &styled, "test message", true).unwrap();
        let output = String::from_utf8(buffer).unwrap();

        // Verify no ANSI escape codes
        assert!(
            !output.contains("\x1b["),
            "Output with no_ansi=true should NOT contain ANSI escape codes. Got: {:?}",
            output
        );

        // Verify the actual text content is still there
        assert!(output.contains("Test"), "Should contain the action text");
        assert!(
            output.contains("test message"),
            "Should contain the message"
        );
    }

    #[test]
    fn test_write_styled_line_bold_ansi_code() {
        let mut buffer = Vec::new();
        let styled = StyledText::from_str("Bold").bold();

        write_styled_line_to(&mut buffer, &styled, "message", false).unwrap();
        let output = String::from_utf8(buffer).unwrap();

        // Bold is attribute 1, should see \x1b[1m
        assert!(output.contains("\x1b[1m"), "Should contain bold ANSI code");
    }

    #[test]
    fn test_write_styled_line_all_styles_no_ansi_verified() {
        // Verify that ALL color/style combinations produce NO ANSI codes with no_ansi=true
        let test_cases = vec![
            ("Cyan", StyledText::from_str("Cyan").cyan()),
            ("Green", StyledText::from_str("Green").green()),
            ("Yellow", StyledText::from_str("Yellow").yellow()),
            ("Red", StyledText::from_str("Red").red()),
            ("OnGreen", StyledText::from_str("OnGreen").on_green()),
            ("Bold", StyledText::from_str("Bold").bold()),
            ("Combined", StyledText::from_str("Combined").green().bold()),
        ];

        for (name, styled) in test_cases {
            let mut buffer = Vec::new();
            write_styled_line_to(&mut buffer, &styled, "message", true).unwrap();
            let output = String::from_utf8(buffer).unwrap();

            assert!(
                !output.contains("\x1b["),
                "Style '{}' should not produce ANSI codes with no_ansi=true. Got: {:?}",
                name,
                output
            );
        }
    }

    #[test]
    fn test_write_styled_line_all_styles_with_ansi_verified() {
        // Verify that color/style combinations DO produce ANSI codes with no_ansi=false
        let test_cases = vec![
            ("Cyan", StyledText::from_str("Cyan").cyan()),
            ("Green", StyledText::from_str("Green").green()),
            ("Bold", StyledText::from_str("Bold").bold()),
        ];

        for (name, styled) in test_cases {
            let mut buffer = Vec::new();
            write_styled_line_to(&mut buffer, &styled, "message", false).unwrap();
            let output = String::from_utf8(buffer).unwrap();

            assert!(
                output.contains("\x1b["),
                "Style '{}' should produce ANSI codes with no_ansi=false. Got: {:?}",
                name,
                output
            );
        }
    }
}
