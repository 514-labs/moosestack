use tokio::sync::mpsc;
use tracing::warn;

use super::message::MessageType;

/// Display context determines where messages are routed
#[derive(Clone, Debug)]
pub enum DisplayContext {
    /// Normal terminal output (stdout/stderr)
    Terminal,
    /// Route messages to TUI via channel
    #[allow(dead_code)] // Will be used in TUI integration
    Tui(DisplaySender),
}

/// Type of infrastructure change for semantic display
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InfrastructureChangeType {
    /// Addition of new infrastructure (green/+)
    Added,
    /// Removal of infrastructure (red/-)
    Removed,
    /// Update to existing infrastructure (yellow/~)
    Updated,
}

/// Messages that can be displayed in the terminal or routed to TUI
///
/// This enum represents all types of display output that can be sent to either
/// the terminal (normal mode) or to a TUI via a message channel when in TUI mode.
/// Each variant carries the necessary data to render the message appropriately.
#[derive(Debug, Clone)]
#[allow(dead_code)] // Fields will be read in TUI integration
pub enum DisplayMessage {
    /// Generic message with typed severity and content
    ///
    /// Used for standard log-style messages with a type (Info/Success/Error/Warning),
    /// an action label, and detailed description.
    Message {
        /// The semantic type of the message (Info, Success, Error, Warning, Highlight)
        message_type: MessageType,
        /// Short action label (e.g., "Loading", "Success", "Error")
        action: String,
        /// Detailed message content
        details: String,
    },
    /// Formatted table display
    ///
    /// Used to display structured tabular data with headers and rows.
    Table {
        /// Title displayed above the table
        title: String,
        /// Column headers
        headers: Vec<String>,
        /// Table rows, where each row is a vector of column values
        rows: Vec<Vec<String>>,
    },
    /// Infrastructure detail lines
    ///
    /// Used for displaying detailed infrastructure information with proper indentation.
    InfrastructureDetail {
        /// Lines of detail text to display
        lines: Vec<String>,
    },
    /// Infrastructure change notification with semantic type
    ///
    /// Used for infrastructure changes (add/remove/update) with explicit semantic type
    /// information preserved from the styled terminal output.
    InfrastructureChange {
        /// Type of infrastructure change (Added/Removed/Updated)
        change_type: InfrastructureChangeType,
        /// Action text including prefix symbol (e.g., "+ Table", "- View")
        action: String,
        /// Details about what changed
        details: String,
    },
    /// Spinner completion message
    ///
    /// Used when a long-running operation completes to show completion status.
    SpinnerCompletion {
        /// Completion message (e.g., "Build complete", "Deploy finished")
        message: String,
    },
}

/// Sender wrapper for display messages to TUI
///
/// Wraps an `mpsc::UnboundedSender` to provide a convenient interface for sending
/// display messages to the TUI. Messages are sent asynchronously and failures are
/// logged but not propagated (fire-and-forget semantics).
#[derive(Clone)]
pub struct DisplaySender {
    tx: mpsc::UnboundedSender<DisplayMessage>,
}

impl DisplaySender {
    /// Creates a new display sender from an mpsc channel
    ///
    /// # Arguments
    ///
    /// * `tx` - The unbounded sender channel for display messages
    ///
    /// # Returns
    ///
    /// A new `DisplaySender` instance wrapping the provided channel
    #[allow(dead_code)] // Will be used in TUI integration
    pub fn new(tx: mpsc::UnboundedSender<DisplayMessage>) -> Self {
        Self { tx }
    }

    /// Sends a display message to the TUI
    ///
    /// Attempts to send a message through the channel. If the receiver has been
    /// dropped (TUI exited), the error is logged via `tracing::warn!` but not
    /// propagated, allowing the caller to continue without errors.
    ///
    /// # Arguments
    ///
    /// * `msg` - The display message to send
    ///
    /// # Behavior
    ///
    /// - **Success**: Message is queued for the TUI receiver
    /// - **Failure**: Logs a warning if the channel is closed but does not panic
    pub fn send(&self, msg: DisplayMessage) {
        if let Err(e) = self.tx.send(msg) {
            warn!("Display channel closed, message dropped: {:?}", e.0);
        }
    }
}

// Manual Debug impl for DisplaySender (channel doesn't need detailed debug output)
impl std::fmt::Debug for DisplaySender {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DisplaySender").finish_non_exhaustive()
    }
}

// Task-local storage for display context
tokio::task_local! {
    pub static DISPLAY_CONTEXT: DisplayContext;
}

/// Helper to get current context, defaulting to Terminal
pub fn current_context() -> DisplayContext {
    DISPLAY_CONTEXT
        .try_with(|ctx| ctx.clone())
        .unwrap_or(DisplayContext::Terminal)
}

/// Helper to check if a TUI channel is available
pub fn tui_channel() -> Option<DisplaySender> {
    match current_context() {
        DisplayContext::Tui(sender) => Some(sender),
        DisplayContext::Terminal => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_default_context_is_terminal() {
        let ctx = current_context();
        assert!(matches!(ctx, DisplayContext::Terminal));
    }

    #[tokio::test]
    async fn test_tui_context_available() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let sender = DisplaySender::new(tx);
        let context = DisplayContext::Tui(sender);

        DISPLAY_CONTEXT
            .scope(context, async {
                assert!(tui_channel().is_some());
            })
            .await;
    }

    #[tokio::test]
    async fn test_messages_routed_to_tui() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sender = DisplaySender::new(tx);
        let context = DisplayContext::Tui(sender);

        DISPLAY_CONTEXT
            .scope(context, async {
                let sender = tui_channel().unwrap();
                sender.send(DisplayMessage::Message {
                    message_type: MessageType::Info,
                    action: "Test".to_string(),
                    details: "Details".to_string(),
                });

                let msg = rx.try_recv().unwrap();
                assert!(matches!(msg, DisplayMessage::Message { .. }));
            })
            .await;
    }
}
