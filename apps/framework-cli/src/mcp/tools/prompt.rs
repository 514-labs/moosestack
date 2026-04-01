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
