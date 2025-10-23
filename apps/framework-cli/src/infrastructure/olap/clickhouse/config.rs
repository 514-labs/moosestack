//! # Clickhouse Config
//! Module to handle the creation of the Clickhouse config files
//!
//! ## Suggested Improvements
//! - we need to understand clickhouse configuration better before we can go deep on its configuration
//!

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn default_native_port() -> i32 {
    9000
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClusterConfig {
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClickHouseConfig {
    pub db_name: String, // ex. local
    pub user: String,
    pub password: String,
    pub use_ssl: bool,
    pub host: String,   // e.g. localhost
    pub host_port: i32, // e.g. 18123
    #[serde(default = "default_native_port")]
    pub native_port: i32, // e.g. 9000
    /// Optional path on the host machine to mount as the ClickHouse data volume.
    /// If not specified, a Docker-managed volume will be used.
    #[serde(default)]
    pub host_data_path: Option<PathBuf>,
    /// Optional cluster configurations for ON CLUSTER support
    #[serde(default)]
    pub clusters: Option<Vec<ClusterConfig>>,
}

impl Default for ClickHouseConfig {
    fn default() -> Self {
        Self {
            db_name: "local".to_string(),
            user: "panda".to_string(),
            password: "pandapass".to_string(),
            use_ssl: false,
            host: "localhost".to_string(),
            host_port: 18123,
            native_port: default_native_port(),
            host_data_path: None,
            clusters: None,
        }
    }
}
