//! Remote ClickHouse connection utilities
//!
//! This module provides utilities for working with remote ClickHouse instances,
//! particularly for operations using the `remoteSecure()` table function.

use super::config::ClickHouseConfig;

/// Represents remote ClickHouse connection details
///
/// This struct encapsulates all the information needed to connect to a remote
/// ClickHouse instance using the remoteSecure() table function.
#[derive(Debug, Clone)]
pub struct RemoteConnection {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
}

impl RemoteConnection {
    /// Creates a RemoteConnection from a ClickHouseConfig
    pub fn from_config(config: &ClickHouseConfig) -> Self {
        Self {
            host: config.host.clone(),
            port: config.native_port as u16,
            database: config.db_name.clone(),
            user: config.user.clone(),
            password: config.password.clone(),
        }
    }

    /// Returns the host:port string for remoteSecure() calls
    pub fn host_and_port(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    /// Builds a remoteSecure() table function call for the specified table
    ///
    /// # Arguments
    /// * `database` - The database name on the remote server
    /// * `table` - The table name on the remote server
    ///
    /// # Returns
    /// A string like: `remoteSecure('host:port', 'database', 'table', 'user', 'password')`
    pub fn build_remote_secure(&self, database: &str, table: &str) -> String {
        format!(
            "remoteSecure('{}', '{}', '{}', '{}', '{}')",
            self.host_and_port(),
            database,
            table,
            self.user,
            self.password
        )
    }

    /// Builds a remoteSecure() call for querying system tables
    ///
    /// # Arguments
    /// * `system_table` - The system table name (e.g., "tables", "columns")
    ///
    /// # Returns
    /// A string like: `remoteSecure('host:port', 'system', 'tables', 'user', 'password')`
    pub fn build_remote_secure_system(&self, system_table: &str) -> String {
        self.build_remote_secure("system", system_table)
    }
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
            host_port: 8123,
            host_data_path: None,
            additional_databases: vec![],
            clusters: None,
        }
    }

    #[test]
    fn test_from_config() {
        let config = create_test_config();
        let remote = RemoteConnection::from_config(&config);

        assert_eq!(remote.host, "remote.example.com");
        assert_eq!(remote.port, 9440);
        assert_eq!(remote.database, "production");
        assert_eq!(remote.user, "admin");
        assert_eq!(remote.password, "secret123");
    }

    #[test]
    fn test_host_and_port() {
        let config = create_test_config();
        let remote = RemoteConnection::from_config(&config);

        assert_eq!(remote.host_and_port(), "remote.example.com:9440");
    }

    #[test]
    fn test_build_remote_secure() {
        let config = create_test_config();
        let remote = RemoteConnection::from_config(&config);

        let sql = remote.build_remote_secure("mydb", "mytable");
        assert_eq!(
            sql,
            "remoteSecure('remote.example.com:9440', 'mydb', 'mytable', 'admin', 'secret123')"
        );
    }

    #[test]
    fn test_build_remote_secure_system() {
        let config = create_test_config();
        let remote = RemoteConnection::from_config(&config);

        let sql = remote.build_remote_secure_system("tables");
        assert_eq!(
            sql,
            "remoteSecure('remote.example.com:9440', 'system', 'tables', 'admin', 'secret123')"
        );
    }
}
