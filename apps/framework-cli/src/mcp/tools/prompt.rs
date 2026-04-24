//! # Prompt Response Tool
//!
//! MCP tool that lets an agent read and respond to pending confirmation
//! prompts (destructive-change gates and column-rename gates) during
//! `moose dev`.

use rmcp::model::Tool;
use serde_json::{json, Map, Value};
use std::sync::Arc;

use super::{create_error_result, create_success_result};
use crate::framework::core::prompt_bridge::PromptBridge;

/// Returns the tool definition advertised to MCP clients.
pub fn tool_definition() -> Tool {
    let schema = json!({
        "type": "object",
        "properties": {
            "response": {
                "type": "string",
                "description": "The response to send to the pending prompt.\n\
                    For destructive-change prompts: \"y\" to accept, \"n\" to reject.\n\
                    For column-rename prompts: \"y\" to rename, \"n\" to drop+recreate, \"c\" to cancel.\n\
                    Omit this parameter to inspect the current prompt without answering it."
            }
        }
    });

    Tool {
        name: "respond_to_prompt".into(),
        description: Some(
            "Read or respond to a pending confirmation prompt from the dev server. \
             When Moose detects destructive schema changes (table drops, column drops, \
             recreates) or column renames, it pauses and waits for confirmation. \
             Call without arguments to see the current prompt, or pass a response to answer it."
                .into(),
        ),
        input_schema: Arc::new(schema.as_object().unwrap().clone()),
        annotations: None,
        execution: None,
        icons: None,
        meta: None,
        output_schema: None,
        title: Some("Respond to Confirmation Prompt".into()),
    }
}

/// Handle an MCP `respond_to_prompt` call.
pub async fn handle_call(
    arguments: Option<&Map<String, Value>>,
    bridge: &PromptBridge,
) -> rmcp::model::CallToolResult {
    let response = arguments
        .and_then(|a| a.get("response"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    match response {
        None => match bridge.get_pending().await {
            Some(prompt) => create_success_result(format!(
                "Pending prompt:\n{prompt}\n\nCall this tool again with a \"response\" argument to answer."
            )),
            None => create_success_result(
                "No prompt is currently pending. The dev server is not waiting for confirmation."
                    .to_string(),
            ),
        },
        Some(resp) => match bridge.respond(resp.clone()).await {
            Ok(info) => create_success_result(format!(
                "Response \"{resp}\" sent successfully.\nPrompt was: {info}"
            )),
            Err(_) => create_error_result(
                "No prompt is currently pending. The dev server is not waiting for confirmation."
                    .to_string(),
            ),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::prompt_bridge::{PendingPrompt, PromptKind};
    use serde_json::json;

    #[tokio::test]
    async fn inspect_with_no_pending_prompt() {
        let bridge = PromptBridge::default();
        let result = handle_call(None, &bridge).await;
        let text = result
            .content
            .first()
            .and_then(|c| c.raw.as_text())
            .map(|t| t.text.as_str())
            .unwrap_or("");
        assert!(
            text.contains("No prompt is currently pending"),
            "unexpected: {text}"
        );
        assert!(!result.is_error.unwrap_or(false));
    }

    #[tokio::test]
    async fn inspect_with_pending_prompt() {
        let bridge = PromptBridge::new("http://localhost:4000/mcp".into());
        let bridge2 = bridge.clone();
        let _handle = tokio::spawn(async move {
            bridge2
                .prompt(PendingPrompt {
                    kind: PromptKind::Destructive {
                        change_count: 1,
                        summary: "DROP TABLE foo".into(),
                    },
                    valid_responses: vec!["y".into(), "n".into()],
                    default_response: Some("n".into()),
                })
                .await
        });

        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if bridge.get_pending().await.is_some() {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("timed out");

        let result = handle_call(None, &bridge).await;
        let text = result
            .content
            .first()
            .and_then(|c| c.raw.as_text())
            .map(|t| t.text.as_str())
            .unwrap_or("");
        assert!(text.contains("Pending prompt"), "unexpected: {text}");
    }

    #[tokio::test]
    async fn respond_with_no_pending_prompt() {
        let bridge = PromptBridge::default();
        let mut args = Map::new();
        args.insert("response".into(), json!("y"));
        let result = handle_call(Some(&args), &bridge).await;
        assert!(result.is_error.unwrap_or(false));
    }

    #[tokio::test]
    async fn respond_successfully() {
        let bridge = PromptBridge::new("http://localhost:4000/mcp".into());
        let bridge2 = bridge.clone();
        let handle = tokio::spawn(async move {
            bridge2
                .prompt(PendingPrompt {
                    kind: PromptKind::Destructive {
                        change_count: 1,
                        summary: "DROP TABLE foo".into(),
                    },
                    valid_responses: vec!["y".into(), "n".into()],
                    default_response: Some("n".into()),
                })
                .await
        });

        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if bridge.get_pending().await.is_some() {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("timed out");

        let mut args = Map::new();
        args.insert("response".into(), json!("y"));
        let result = handle_call(Some(&args), &bridge).await;
        let text = result
            .content
            .first()
            .and_then(|c| c.raw.as_text())
            .map(|t| t.text.as_str())
            .unwrap_or("");
        assert!(text.contains("sent successfully"), "unexpected: {text}");
        assert!(!result.is_error.unwrap_or(false));

        let prompt_result = handle.await.unwrap();
        assert_eq!(prompt_result, Some("y".to_string()));
    }
}
