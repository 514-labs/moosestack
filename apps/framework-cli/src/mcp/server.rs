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

use super::tools::{create_error_result, infra_map, logs, query_olap};
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::redis::redis_client::RedisClient;

/// Handler for the MCP server that implements the Model Context Protocol
#[derive(Clone)]
pub struct MooseMcpHandler {
    server_name: String,
    server_version: String,
    redis_client: Arc<RedisClient>,
    clickhouse_config: ClickHouseConfig,
}

impl MooseMcpHandler {
    /// Create a new MCP handler instance
    pub fn new(
        server_name: String,
        server_version: String,
        redis_client: Arc<RedisClient>,
        clickhouse_config: ClickHouseConfig,
    ) -> Self {
        Self {
            server_name,
            server_version,
            redis_client,
            clickhouse_config,
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
                "Moose MCP Server - Access dev server logs, infrastructure map, and query the OLAP database for debugging, monitoring, and data exploration"
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
            tools: vec![
                logs::tool_definition(),
                infra_map::tool_definition(),
                query_olap::tool_definition(),
            ],
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
            "query_olap" => Ok(query_olap::handle_call(
                &self.clickhouse_config,
                param.arguments.as_ref(),
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
/// * `clickhouse_config` - ClickHouse configuration for database access
///
/// # Returns
/// * `StreamableHttpService` - HTTP service that can handle MCP requests
pub fn create_mcp_http_service(
    server_name: String,
    server_version: String,
    redis_client: Arc<RedisClient>,
    clickhouse_config: ClickHouseConfig,
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
                clickhouse_config.clone(),
            ))
        },
        session_manager,
        config,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::redis::redis_client::RedisConfig;

    async fn get_test_redis_client() -> Arc<RedisClient> {
        let config = RedisConfig::default();
        Arc::new(
            RedisClient::new("test".to_string(), config)
                .await
                .expect("Failed to create test Redis client"),
        )
    }

    fn get_test_clickhouse_config() -> ClickHouseConfig {
        ClickHouseConfig {
            db_name: "test".to_string(),
            host: "localhost".to_string(),
            host_port: 8123,
            native_port: 9000,
            user: "default".to_string(),
            password: "".to_string(),
            use_ssl: false,
            host_data_path: None,
        }
    }

    #[tokio::test]
    async fn test_handler_creation() {
        let redis_client = get_test_redis_client().await;
        let config = get_test_clickhouse_config();
        let handler = MooseMcpHandler::new(
            "test-server".to_string(),
            "0.0.1".to_string(),
            redis_client,
            config.clone(),
        );
        assert_eq!(handler.server_name, "test-server");
        assert_eq!(handler.server_version, "0.0.1");
        assert_eq!(handler.clickhouse_config.db_name, "test");
    }

    #[tokio::test]
    async fn test_handler_get_info() {
        let redis_client = get_test_redis_client().await;
        let config = get_test_clickhouse_config();
        let handler = MooseMcpHandler::new(
            "test-server".to_string(),
            "0.0.1".to_string(),
            redis_client,
            config,
        );
        let info = handler.get_info();
        assert_eq!(info.server_info.name, "test-server");
        assert_eq!(info.server_info.version, "0.0.1");
        assert_eq!(info.protocol_version, ProtocolVersion::V_2024_11_05);
        assert!(info.capabilities.tools.is_some());
        assert!(info.instructions.is_some());
    }

    #[tokio::test]
    async fn test_handler_clone() {
        let redis_client = get_test_redis_client().await;
        let config = get_test_clickhouse_config();
        let handler = MooseMcpHandler::new(
            "test-server".to_string(),
            "0.0.1".to_string(),
            redis_client,
            config,
        );
        let cloned = handler.clone();
        assert_eq!(cloned.server_name, handler.server_name);
        assert_eq!(cloned.server_version, handler.server_version);
        assert_eq!(
            cloned.clickhouse_config.db_name,
            handler.clickhouse_config.db_name
        );
    }
}
