//! Standalone prompt-only MCP server.
//!
//! Spins up a lightweight HTTP server that exposes *only* the
//! `respond_to_prompt` MCP tool. This is used by one-shot commands
//! (e.g. `generate migration --agent`) that need agent-driven prompt
//! responses but don't run the full dev web server.

use std::net::SocketAddr;
use std::sync::Arc;

use http_body_util::BodyExt;
use hyper::body::{Bytes, Incoming};
use hyper::service::Service;
use hyper::{Request, Response};
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::service::TowerToHyperService;
use rmcp::model::{
    CallToolRequestParams, CallToolResult, Implementation, ListToolsResult, PaginatedRequestParams,
    ProtocolVersion, ServerCapabilities, ServerInfo,
};
use rmcp::service::RequestContext;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use rmcp::{ErrorData, RoleServer, ServerHandler};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tracing::info;

use super::tools::{create_error_result, prompt};
use crate::framework::core::prompt_bridge::PromptBridge;
use crate::utilities::constants::CLI_VERSION;

/// MCP handler that only serves the `respond_to_prompt` tool.
#[derive(Clone)]
struct PromptOnlyHandler {
    prompt_bridge: PromptBridge,
}

impl ServerHandler for PromptOnlyHandler {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2024_11_05,
            capabilities: ServerCapabilities {
                tools: Some(Default::default()),
                ..Default::default()
            },
            server_info: Implementation {
                name: "moose-mcp-prompt".into(),
                version: CLI_VERSION.into(),
                title: Some("Moose Prompt MCP Server".to_string()),
                description: None,
                icons: None,
                website_url: None,
            },
            instructions: Some(
                "Lightweight MCP server for responding to Moose CLI confirmation prompts."
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
            tools: vec![prompt::tool_definition()],
            next_cursor: None,
        })
    }

    async fn call_tool(
        &self,
        param: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        match param.name.as_ref() {
            "respond_to_prompt" => {
                Ok(prompt::handle_call(param.arguments.as_ref(), &self.prompt_bridge).await)
            }
            _ => Ok(create_error_result(format!("Unknown tool: {}", param.name))),
        }
    }
}

/// Handle returned by [`start`] that owns the background server task
/// and shuts it down on drop.
pub struct StandaloneMcpServer {
    url: String,
    _task: JoinHandle<()>,
}

impl StandaloneMcpServer {
    /// The MCP endpoint URL (e.g. `http://127.0.0.1:4000/mcp`).
    pub fn url(&self) -> &str {
        &self.url
    }
}

/// Start a standalone HTTP server that serves only the prompt MCP tool.
///
/// Binds to `host:port` (`port=0` for OS-assigned) and returns a
/// [`StandaloneMcpServer`] whose URL can be displayed to the user / agent.
pub async fn start(
    host: &str,
    port: u16,
    bridge: PromptBridge,
) -> Result<StandaloneMcpServer, std::io::Error> {
    let handler = PromptOnlyHandler {
        prompt_bridge: bridge,
    };

    let session_manager = Arc::new(LocalSessionManager::default());
    let config = StreamableHttpServerConfig {
        sse_keep_alive: Some(std::time::Duration::from_secs(1)),
        stateful_mode: false,
        ..Default::default()
    };

    let mcp_service: StreamableHttpService<PromptOnlyHandler, LocalSessionManager> =
        StreamableHttpService::new(move || Ok(handler.clone()), session_manager, config);
    let mcp_tower = TowerToHyperService::new(mcp_service);

    let addr: SocketAddr = format!("{host}:{port}").parse().map_err(|e| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("Bad address {host}:{port}: {e}"),
        )
    })?;
    let listener = TcpListener::bind(addr).await?;
    let local_addr = listener.local_addr()?;
    let url = format!("http://{local_addr}/mcp");

    info!("[MCP standalone] Prompt-only server listening on {url}");

    let task = tokio::spawn(async move {
        loop {
            let (stream, _) = match listener.accept().await {
                Ok(conn) => conn,
                Err(e) => {
                    tracing::warn!("[MCP standalone] Accept error: {e}");
                    continue;
                }
            };

            let mcp = mcp_tower.clone();
            tokio::spawn(async move {
                let io = TokioIo::new(stream);
                let svc = hyper::service::service_fn(move |req: Request<Incoming>| {
                    let mcp = mcp.clone();
                    async move {
                        let path = req.uri().path().to_owned();
                        if path.starts_with("/mcp") {
                            match mcp.call(req).await {
                                Ok(mcp_resp) => {
                                    let (parts, body) = mcp_resp.into_parts();
                                    let bytes: Bytes = body
                                        .collect()
                                        .await
                                        .map(|c| c.to_bytes())
                                        .unwrap_or_default();
                                    Ok::<_, std::convert::Infallible>(Response::from_parts(
                                        parts,
                                        http_body_util::Full::new(bytes),
                                    ))
                                }
                                Err(_) => Ok(Response::builder()
                                    .status(500)
                                    .body(http_body_util::Full::new(Bytes::from("Internal error")))
                                    .unwrap()),
                            }
                        } else {
                            Ok(Response::builder()
                                .status(404)
                                .body(http_body_util::Full::new(Bytes::from("Not found")))
                                .unwrap())
                        }
                    }
                });

                if let Err(e) = hyper_util::server::conn::auto::Builder::new(TokioExecutor::new())
                    .serve_connection(io, svc)
                    .await
                {
                    tracing::debug!("[MCP standalone] Connection error: {e}");
                }
            });
        }
    });

    Ok(StandaloneMcpServer { url, _task: task })
}
