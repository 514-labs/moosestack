mod compressed_map;
mod embedded_docs;
mod infra_resources;
mod server;
mod tools;

pub use compressed_map::{
    build_compressed_map, build_resource_uri, parse_resource_uri, ComponentNode, ComponentStatus,
    ComponentType, CompressedInfraMap, Connection, ConnectionType, MapStats,
};
pub use embedded_docs::{list_resources, read_resource};
pub use infra_resources::{list_infra_resources, read_infra_resource};
pub use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpService,
};
pub use server::{create_mcp_http_service, MooseMcpHandler};
