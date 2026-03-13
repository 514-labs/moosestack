pub mod cmd;
pub mod connection;
pub mod db;
pub mod frame;
pub mod lua;
pub mod parse;
pub mod server;
pub mod shutdown;

/// Error type used throughout the crate.
pub type Error = Box<dyn std::error::Error + Send + Sync>;

/// Result type used throughout the crate.
pub type Result<T> = std::result::Result<T, Error>;
