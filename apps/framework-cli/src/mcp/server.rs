use log::info;
use rmcp::{
    model::{
        Annotated, CallToolRequestParam, CallToolResult, Implementation, ListToolsResult,
        PaginatedRequestParam, ProtocolVersion, RawContent, RawTextContent, ServerCapabilities,
        ServerInfo,
    },
    service::RequestContext,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ErrorData, RoleServer, ServerHandler,
};
use std::sync::Arc;

use super::tools::logs;

/// Handler for the MCP server that implements the Model Context Protocol
#[derive(Clone)]
pub struct MooseMcpHandler {
    server_name: String,
    server_version: String,
}

impl MooseMcpHandler {
    /// Create a new MCP handler instance
    pub fn new(server_name: String, server_version: String) -> Self {
        Self {
            server_name,
            server_version,
        }
    }
}

impl ServerHandler for MooseMcpHandler {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2024_11_05,
            capabilities: ServerCapabilities {
                tools: Some(Default::default()),
                ..Default::default()
            },
            server_info: Implementation {
                name: self.server_name.clone(),
                version: self.server_version.clone(),
                title: Some("Moose MCP Server".to_string()),
                icons: None,
                website_url: None,
            },
            instructions: Some(
                "Moose MCP Server - Access dev server logs for debugging and monitoring"
                    .to_string(),
            ),
        }
    }

    async fn list_tools(
        &self,
        _pagination: Option<PaginatedRequestParam>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult {
            tools: vec![logs::tool_definition()],
            next_cursor: None,
        })
    }

    async fn call_tool(
        &self,
        param: CallToolRequestParam,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        match param.name.as_ref() {
            "get_logs" => Ok(logs::handle_call(param.arguments.as_ref())),
            _ => Ok(CallToolResult {
                content: vec![Annotated {
                    raw: RawContent::Text(RawTextContent {
                        text: format!("Unknown tool: {}", param.name),
                        meta: None,
                    }),
                    annotations: None,
                }],
                is_error: Some(true),
                meta: None,
                structured_content: None,
            }),
        }
    }
}

/// Create an MCP HTTP service that can be integrated with the existing web server
///
/// # Arguments
/// * `server_name` - Name of the MCP server
/// * `server_version` - Version of the MCP server
///
/// # Returns
/// * `StreamableHttpService` - HTTP service that can handle MCP requests
pub fn create_mcp_http_service(
    server_name: String,
    server_version: String,
) -> StreamableHttpService<MooseMcpHandler, LocalSessionManager> {
    info!(
        "[MCP] Creating MCP HTTP service: {} v{}",
        server_name, server_version
    );

    let session_manager = Arc::new(LocalSessionManager::default());
    let config = StreamableHttpServerConfig {
        sse_keep_alive: Some(std::time::Duration::from_secs(5)),
        stateful_mode: true,
    };

    StreamableHttpService::new(
        move || {
            Ok(MooseMcpHandler::new(
                server_name.clone(),
                server_version.clone(),
            ))
        },
        session_manager,
        config,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_handler_creation() {
        let handler = MooseMcpHandler::new("test-server".to_string(), "0.0.1".to_string());
        assert_eq!(handler.server_name, "test-server");
        assert_eq!(handler.server_version, "0.0.1");
    }

    #[test]
    fn test_handler_get_info() {
        let handler = MooseMcpHandler::new("test-server".to_string(), "0.0.1".to_string());
        let info = handler.get_info();
        assert_eq!(info.server_info.name, "test-server");
        assert_eq!(info.server_info.version, "0.0.1");
        assert_eq!(info.protocol_version, ProtocolVersion::V_2024_11_05);
        assert!(info.capabilities.tools.is_some());
        assert!(info.instructions.is_some());
    }

    #[test]
    fn test_handler_clone() {
        let handler = MooseMcpHandler::new("test-server".to_string(), "0.0.1".to_string());
        let cloned = handler.clone();
        assert_eq!(cloned.server_name, handler.server_name);
        assert_eq!(cloned.server_version, handler.server_version);
    }
}
