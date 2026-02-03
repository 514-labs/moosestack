//! Remote ClickHouse connection utilities
//!
//! This module provides utilities for querying remote ClickHouse instances.
//!
//! # Protocol Support
//!
//! - [`Protocol::Http`]: Uses the `url()` table function over HTTP/HTTPS.
//!   **Dev mode only** - see security warnings below.
//! - `Protocol::Native` (future): Will use `remoteSecure()` for production.
//!
//! # ⚠️ Security Warning (HTTP Protocol)
//!
//! The HTTP protocol is intended for **local development only**.
//!
//! Do NOT use `Protocol::Http` in production because:
//! - Query text (including `url()` calls) may be logged in `system.query_log`
//! - Error messages may expose connection URLs
//! - HTTP traffic between ClickHouse instances lacks the security of native protocols
//!
//! For production, wait for `Protocol::Native` support or use ClickHouse's
//! native `remoteSecure()` directly.

use std::fmt;

use super::config::ClickHouseConfig;
use urlencoding::encode;

/// Escapes a string for use in a SQL string literal.
///
/// Escapes backslashes and single quotes by doubling them:
/// - `\` -> `\\`
/// - `'` -> `''`
fn escape_sql_string_literal(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "''")
}

/// Protocol to use for remote ClickHouse connections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Protocol {
    /// HTTP/HTTPS protocol using the `url()` table function.
    ///
    /// ⚠️ **Dev mode only** - credentials may be exposed in query logs.
    /// Uses `X-ClickHouse-User` and `X-ClickHouse-Key` headers for auth.
    #[default]
    Http,
    // Future: Native protocol using remoteSecure()
    // Native,
}

/// Remote ClickHouse connection for querying external ClickHouse instances.
///
/// This struct builds SQL fragments that query a remote ClickHouse instance.
/// The protocol determines which table function is used.
///
/// # Example
///
/// ```ignore
/// let remote = ClickHouseRemote::from_config(&config, Protocol::Http);
///
/// // Build a table function to query a remote table
/// let sql = format!(
///     "SELECT * FROM {}",
///     remote.query_function("SELECT name, value FROM system.settings LIMIT 10")
/// );
/// ```
///
/// # Security Note
///
/// The `Debug` implementation redacts the password field to prevent
/// accidental exposure in logs.
#[derive(Clone)]
pub struct ClickHouseRemote {
    /// Remote server hostname
    pub host: String,
    /// Port number (HTTP port for Http protocol, native port for Native)
    pub port: u16,
    /// Default database on the remote server
    pub database: String,
    /// Username for authentication
    pub user: String,
    /// Password for authentication
    pub password: String,
    /// Whether to use SSL/TLS
    pub use_ssl: bool,
    /// Protocol to use for connections
    pub protocol: Protocol,
}

impl fmt::Debug for ClickHouseRemote {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ClickHouseRemote")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("database", &self.database)
            .field("user", &self.user)
            .field("password", &"[REDACTED]")
            .field("use_ssl", &self.use_ssl)
            .field("protocol", &self.protocol)
            .finish()
    }
}

impl ClickHouseRemote {
    /// Creates a ClickHouseRemote from a ClickHouseConfig.
    ///
    /// The port is selected based on the protocol:
    /// - `Protocol::Http`: Uses `host_port` (HTTP port)
    /// - `Protocol::Native`: Would use `native_port`
    ///
    /// # Panics
    ///
    /// Panics if the port value in the config is negative or exceeds u16::MAX (65535).
    pub fn from_config(config: &ClickHouseConfig, protocol: Protocol) -> Self {
        let port = match protocol {
            Protocol::Http => {
                u16::try_from(config.host_port).expect("host_port must be a valid u16 (0-65535)")
            }
            // Protocol::Native => u16::try_from(config.native_port)
            //     .expect("native_port must be a valid u16 (0-65535)"),
        };

        Self {
            host: config.host.clone(),
            port,
            database: config.db_name.clone(),
            user: config.user.clone(),
            password: config.password.clone(),
            use_ssl: config.use_ssl,
            protocol,
        }
    }

    /// Creates a new ClickHouseRemote with explicit parameters.
    pub fn new(
        host: impl Into<String>,
        port: u16,
        database: impl Into<String>,
        user: impl Into<String>,
        password: impl Into<String>,
        use_ssl: bool,
        protocol: Protocol,
    ) -> Self {
        Self {
            host: host.into(),
            port,
            database: database.into(),
            user: user.into(),
            password: password.into(),
            use_ssl,
            protocol,
        }
    }

    /// Builds a table function call for executing a query on the remote server.
    ///
    /// The function used depends on the protocol:
    /// - `Protocol::Http`: Returns a `url()` function call
    /// - `Protocol::Native`: Would return a `remoteSecure()` call (future)
    ///
    /// # Arguments
    /// * `query` - The SQL query to execute on the remote server
    ///
    /// # Example
    /// ```ignore
    /// let func = remote.query_function("SELECT 1");
    /// let sql = format!("SELECT * FROM {}", func);
    /// ```
    pub fn query_function(&self, query: &str) -> String {
        match self.protocol {
            Protocol::Http => self.build_http_url_function(query),
            // Protocol::Native => self.build_remote_secure_function(query),
        }
    }

    /// Builds a table function with a custom output format.
    ///
    /// # Arguments
    /// * `query` - The SQL query to execute on the remote server
    /// * `format` - The output format (e.g., "TabSeparated", "JSONEachRow")
    pub fn query_function_with_format(&self, query: &str, format: &str) -> String {
        match self.protocol {
            Protocol::Http => self.build_http_url_function_with_format(query, format),
            // Protocol::Native => self.build_remote_secure_function(query), // format handled differently
        }
    }

    /// Builds a table function to SELECT from a remote table.
    ///
    /// # Arguments
    /// * `database` - The database name on the remote server
    /// * `table` - The table name on the remote server
    /// * `columns` - Column selection (e.g., "*" or "col1, col2")
    /// * `where_clause` - Optional WHERE clause (without the "WHERE" keyword)
    pub fn select_from_table(
        &self,
        database: &str,
        table: &str,
        columns: &str,
        where_clause: Option<&str>,
    ) -> String {
        let query = match where_clause {
            Some(w) => format!("SELECT {} FROM {}.{} WHERE {}", columns, database, table, w),
            None => format!("SELECT {} FROM {}.{}", columns, database, table),
        };
        self.query_function(&query)
    }

    /// Builds a table function to SELECT from a system table.
    ///
    /// # Arguments
    /// * `system_table` - The system table name (e.g., "tables", "columns")
    /// * `columns` - Column selection
    /// * `where_clause` - Optional WHERE clause
    pub fn select_from_system_table(
        &self,
        system_table: &str,
        columns: &str,
        where_clause: Option<&str>,
    ) -> String {
        self.select_from_table("system", system_table, columns, where_clause)
    }

    // -------------------------------------------------------------------------
    // HTTP Protocol Implementation
    // -------------------------------------------------------------------------

    /// Returns the HTTP scheme (http or https).
    fn http_scheme(&self) -> &'static str {
        if self.use_ssl {
            "https"
        } else {
            "http"
        }
    }

    /// Returns the base URL for HTTP requests.
    fn http_base_url(&self) -> String {
        format!("{}://{}:{}", self.http_scheme(), self.host, self.port)
    }

    /// Builds the URL with query parameter (no credentials in URL).
    fn http_query_url(&self, query: &str) -> String {
        format!("{}/?query={}", self.http_base_url(), encode(query))
    }

    /// Builds the headers clause for authentication.
    ///
    /// Credentials are escaped for SQL string literals:
    /// - Backslashes are doubled (`\` -> `\\`)
    /// - Single quotes are doubled (`'` -> `''`)
    fn http_headers_clause(&self) -> String {
        let escaped_user = escape_sql_string_literal(&self.user);
        let escaped_password = escape_sql_string_literal(&self.password);
        format!(
            "headers('X-ClickHouse-User'='{}', 'X-ClickHouse-Key'='{}')",
            escaped_user, escaped_password
        )
    }

    /// Builds a `url()` table function with TabSeparatedWithNamesAndTypes format.
    fn build_http_url_function(&self, query: &str) -> String {
        self.build_http_url_function_with_format(query, "TabSeparatedWithNamesAndTypes")
    }

    /// Builds a `url()` table function with a custom format.
    fn build_http_url_function_with_format(&self, query: &str, format: &str) -> String {
        format!(
            "url('{}', '{}', {})",
            self.http_query_url(query),
            escape_sql_string_literal(format),
            self.http_headers_clause()
        )
    }

    // -------------------------------------------------------------------------
    // Native Protocol Implementation (Future)
    // -------------------------------------------------------------------------

    // fn build_remote_secure_function(&self, database: &str, table: &str) -> String {
    //     format!(
    //         "remoteSecure('{}:{}', '{}', '{}', '{}', '{}')",
    //         self.host, self.port, database, table, self.user, self.password
    //     )
    // }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_config() -> ClickHouseConfig {
        ClickHouseConfig {
            host: "remote.example.com".to_string(),
            native_port: 9440,
            db_name: "production".to_string(),
            user: "admin".to_string(),
            password: "secret123".to_string(),
            use_ssl: true,
            host_port: 8443,
            host_data_path: None,
            additional_databases: vec![],
            clusters: None,
        }
    }

    #[test]
    fn test_from_config_http() {
        let config = create_test_config();
        let remote = ClickHouseRemote::from_config(&config, Protocol::Http);

        assert_eq!(remote.host, "remote.example.com");
        assert_eq!(remote.port, 8443); // HTTP port
        assert_eq!(remote.database, "production");
        assert_eq!(remote.user, "admin");
        assert_eq!(remote.password, "secret123");
        assert!(remote.use_ssl);
        assert_eq!(remote.protocol, Protocol::Http);
    }

    #[test]
    fn test_new() {
        let remote = ClickHouseRemote::new(
            "localhost",
            8123,
            "default",
            "default",
            "",
            false,
            Protocol::Http,
        );

        assert_eq!(remote.host, "localhost");
        assert_eq!(remote.port, 8123);
        assert!(!remote.use_ssl);
        assert_eq!(remote.protocol, Protocol::Http);
    }

    #[test]
    fn test_protocol_default() {
        assert_eq!(Protocol::default(), Protocol::Http);
    }

    #[test]
    fn test_http_base_url_https() {
        let config = create_test_config();
        let remote = ClickHouseRemote::from_config(&config, Protocol::Http);

        assert_eq!(remote.http_base_url(), "https://remote.example.com:8443");
    }

    #[test]
    fn test_http_base_url_http() {
        let mut config = create_test_config();
        config.use_ssl = false;
        config.host_port = 8123;
        let remote = ClickHouseRemote::from_config(&config, Protocol::Http);

        assert_eq!(remote.http_base_url(), "http://remote.example.com:8123");
    }

    #[test]
    fn test_query_function_uses_headers_not_params() {
        let config = create_test_config();
        let remote = ClickHouseRemote::from_config(&config, Protocol::Http);

        let sql = remote.query_function("SELECT 1");

        // Should use headers for auth
        assert!(sql.contains("headers('X-ClickHouse-User'='admin'"));
        assert!(sql.contains("'X-ClickHouse-Key'='secret123'"));

        // Should NOT have credentials in URL params
        assert!(!sql.contains("?user="));
        assert!(!sql.contains("?password="));
        assert!(!sql.contains("&user="));
        assert!(!sql.contains("&password="));
    }

    #[test]
    fn test_query_function_encodes_query() {
        let config = create_test_config();
        let remote = ClickHouseRemote::from_config(&config, Protocol::Http);

        let sql = remote.query_function("SELECT * FROM t WHERE x = 'foo'");

        // Query should be URL-encoded
        assert!(sql.contains("query=SELECT%20%2A%20FROM%20t%20WHERE%20x%20%3D%20%27foo%27"));
    }

    #[test]
    fn test_query_function_with_format() {
        let config = create_test_config();
        let remote = ClickHouseRemote::from_config(&config, Protocol::Http);

        let sql = remote.query_function_with_format("SELECT 1", "JSONEachRow");

        assert!(sql.contains("'JSONEachRow'"));
    }

    #[test]
    fn test_query_function_default_format() {
        let config = create_test_config();
        let remote = ClickHouseRemote::from_config(&config, Protocol::Http);

        let sql = remote.query_function("SELECT 1");

        assert!(sql.contains("'TabSeparatedWithNamesAndTypes'"));
    }

    #[test]
    fn test_select_from_table() {
        let config = create_test_config();
        let remote = ClickHouseRemote::from_config(&config, Protocol::Http);

        let sql = remote.select_from_table("mydb", "mytable", "*", None);

        assert!(sql.contains("SELECT%20%2A%20FROM%20mydb.mytable"));
    }

    #[test]
    fn test_select_from_table_with_where() {
        let config = create_test_config();
        let remote = ClickHouseRemote::from_config(&config, Protocol::Http);

        let sql = remote.select_from_table("mydb", "mytable", "id, name", Some("id > 100"));

        assert!(
            sql.contains("SELECT%20id%2C%20name%20FROM%20mydb.mytable%20WHERE%20id%20%3E%20100")
        );
    }

    #[test]
    fn test_select_from_system_table() {
        let config = create_test_config();
        let remote = ClickHouseRemote::from_config(&config, Protocol::Http);

        let sql = remote.select_from_system_table("tables", "name, database", None);

        assert!(sql.contains("SELECT%20name%2C%20database%20FROM%20system.tables"));
    }

    #[test]
    fn test_special_chars_in_password_in_headers() {
        let mut config = create_test_config();
        config.password = "pass@word!".to_string();
        let remote = ClickHouseRemote::from_config(&config, Protocol::Http);

        let sql = remote.query_function("SELECT 1");

        // Password with special chars should be in headers, not URL
        assert!(sql.contains("'X-ClickHouse-Key'='pass@word!'"));
    }

    #[test]
    fn test_single_quotes_in_credentials_are_escaped() {
        let mut config = create_test_config();
        config.user = "John's".to_string();
        config.password = "pass'word".to_string();
        let remote = ClickHouseRemote::from_config(&config, Protocol::Http);

        let sql = remote.query_function("SELECT 1");

        // Single quotes should be escaped by doubling them
        assert!(sql.contains("'X-ClickHouse-User'='John''s'"));
        assert!(sql.contains("'X-ClickHouse-Key'='pass''word'"));
    }

    #[test]
    fn test_backslashes_in_credentials_are_escaped() {
        let mut config = create_test_config();
        config.user = r"domain\user".to_string();
        config.password = r"pass\word".to_string();
        let remote = ClickHouseRemote::from_config(&config, Protocol::Http);

        let sql = remote.query_function("SELECT 1");

        // Backslashes should be escaped by doubling them
        assert!(sql.contains(r"'X-ClickHouse-User'='domain\\user'"));
        assert!(sql.contains(r"'X-ClickHouse-Key'='pass\\word'"));
    }

    #[test]
    fn test_debug_redacts_password() {
        let config = create_test_config();
        let remote = ClickHouseRemote::from_config(&config, Protocol::Http);

        let debug_output = format!("{:?}", remote);

        // Password should be redacted
        assert!(debug_output.contains("[REDACTED]"));
        assert!(!debug_output.contains("secret123"));
        // Other fields should be visible
        assert!(debug_output.contains("remote.example.com"));
        assert!(debug_output.contains("admin"));
    }
}
