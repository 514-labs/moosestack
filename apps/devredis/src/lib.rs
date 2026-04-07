/// Redis command implementations.
pub mod cmd;
/// TCP connection framing (read/write RESP frames).
pub mod connection;
/// In-memory key-value database with expiry and pub/sub.
pub mod db;
/// RESP2 protocol frame types and wire-format parsing.
pub mod frame;
/// Lua scripting engine for EVAL.
pub mod lua;
/// Command argument parser over RESP arrays.
pub mod parse;
/// TCP server: listener, per-connection handler, graceful shutdown.
pub mod server;
/// Shutdown signal broadcast primitive.
pub mod shutdown;

/// Error type used throughout the crate.
pub type Error = Box<dyn std::error::Error + Send + Sync>;

/// Result type used throughout the crate.
pub type Result<T> = std::result::Result<T, Error>;
