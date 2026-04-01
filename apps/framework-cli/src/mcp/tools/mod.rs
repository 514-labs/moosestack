pub mod infra_issues;
pub mod infra_map;
pub mod logs;
pub mod prompt;
pub mod query_olap;
pub mod sample_stream;

use rmcp::model::{Annotated, CallToolResult, RawContent, RawTextContent, Tool};

/// Returns all tool definitions advertised by the MCP server.
///
/// Both the dev server and the stdio proxy share this list so they
/// stay in sync automatically.
pub fn all_tool_definitions() -> Vec<Tool> {
    vec![
        logs::tool_definition(),
        infra_map::tool_definition(),
        infra_issues::tool_definition(),
        query_olap::tool_definition(),
        sample_stream::tool_definition(),
        prompt::tool_definition(),
    ]
}

/// Create an error CallToolResult with the given message
pub fn create_error_result(message: String) -> CallToolResult {
    CallToolResult {
        content: vec![Annotated {
            raw: RawContent::Text(RawTextContent {
                text: message,
                meta: None,
            }),
            annotations: None,
        }],
        is_error: Some(true),
        meta: None,
        structured_content: None,
    }
}

/// Create a success CallToolResult with the given content
pub fn create_success_result(content: String) -> CallToolResult {
    CallToolResult {
        content: vec![Annotated {
            raw: RawContent::Text(RawTextContent {
                text: content,
                meta: None,
            }),
            annotations: None,
        }],
        is_error: Some(false),
        meta: None,
        structured_content: None,
    }
}
