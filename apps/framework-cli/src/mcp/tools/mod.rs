pub mod get_source;
pub mod infra_map;
pub mod logs;
pub mod query_olap;
pub mod sample_stream;

use rmcp::model::{Annotated, CallToolResult, RawContent, RawTextContent};

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
