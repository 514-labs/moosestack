use log::info;
use rmcp::{
    model::{Implementation, ProtocolVersion, ServerCapabilities, ServerInfo},
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ServerHandler,
};
use std::sync::Arc;

/// Handler for the MCP server that implements the Model Context Protocol
/// Currently implements zero tools as per the initial requirements
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
            capabilities: ServerCapabilities::default(),
            server_info: Implementation {
                name: self.server_name.clone(),
                version: self.server_version.clone(),
                title: None,
                icons: None,
                website_url: None,
            },
            instructions: None,
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
    info!("[MCP] Creating MCP HTTP service: {} v{}", server_name, server_version);

    let session_manager = Arc::new(LocalSessionManager::default());
    let config = StreamableHttpServerConfig {
        sse_keep_alive: Some(std::time::Duration::from_secs(15)),
        stateful_mode: true,
    };

    StreamableHttpService::new(
        move || Ok(MooseMcpHandler::new(server_name.clone(), server_version.clone())),
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
    }

    #[test]
    fn test_handler_clone() {
        let handler = MooseMcpHandler::new("test-server".to_string(), "0.0.1".to_string());
        let cloned = handler.clone();
        assert_eq!(cloned.server_name, handler.server_name);
        assert_eq!(cloned.server_version, handler.server_version);
    }
}