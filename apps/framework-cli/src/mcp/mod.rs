mod embedded_docs;
mod server;
mod tools;

pub use embedded_docs::{list_resources, read_resource};
pub use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpService,
};
pub use server::{create_mcp_http_service, MooseMcpHandler};
