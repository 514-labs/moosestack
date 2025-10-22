//! # Clickhouse Config
//! Module to handle the creation of the Clickhouse config files
//!
//! ## Suggested Improvements
//! - we need to understand clickhouse configuration better before we can go deep on its configuration
//!

use crate::utilities::clickhouse_url::convert_http_to_clickhouse;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn default_native_port() -> i32 {
    9000
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
        }
    }
}

/// Parses a ClickHouse connection string (URL) into a ClickHouseConfig
///
/// Supports multiple URL schemes (https, clickhouse) and extracts database name from path or query parameter.
/// Automatically determines SSL usage based on scheme and port.
pub fn parse_clickhouse_connection_string(conn_str: &str) -> anyhow::Result<ClickHouseConfig> {
    let url = convert_http_to_clickhouse(conn_str)?;

    let user = url.username().to_string();
    let password = url.password().unwrap_or("").to_string();
    let host = url.host_str().unwrap_or("localhost").to_string();

    // Determine SSL based on scheme and port
    let use_ssl = match url.scheme() {
        "https" => true,
        "clickhouse" => url.port().unwrap_or(9000) == 9440,
        _ => url.port().unwrap_or(9000) == 9440,
    };

    let port = url.port().unwrap_or(if use_ssl { 9440 } else { 9000 }) as i32;

    // Get database name from path or query parameter, default to "default"
    let db_name = if !url.path().is_empty() && url.path() != "/" {
        url.path().trim_start_matches('/').to_string()
    } else {
        url.query_pairs()
            .find(|(k, _)| k == "database")
            .map(|(_, v)| v.to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "default".to_string())
    };

    let config = ClickHouseConfig {
        db_name,
        user,
        password,
        use_ssl,
        host,
        host_port: port,
        native_port: port,
        host_data_path: None,
    };

    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_clickhouse_connection_string_basic() {
        let conn_str = "clickhouse://user:pass@host:9440/mydb";
        let result = parse_clickhouse_connection_string(conn_str);

        assert!(result.is_ok());
        let config = result.unwrap();

        assert_eq!(config.user, "user");
        assert_eq!(config.password, "pass");
        assert_eq!(config.host, "host");
        assert_eq!(config.native_port, 9440);
        assert!(config.use_ssl);
        assert_eq!(config.db_name, "mydb");
    }

    #[test]
    fn test_parse_clickhouse_connection_string_no_ssl() {
        let conn_str = "clickhouse://user:pass@host:9000/mydb";
        let result = parse_clickhouse_connection_string(conn_str);

        assert!(result.is_ok());
        let config = result.unwrap();

        assert!(!config.use_ssl);
        assert_eq!(config.native_port, 9000);
    }

    #[test]
    fn test_parse_clickhouse_connection_string_no_database() {
        let conn_str = "clickhouse://user:pass@host:9440";
        let result = parse_clickhouse_connection_string(conn_str);

        assert!(result.is_ok());
        let config = result.unwrap();

        // Should default to "default" database when none specified
        assert_eq!(config.db_name, "default");
    }

    #[test]
    fn test_parse_clickhouse_connection_string_database_in_query() {
        let conn_str = "clickhouse://user:pass@host:9440?database=mydb";
        let result = parse_clickhouse_connection_string(conn_str);

        assert!(result.is_ok());
        let config = result.unwrap();

        assert_eq!(config.db_name, "mydb");
    }

    #[test]
    fn test_parse_clickhouse_connection_string_https_scheme() {
        let conn_str = "https://user:pass@host/mydb";
        let result = parse_clickhouse_connection_string(conn_str);

        assert!(result.is_ok());
        let config = result.unwrap();

        assert!(config.use_ssl);
        assert_eq!(config.native_port, 9440);
    }
}
