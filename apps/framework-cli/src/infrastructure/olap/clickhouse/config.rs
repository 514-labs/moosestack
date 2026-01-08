//! # Clickhouse Config
//! Module to handle the creation of the Clickhouse config files
//!
//! ## Suggested Improvements
//! - we need to understand clickhouse configuration better before we can go deep on its configuration
//!

use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Default database name used by ClickHouse when not otherwise specified.
/// This is used as the default value for ClickHouseConfig::db_name and for
/// normalizing table IDs when table.database is None.
pub const DEFAULT_DATABASE_NAME: &str = "local";

// Default functions for RemoteClickHouseConfig (uses u16)
fn default_http_port() -> u16 {
    8123 // Non-TLS default
}

fn default_native_port_u16() -> u16 {
    9000
}

// Default function for ClickHouseConfig (uses i32 for backward compatibility)
fn default_native_port_i32() -> i32 {
    9000
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClusterConfig {
    pub name: String,
}

/// Remote ClickHouse connection configuration (without password)
/// Password is stored separately in the system keychain for security
///
/// # Port Configuration
/// - `http_port`: Used for HTTP API operations (schema introspection, `moose db pull`)
/// - `native_port`: Used for native protocol operations (`moose seed`, local mirrors via remoteSecure)
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RemoteClickHouseConfig {
    pub host: String,
    /// HTTP API port (default: 8123, use 8443 for TLS)
    #[serde(default = "default_http_port")]
    pub http_port: u16,
    /// Native protocol port (default: 9000, use 9440 for TLS)
    #[serde(default = "default_native_port_u16")]
    pub native_port: u16,
    pub database: String,
    pub user: String,
    #[serde(default)]
    pub use_ssl: bool,
}

impl RemoteClickHouseConfig {
    /// Converts to a full ClickHouseConfig by adding the password from keychain
    pub fn to_clickhouse_config(&self, password: String) -> ClickHouseConfig {
        ClickHouseConfig {
            db_name: self.database.clone(),
            user: self.user.clone(),
            password,
            use_ssl: self.use_ssl,
            host: self.host.clone(),
            host_port: self.http_port as i32, // Explicit, no magic inference!
            native_port: self.native_port as i32,
            host_data_path: None,
            additional_databases: Vec::new(),
            clusters: None,
        }
    }

    /// Returns a display string for the HTTP API connection (without password)
    ///
    /// Use this when displaying connection info for HTTP-based operations like:
    /// - `moose db pull`
    /// - Schema introspection
    pub fn display_http_connection(&self) -> String {
        let protocol = if self.use_ssl { "https" } else { "http" };
        format!(
            "{}://{}@{}:{}?database={}",
            protocol, self.user, self.host, self.http_port, self.database
        )
    }

    /// Returns a display string for the native protocol connection (without password)
    ///
    /// Use this when displaying connection info for native protocol operations like:
    /// - `moose seed`
    /// - Local mirrors (`remoteSecure`)
    pub fn display_native_connection(&self) -> String {
        format!(
            "{}@{}:{} (database: {})",
            self.user, self.host, self.native_port, self.database
        )
    }

    /// Checks if a stored URL matches this configuration
    ///
    /// Validates that the URL's host, username, and database match this config.
    /// Used to determine if a stored keychain URL is still valid for the current config.
    pub fn matches_url(&self, url: &reqwest::Url) -> bool {
        url.host_str() == Some(&self.host)
            && url.username() == self.user
            && url
                .query_pairs()
                .find(|(k, _)| k == "database")
                .map(|(_, v)| v == self.database.as_str())
                .unwrap_or(false)
    }

    /// Builds a complete ClickHouse connection URL with password
    ///
    /// This URL can be stored in keychain or used with `parse_clickhouse_connection_string()`
    ///
    /// # Arguments
    /// * `password` - The password to include in the URL
    ///
    /// # Returns
    /// Complete URL string like: `https://user:pass@host:8443?database=dbname&native_port=9440`
    pub fn build_url_with_password(&self, password: &str) -> Result<String, String> {
        let protocol = if self.use_ssl { "https" } else { "http" };

        // Use http_port in URL (correct for HTTP/S scheme)
        let mut url =
            reqwest::Url::parse(&format!("{}://{}:{}", protocol, self.host, self.http_port))
                .map_err(|e| format!("Failed to construct URL: {e}"))?;

        url.set_username(&self.user)
            .map_err(|_| "Failed to set username".to_string())?;

        url.set_password(Some(password))
            .map_err(|_| "Failed to set password".to_string())?;

        url.query_pairs_mut()
            .append_pair("database", &self.database)
            // Store native_port explicitly to preserve it on round-trip parsing
            .append_pair("native_port", &self.native_port.to_string());

        Ok(url.to_string())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClickHouseConfig {
    pub db_name: String, // ex. local (primary database)
    pub user: String,
    pub password: String,
    pub use_ssl: bool,
    pub host: String,   // e.g. localhost
    pub host_port: i32, // e.g. 18123
    #[serde(default = "default_native_port_i32")]
    pub native_port: i32, // e.g. 9000
    /// Optional path on the host machine to mount as the ClickHouse data volume.
    /// If not specified, a Docker-managed volume will be used.
    #[serde(default)]
    pub host_data_path: Option<PathBuf>,
    /// Additional databases to create and manage alongside the primary database.
    /// Tables can specify which database they belong to using the database field.
    /// Example: additional_databases = ["warehouse", "analytics", "logging"]
    #[serde(default)]
    pub additional_databases: Vec<String>,
    /// Optional cluster configurations for ON CLUSTER support
    #[serde(default)]
    pub clusters: Option<Vec<ClusterConfig>>,
}

impl Default for ClickHouseConfig {
    fn default() -> Self {
        Self {
            db_name: DEFAULT_DATABASE_NAME.to_string(),
            user: "panda".to_string(),
            password: "pandapass".to_string(),
            use_ssl: false,
            host: "localhost".to_string(),
            host_port: 18123,
            native_port: default_native_port_i32(),
            host_data_path: None,
            additional_databases: Vec::new(),
            clusters: None,
        }
    }
}

impl ClickHouseConfig {
    /// Returns a display-safe connection URL with the password masked for a specific database.
    pub fn display_url_for_database(&self, database: &str) -> String {
        let protocol = if self.use_ssl { "https" } else { "http" };
        if self.password.is_empty() {
            format!(
                "{}://{}@{}:{}/?database={}",
                protocol, self.user, self.host, self.host_port, database
            )
        } else {
            format!(
                "{}://{}:******@{}:{}/?database={}",
                protocol, self.user, self.host, self.host_port, database
            )
        }
    }

    /// Returns a display-safe connection URL with the password masked.
    pub fn display_url(&self) -> String {
        self.display_url_for_database(&self.db_name)
    }
}

/// Result of parsing a ClickHouse connection string, including conversion metadata
#[derive(Debug, Clone)]
pub struct ParsedConnectionString {
    pub config: ClickHouseConfig,
    pub was_native_protocol: bool,
    pub display_url: String,
    pub database_was_explicit: bool,
}

/// Parses a ClickHouse connection string (URL) into a ClickHouseConfig
///
/// Supports multiple URL schemes (https, clickhouse) and extracts database name from path or query parameter.
/// Automatically determines SSL usage based on scheme and port.
/// Percent-decodes username and password for proper handling of special characters.
pub fn parse_clickhouse_connection_string(conn_str: &str) -> anyhow::Result<ClickHouseConfig> {
    parse_clickhouse_connection_string_with_metadata(conn_str).map(|parsed| parsed.config)
}

/// Parses a ClickHouse connection string with metadata about conversions performed
///
/// Returns additional information useful for displaying user-facing messages,
/// such as whether native protocol conversion occurred and a display-safe URL.
pub fn parse_clickhouse_connection_string_with_metadata(
    conn_str: &str,
) -> anyhow::Result<ParsedConnectionString> {
    let url = Url::parse(conn_str)?;
    let was_native_protocol = url.scheme() == "clickhouse";

    // Percent-decode username and password to handle special characters
    let user = percent_encoding::percent_decode_str(url.username())
        .decode_utf8_lossy()
        .to_string();
    let password = url
        .password()
        .map(|p| {
            percent_encoding::percent_decode_str(p)
                .decode_utf8_lossy()
                .to_string()
        })
        .unwrap_or_default();
    let host = url.host_str().unwrap_or("localhost").to_string();

    let mut http_port: Option<u16> = None;
    let mut native_port: Option<u16> = None;

    // Determine SSL based on scheme and port
    let use_ssl = match url.scheme() {
        "https" => {
            http_port = Some(url.port().unwrap_or(443));
            true
        }
        "http" => {
            http_port = Some(url.port().unwrap_or(80));
            false
        }
        "clickhouse" => {
            let port = url.port().unwrap_or(9000);
            native_port = Some(port);
            port == 9440
        }
        _ => url.port().unwrap_or(9000) == 9440,
    };

    let http_port = http_port.unwrap_or(if use_ssl { 8443 } else { 8123 }) as i32;

    // Check for explicit native_port in query params (preserves round-trip from build_url_with_password)
    let native_port_from_query: Option<u16> = url
        .query_pairs()
        .find(|(k, _)| k == "native_port")
        .and_then(|(_, v)| v.parse().ok());

    let native_port =
        native_port_from_query.unwrap_or(native_port.unwrap_or(if use_ssl { 9440 } else { 9000 }))
            as i32;

    // Check if username is in query parameters (with percent-decoding)
    let user = if user.is_empty() {
        url.query_pairs()
            .find(|(key, _)| key == "user")
            .map(|(_, v)| v.to_string())
            .unwrap_or_default()
    } else {
        user
    };

    // Get database name from path or query parameter, default to "default"
    // Also track whether database was explicitly specified
    let (db_name, database_was_explicit) =
        if !url.path().is_empty() && url.path() != "/" && url.path() != "//" {
            (url.path().trim_start_matches('/').to_string(), true)
        } else {
            match url
                .query_pairs()
                .find(|(k, _)| k == "database")
                .map(|(_, v)| v.to_string())
                .filter(|s| !s.is_empty())
            {
                Some(db) => (db, true),
                None => ("default".to_string(), false),
            }
        };

    let config = ClickHouseConfig {
        db_name: db_name.clone(),
        user: user.clone(),
        password: password.clone(),
        use_ssl,
        host: host.clone(),
        host_port: http_port,
        native_port,
        host_data_path: None,
        additional_databases: Vec::new(),
        clusters: None,
    };

    // Create display URL (HTTP(S) protocol with masked password)
    let protocol = if use_ssl { "https" } else { "http" };
    let display_url = if password.is_empty() {
        format!(
            "{}://{}@{}:{}/?database={}",
            protocol, user, host, http_port, db_name
        )
    } else {
        format!(
            "{}://{}:******@{}:{}/?database={}",
            protocol, user, host, http_port, db_name
        )
    };

    Ok(ParsedConnectionString {
        config,
        was_native_protocol,
        display_url,
        database_was_explicit,
    })
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

    #[test]
    fn test_remote_clickhouse_config_default_ports() {
        // Test that default values are applied when fields are missing
        let json = r#"{"host": "example.com", "database": "db", "user": "admin"}"#;
        let config: RemoteClickHouseConfig = serde_json::from_str(json).unwrap();

        assert_eq!(config.http_port, 8123); // Default non-TLS HTTP port
        assert_eq!(config.native_port, 9000); // Default non-TLS native port
        assert!(!config.use_ssl); // Default no SSL
    }

    #[test]
    fn test_remote_clickhouse_config_explicit_ports() {
        // Test that explicit values override defaults
        let json = r#"{"host": "example.com", "http_port": 8443, "native_port": 9440, "database": "db", "user": "admin", "use_ssl": true}"#;
        let config: RemoteClickHouseConfig = serde_json::from_str(json).unwrap();

        assert_eq!(config.http_port, 8443);
        assert_eq!(config.native_port, 9440);
        assert!(config.use_ssl);
    }

    #[test]
    fn test_remote_clickhouse_config_to_clickhouse_config_uses_explicit_http_port() {
        let remote_config = RemoteClickHouseConfig {
            host: "example.com".to_string(),
            http_port: 8443,
            native_port: 9440,
            database: "production".to_string(),
            user: "admin".to_string(),
            use_ssl: true,
        };

        let ch_config = remote_config.to_clickhouse_config("secret".to_string());

        // Verify http_port is used directly (no magic inference from use_ssl)
        assert_eq!(ch_config.host_port, 8443);
        assert_eq!(ch_config.native_port, 9440);
        assert_eq!(ch_config.db_name, "production");
        assert_eq!(ch_config.user, "admin");
        assert_eq!(ch_config.password, "secret");
        assert!(ch_config.use_ssl);
    }

    #[test]
    fn test_remote_clickhouse_config_display_http_connection() {
        let config = RemoteClickHouseConfig {
            host: "example.com".to_string(),
            http_port: 8443,
            native_port: 9440,
            database: "production".to_string(),
            user: "admin".to_string(),
            use_ssl: true,
        };

        let display = config.display_http_connection();
        // Should use http_port (8443)
        assert!(display.contains(":8443?"));
        assert!(display.contains("https://"));
        assert!(display.contains("admin@example.com"));
    }

    #[test]
    fn test_remote_clickhouse_config_display_native_connection() {
        let config = RemoteClickHouseConfig {
            host: "example.com".to_string(),
            http_port: 8443,
            native_port: 9440,
            database: "production".to_string(),
            user: "admin".to_string(),
            use_ssl: true,
        };

        let display = config.display_native_connection();
        // Should use native_port (9440)
        assert!(display.contains(":9440"));
        assert!(display.contains("admin@example.com"));
        assert!(display.contains("production"));
    }

    #[test]
    fn test_build_url_with_password_round_trip() {
        // Test that non-standard ports survive the build -> parse round-trip
        let config = RemoteClickHouseConfig {
            host: "custom.example.com".to_string(),
            http_port: 8444,   // Non-standard HTTP port
            native_port: 9441, // Non-standard native port
            database: "mydb".to_string(),
            user: "testuser".to_string(),
            use_ssl: true,
        };

        // Build URL with password
        let url = config.build_url_with_password("secret123").unwrap();

        // URL should use http_port in port position and native_port as query param
        assert!(url.contains(":8444"));
        assert!(url.contains("native_port=9441"));

        // Parse it back
        let parsed = parse_clickhouse_connection_string(&url).unwrap();

        // Verify both ports survived the round-trip
        assert_eq!(parsed.host_port, 8444); // http_port preserved
        assert_eq!(parsed.native_port, 9441); // native_port preserved from query param
        assert_eq!(parsed.db_name, "mydb");
        assert_eq!(parsed.user, "testuser");
        assert_eq!(parsed.password, "secret123");
        assert!(parsed.use_ssl);
    }

    #[test]
    fn test_parse_native_port_from_query_param() {
        // Test parsing URL with explicit native_port query param
        let url = "https://user:pass@host:8443?database=db&native_port=9999";
        let config = parse_clickhouse_connection_string(url).unwrap();

        assert_eq!(config.host_port, 8443);
        assert_eq!(config.native_port, 9999); // From query param, not inferred
        assert!(config.use_ssl);
    }
}
