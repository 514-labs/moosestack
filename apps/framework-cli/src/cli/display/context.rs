use tokio::sync::mpsc;

use super::message::MessageType;

/// Display context determines where messages are routed
#[derive(Clone)]
pub enum DisplayContext {
    /// Normal terminal output (stdout/stderr)
    Terminal,
    /// Route messages to TUI via channel
    #[allow(dead_code)] // Will be used in TUI integration
    Tui(DisplaySender),
}

/// Messages that can be displayed
#[derive(Debug, Clone)]
#[allow(dead_code)] // Fields will be read in TUI integration
pub enum DisplayMessage {
    Message {
        message_type: MessageType,
        action: String,
        details: String,
    },
    Table {
        title: String,
        headers: Vec<String>,
        rows: Vec<Vec<String>>,
    },
    InfrastructureDetail {
        lines: Vec<String>,
    },
    SpinnerCompletion {
        message: String,
    },
}

/// Sender wrapper for display messages
#[derive(Clone)]
pub struct DisplaySender {
    tx: mpsc::UnboundedSender<DisplayMessage>,
}

impl DisplaySender {
    #[allow(dead_code)] // Will be used in TUI integration
    pub fn new(tx: mpsc::UnboundedSender<DisplayMessage>) -> Self {
        Self { tx }
    }

    pub fn send(&self, msg: DisplayMessage) {
        let _ = self.tx.send(msg);
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
