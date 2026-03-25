use rmcp::{
    model::{
        CallToolRequestParams, CallToolResult, Content, Implementation, ListToolsResult,
        PaginatedRequestParams, ProtocolVersion, ServerCapabilities, ServerInfo,
    },
    service::RequestContext,
    ClientHandler, ErrorData, RoleServer, ServerHandler,
};
use tracing::{error, info};

use super::tools::{infra_issues, infra_map, logs, query_olap, sample_stream};
use crate::utilities::constants::CLI_VERSION;

/// A lightweight MCP proxy server that runs over stdio.
///
/// Always starts successfully (no infrastructure deps required). Advertises the
/// same tools as the dev MCP server and proxies tool calls to the dev server's
/// HTTP endpoint. If the dev server is unreachable, returns a helpful error
/// prompting the agent to start `moose dev`.
#[derive(Clone)]
pub struct ProxyMcpHandler {
    dev_server_url: String,
}

impl ProxyMcpHandler {
    pub fn new(dev_server_url: String) -> Self {
        Self { dev_server_url }
    }

    /// Connect to the dev MCP server as a client and call a tool.
    async fn proxy_tool_call(
        &self,
        params: CallToolRequestParams,
    ) -> Result<CallToolResult, ErrorData> {
        use rmcp::transport::StreamableHttpClientTransport;

        let transport = StreamableHttpClientTransport::from_uri(self.dev_server_url.as_str());

        // Create a minimal client handler (no-op, we only need to send requests)
        let client = NoOpClientHandler;

        let running = match rmcp::serve_client(client, transport).await {
            Ok(running) => running,
            Err(e) => {
                info!("[MCP Proxy] Dev server not reachable: {}", e);
                return Ok(dev_server_not_running_error());
            }
        };

        let result = running.peer().call_tool(params).await;

        // Cancel the client session gracefully
        let _ = running.cancel().await;

        match result {
            Ok(result) => Ok(result),
            Err(e) => {
                error!("[MCP Proxy] Failed to proxy tool call: {}", e);
                Ok(CallToolResult::error(vec![Content::text(format!(
                    "Failed to execute tool on the Moose dev server: {e}\n\n\
                     The dev server may have restarted. Please retry the tool call."
                ))]))
            }
        }
    }
}

impl ServerHandler for ProxyMcpHandler {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2024_11_05,
            capabilities: ServerCapabilities {
                tools: Some(Default::default()),
                ..Default::default()
            },
            server_info: Implementation {
                name: "moose-mcp-proxy".to_string(),
                version: CLI_VERSION.to_string(),
                title: Some("Moose MCP Proxy".to_string()),
                description: None,
                icons: None,
                website_url: None,
            },
            instructions: Some(
                "Moose MCP Proxy - Proxies tool calls to the Moose dev server. \
                 If the dev server is not running, tool calls will return an error \
                 asking you to start `moose dev`."
                    .to_string(),
            ),
        }
    }

    async fn list_tools(
        &self,
        _pagination: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult {
            meta: None,
            tools: vec![
                logs::tool_definition(),
                infra_map::tool_definition(),
                infra_issues::tool_definition(),
                query_olap::tool_definition(),
                sample_stream::tool_definition(),
            ],
            next_cursor: None,
        })
    }

    async fn call_tool(
        &self,
        param: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        self.proxy_tool_call(param).await
    }
}

fn dev_server_not_running_error() -> CallToolResult {
    CallToolResult::error(vec![Content::text(
        "The Moose dev server is not running. \
         Start it in the background by running the shell command `moose dev` \
         (do not wait for it to finish — it is a long-running process). \
         Wait a few seconds for it to initialize, then retry this tool call."
            .to_string(),
    )])
}

/// Minimal no-op client handler used when connecting to the dev server.
/// We only need the client to send tool-call requests; we don't handle
/// any server-initiated requests.
struct NoOpClientHandler;

impl ClientHandler for NoOpClientHandler {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proxy_server_info() {
        let handler = ProxyMcpHandler::new("http://localhost:4000/mcp".to_string());
        let info = handler.get_info();
        assert_eq!(info.server_info.name, "moose-mcp-proxy");
        assert!(info.capabilities.tools.is_some());
    }

    #[test]
    fn test_dev_server_not_running_error_message() {
        let result = dev_server_not_running_error();
        assert_eq!(result.is_error, Some(true));
        assert!(!result.content.is_empty());
    }

    #[test]
    fn test_tool_definitions_complete() {
        let tools = vec![
            logs::tool_definition(),
            infra_map::tool_definition(),
            infra_issues::tool_definition(),
            query_olap::tool_definition(),
            sample_stream::tool_definition(),
        ];
        assert_eq!(tools.len(), 5);

        let names: Vec<&str> = tools.iter().map(|t| t.name.as_ref()).collect();
        assert!(names.contains(&"get_logs"));
        assert!(names.contains(&"get_infra_map"));
        assert!(names.contains(&"get_issues"));
        assert!(names.contains(&"query_olap"));
        assert!(names.contains(&"get_stream_sample"));
    }
}
