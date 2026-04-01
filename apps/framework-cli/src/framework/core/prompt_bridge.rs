//! Shared prompt bridge for MCP-based confirmation responses.
//!
//! When a confirmation gate (destructive or rename) needs user input, it
//! publishes a [`PendingPrompt`] to the bridge and awaits a response. An MCP
//! tool (`respond_to_prompt`) can read the pending prompt and send a response
//! through the same bridge, unblocking the gate.
//!
//! If stdin is also a TTY the gate races both channels so interactive and
//! MCP-driven flows coexist.

use std::fmt;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

/// The kind of confirmation the gate is waiting for.
#[derive(Debug, Clone)]
pub enum PromptKind {
    /// Destructive-change gate: user must accept or reject the whole batch.
    Destructive {
        change_count: usize,
        summary: String,
    },
    /// Per-column-rename gate: user decides per rename.
    Rename {
        current: usize,
        total: usize,
        description: String,
    },
}

impl fmt::Display for PromptKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PromptKind::Destructive {
                change_count,
                summary,
            } => {
                write!(
                    f,
                    "Destructive: {} operation(s) that may cause data loss:\n{}",
                    change_count, summary
                )
            }
            PromptKind::Rename {
                current,
                total,
                description,
            } => {
                write!(f, "Rename ({}/{}): {}", current, total, description)
            }
        }
    }
}

/// Snapshot of the currently pending prompt, safe to send to MCP clients.
#[derive(Debug, Clone)]
pub struct PendingPrompt {
    pub kind: PromptKind,
    pub valid_responses: Vec<String>,
    pub default_response: Option<String>,
}

impl fmt::Display for PendingPrompt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.kind)?;
        write!(f, "\nValid responses: {}", self.valid_responses.join(", "))?;
        if let Some(ref d) = self.default_response {
            write!(f, " (default: {})", d)?;
        }
        Ok(())
    }
}

struct ActivePrompt {
    info: PendingPrompt,
    tx: oneshot::Sender<String>,
}

/// Thread-safe bridge between confirmation gates and MCP tool handlers.
///
/// Create once at startup, clone into both the MCP handler and the watchers /
/// initial-plan path.
#[derive(Clone)]
pub struct PromptBridge {
    active: Arc<Mutex<Option<ActivePrompt>>>,
    /// The URL where the MCP server is listening (e.g. `http://localhost:4000/mcp`).
    /// Included in stdout messages so agents know where to connect.
    mcp_url: Arc<String>,
}

impl Default for PromptBridge {
    fn default() -> Self {
        Self {
            active: Arc::default(),
            mcp_url: Arc::new(String::new()),
        }
    }
}

impl PromptBridge {
    pub fn new(mcp_url: String) -> Self {
        Self {
            active: Arc::default(),
            mcp_url: Arc::new(mcp_url),
        }
    }

    /// The MCP endpoint URL, for use in agent-facing messages.
    pub fn mcp_url(&self) -> &str {
        &self.mcp_url
    }

    /// Publish a prompt and wait for a response (called by confirmation gates).
    ///
    /// Returns `None` if the receiver was dropped without sending (e.g. server
    /// shutting down).
    pub async fn prompt(&self, info: PendingPrompt) -> Option<String> {
        let (tx, rx) = oneshot::channel();
        {
            let mut lock = self.active.lock().await;
            *lock = Some(ActivePrompt { info, tx });
        }
        let result = rx.await.ok();
        {
            let mut lock = self.active.lock().await;
            *lock = None;
        }
        result
    }

    /// Read the currently pending prompt without consuming it.
    pub async fn get_pending(&self) -> Option<PendingPrompt> {
        let lock = self.active.lock().await;
        lock.as_ref().map(|a| a.info.clone())
    }

    /// Send a response to the currently pending prompt.
    ///
    /// Returns `Ok(prompt_info)` on success, or `Err` if no prompt is pending.
    pub async fn respond(&self, response: String) -> Result<PendingPrompt, NoPromptPending> {
        let mut lock = self.active.lock().await;
        match lock.take() {
            Some(active) => {
                let info = active.info.clone();
                let _ = active.tx.send(response);
                Ok(info)
            }
            None => Err(NoPromptPending),
        }
    }
}

/// Error returned when [`PromptBridge::respond`] is called with no active prompt.
#[derive(Debug, thiserror::Error)]
#[error("no prompt is currently pending")]
pub struct NoPromptPending;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn respond_unblocks_prompt() {
        let bridge = PromptBridge::new("http://localhost:4000/mcp".into());
        let bridge2 = bridge.clone();

        let handle = tokio::spawn(async move {
            bridge2
                .prompt(PendingPrompt {
                    kind: PromptKind::Destructive {
                        change_count: 1,
                        summary: "DROP TABLE foo".to_string(),
                    },
                    valid_responses: vec!["y".into(), "n".into()],
                    default_response: Some("n".into()),
                })
                .await
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let pending = bridge.get_pending().await;
        assert!(pending.is_some());

        let info = bridge.respond("y".to_string()).await.unwrap();
        assert!(matches!(info.kind, PromptKind::Destructive { .. }));

        let result = handle.await.unwrap();
        assert_eq!(result, Some("y".to_string()));
    }

    #[tokio::test]
    async fn respond_without_prompt_returns_error() {
        let bridge = PromptBridge::default();
        assert!(bridge.respond("y".to_string()).await.is_err());
    }

    #[tokio::test]
    async fn get_pending_returns_none_when_idle() {
        let bridge = PromptBridge::default();
        assert!(bridge.get_pending().await.is_none());
    }
}
