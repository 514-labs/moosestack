use log::info;
use rmcp::{
    model::{
        CallToolRequestParam, CallToolResult, Implementation, ListToolsResult,
        PaginatedRequestParam, ProtocolVersion, ServerCapabilities, ServerInfo,
    },
    service::RequestContext,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ErrorData, RoleServer, ServerHandler,
};
use std::sync::Arc;

use super::tools::{create_error_result, infra_map, logs};
use crate::infrastructure::redis::redis_client::RedisClient;

/// Handler for the MCP server that implements the Model Context Protocol
#[derive(Clone)]
pub struct MooseMcpHandler {
    server_name: String,
    server_version: String,
    redis_client: Arc<RedisClient>,
}

impl MooseMcpHandler {
    /// Create a new MCP handler instance
    pub fn new(
        server_name: String,
        server_version: String,
        redis_client: Arc<RedisClient>,
    ) -> Self {
        Self {
            server_name,
            server_version,
            redis_client,
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
                "Moose MCP Server - Access dev server logs and infrastructure map for debugging and monitoring"
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
            tools: vec![logs::tool_definition(), infra_map::tool_definition()],
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
            "get_infra_map" => Ok(infra_map::handle_call(
                param.arguments.as_ref(),
                self.redis_client.clone(),
            )
            .await),
            _ => Ok(create_error_result(format!("Unknown tool: {}", param.name))),
        }
    }
}

/// Create an MCP HTTP service that can be integrated with the existing web server
///
/// # Arguments
/// * `server_name` - Name of the MCP server
/// * `server_version` - Version of the MCP server
/// * `redis_client` - Redis client for accessing infrastructure state
///
/// # Returns
/// * `StreamableHttpService` - HTTP service that can handle MCP requests
pub fn create_mcp_http_service(
    server_name: String,
    server_version: String,
    redis_client: Arc<RedisClient>,
) -> StreamableHttpService<MooseMcpHandler, LocalSessionManager> {
    info!(
        "[MCP] Creating MCP HTTP service: {} v{}",
        server_name, server_version
    );

    let session_manager = Arc::new(LocalSessionManager::default());
    let config = StreamableHttpServerConfig {
        // keep alive low so that we can shut down the server when we're done
        // and that it doesn't hang around forever
        sse_keep_alive: Some(std::time::Duration::from_secs(1)),
        stateful_mode: true,
    };

    StreamableHttpService::new(
        move || {
            Ok(MooseMcpHandler::new(
                server_name.clone(),
                server_version.clone(),
                redis_client.clone(),
            ))
        },
        session_manager,
        config,
    )
}
