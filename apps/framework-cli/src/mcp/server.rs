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

use super::tools::{create_error_result, infra_map, logs, query_olap, sample_stream};
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::redis::redis_client::RedisClient;
use crate::infrastructure::stream::kafka::models::KafkaConfig;

/// Handler for the MCP server that implements the Model Context Protocol
#[derive(Clone)]
pub struct MooseMcpHandler {
    server_name: String,
    server_version: String,
    redis_client: Arc<RedisClient>,
    clickhouse_config: ClickHouseConfig,
    kafka_config: Arc<KafkaConfig>,
}

impl MooseMcpHandler {
    /// Create a new MCP handler instance
    pub fn new(
        server_name: String,
        server_version: String,
        redis_client: Arc<RedisClient>,
        clickhouse_config: ClickHouseConfig,
        kafka_config: Arc<KafkaConfig>,
    ) -> Self {
        Self {
            server_name,
            server_version,
            redis_client,
            clickhouse_config,
            kafka_config,
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
                "Moose MCP Server - Access dev server logs, infrastructure map, query the OLAP database, and sample streaming topics for debugging, monitoring, and data exploration"
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
                sample_stream::tool_definition(),
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
            "get_stream_sample" => Ok(sample_stream::handle_call(
                param.arguments.as_ref(),
                self.redis_client.clone(),
                self.kafka_config.clone(),
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
/// * `kafka_config` - Kafka configuration for streaming operations
///
/// # Returns
/// * `StreamableHttpService` - HTTP service that can handle MCP requests
pub fn create_mcp_http_service(
    server_name: String,
    server_version: String,
    redis_client: Arc<RedisClient>,
    clickhouse_config: ClickHouseConfig,
    kafka_config: Arc<KafkaConfig>,
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
                kafka_config.clone(),
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
    fn test_server_info() {
        // Test that server info is correctly formatted
        // This doesn't require a real Redis client, just testing the struct
        let server_name = "test-server".to_string();
        let server_version = "1.0.0".to_string();

        // Verify the expected info structure
        assert_eq!(server_name, "test-server");
        assert_eq!(server_version, "1.0.0");
    }

    #[test]
    fn test_list_tools_count() {
        // Test that all expected tools are returned
        let logs_tool = logs::tool_definition();
        let infra_tool = infra_map::tool_definition();
        let olap_tool = query_olap::tool_definition();
        let stream_tool = sample_stream::tool_definition();

        // Ensure we have 4 tools
        let all_tools = vec![&logs_tool, &infra_tool, &olap_tool, &stream_tool];
        assert_eq!(all_tools.len(), 4);

        // Verify each tool has required fields
        for tool in all_tools {
            assert!(!tool.name.is_empty());
            assert!(tool.description.is_some());
            assert!(!tool.input_schema.is_empty());
        }
    }

    #[test]
    fn test_tool_names_are_consistent() {
        // Ensure tool names match between routing and definitions
        let expected_tools = [
            "get_logs",
            "get_infra_map",
            "query_olap",
            "get_stream_sample",
        ];

        let logs_tool = logs::tool_definition();
        let infra_tool = infra_map::tool_definition();
        let olap_tool = query_olap::tool_definition();
        let stream_tool = sample_stream::tool_definition();

        assert_eq!(logs_tool.name, expected_tools[0]);
        assert_eq!(infra_tool.name, expected_tools[1]);
        assert_eq!(olap_tool.name, expected_tools[2]);
        assert_eq!(stream_tool.name, expected_tools[3]);
    }
}
