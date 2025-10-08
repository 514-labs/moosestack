use anyhow::Result;
use log::info;
use rmcp::{
    model::{Implementation, ProtocolVersion, ServerCapabilities, ServerInfo},
    ServerHandler,
};
use tokio::task::JoinHandle;

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

/// Handle for managing the MCP server lifecycle
pub struct McpServerHandle {
    join_handle: JoinHandle<Result<()>>,
}

impl McpServerHandle {
    /// Wait for the MCP server to complete
    pub async fn wait(self) -> Result<()> {
        match self.join_handle.await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => {
                log::error!("[MCP] Server error: {}", e);
                Err(e)
            }
            Err(e) => {
                log::error!("[MCP] Server task panicked: {}", e);
                Err(anyhow::anyhow!("MCP server task panicked: {}", e))
            }
        }
    }
}

/// Start the MCP server with stdio transport
///
/// # Arguments
/// * `server_name` - Name of the MCP server
/// * `server_version` - Version of the MCP server
///
/// # Returns
/// * `Result<McpServerHandle>` - Handle to the running server
pub fn start_mcp_server(server_name: String, server_version: String) -> Result<McpServerHandle> {
    info!("[MCP] Starting MCP server: {} v{}", server_name, server_version);

    let handler = MooseMcpHandler::new(server_name, server_version);

    // Spawn the server in a separate task
    let join_handle = tokio::spawn(async move {
        use rmcp::{ServiceExt, transport::stdio};
        
        info!("[MCP] Initializing stdio transport");
        let transport = stdio();
        
        info!("[MCP] Starting server loop");
        let _running = handler.serve(transport).await
            .map_err(|e| anyhow::anyhow!("Failed to serve MCP: {:?}", e))?;
        
        info!("[MCP] Server stopped");
        Ok(())
    });

    Ok(McpServerHandle { join_handle })
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