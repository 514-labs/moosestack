use rmcp::{
    model::{
        CallToolRequestParams, CallToolResult, Content, Implementation, ListToolsResult,
        PaginatedRequestParams, ProtocolVersion, ServerCapabilities, ServerInfo,
    },
    service::RequestContext,
    ClientHandler, ErrorData, RoleServer, ServerHandler,
};
use std::time::Duration;
use tracing::{error, info};

use super::tools::all_tool_definitions;
use crate::utilities::constants::CLI_VERSION;

/// Maximum time to wait for the MCP client connection + handshake with the dev server.
const PROXY_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Maximum time to wait for a proxied tool call before returning a timeout error.
const PROXY_TOOL_TIMEOUT: Duration = Duration::from_secs(120);

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

        let running = match tokio::time::timeout(
            PROXY_CONNECT_TIMEOUT,
            rmcp::serve_client(client, transport),
        )
        .await
        {
            Ok(Ok(running)) => running,
            Ok(Err(e)) => {
                info!("[MCP Proxy] Dev server not reachable: {}", e);
                return Ok(dev_server_not_running_error(&self.dev_server_url));
            }
            Err(_elapsed) => {
                info!(
                    "[MCP Proxy] Connection to dev server timed out after {:?}",
                    PROXY_CONNECT_TIMEOUT
                );
                return Ok(dev_server_not_running_error(&self.dev_server_url));
            }
        };

        let result = match tokio::time::timeout(
            PROXY_TOOL_TIMEOUT,
            running.peer().call_tool(params),
        )
        .await
        {
            Ok(inner) => inner,
            Err(_elapsed) => {
                error!(
                    "[MCP Proxy] Tool call timed out after {:?}",
                    PROXY_TOOL_TIMEOUT
                );
                let _ = running.cancel().await;
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Tool call timed out after {} seconds. The Moose dev server may be \
                         overloaded or stuck. Please check `moose dev` output and retry.",
                    PROXY_TOOL_TIMEOUT.as_secs()
                ))]));
            }
        };

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
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_protocol_version(ProtocolVersion::V_2024_11_05)
            .with_server_info(
                Implementation::new("moose-mcp-proxy", CLI_VERSION).with_title("Moose MCP Proxy"),
            )
            .with_instructions(
                "Moose MCP Proxy - Proxies tool calls to the Moose dev server. \
                 If the dev server is not running, tool calls will return an error \
                 asking you to start `moose dev`.",
            )
    }

    async fn list_tools(
        &self,
        _pagination: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(all_tool_definitions()))
    }

    async fn call_tool(
        &self,
        param: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        self.proxy_tool_call(param).await
    }
}

fn dev_server_not_running_error(dev_server_url: &str) -> CallToolResult {
    CallToolResult::error(vec![Content::text(format!(
        "The Moose dev server is not reachable at {dev_server_url}. \
         Start it in the background by running the shell command `moose dev` \
         (do not wait for it to finish — it is a long-running process). \
         Wait a few seconds for it to initialize, then retry this tool call."
    ))])
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
        let result = dev_server_not_running_error("http://localhost:4000/mcp");
        assert_eq!(result.is_error, Some(true));
        assert!(!result.content.is_empty());
    }

    #[test]
    fn test_tool_definitions_complete() {
        let tools = all_tool_definitions();
        assert_eq!(tools.len(), 5);

        let names: Vec<&str> = tools.iter().map(|t| t.name.as_ref()).collect();
        assert!(names.contains(&"get_logs"));
        assert!(names.contains(&"get_infra_map"));
        assert!(names.contains(&"get_issues"));
        assert!(names.contains(&"query_olap"));
        assert!(names.contains(&"get_stream_sample"));
    }
}
