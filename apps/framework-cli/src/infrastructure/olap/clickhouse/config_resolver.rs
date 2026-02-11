//! Remote ClickHouse configuration resolution
//!
//! Resolves remote ClickHouse connection configuration from moose.config.toml
//! and credentials from OS keychain.

use crate::cli::display::{self, Message, MessageType};
use crate::cli::routines::RoutineFailure;
use crate::cli::{prompt_password, prompt_user};
use crate::project::{ClickHouseProtocol, Project, RemoteClickHouseConfig};
use crate::utilities::constants::{KEY_REMOTE_CLICKHOUSE_PASSWORD, KEY_REMOTE_CLICKHOUSE_USER};
use crate::utilities::keyring::{KeyringSecretRepository, SecretRepository};
use tracing::debug;

use super::remote::{ClickHouseRemote, Protocol};

/// Resolves remote ClickHouse configuration with credentials from keychain.
///
/// Returns `Ok(Some(ClickHouseRemote))` if config exists and credentials are available.
/// Returns `Ok(None)` if no remote config is configured.
/// Prompts user for credentials if not found in keychain.
pub fn resolve_remote_clickhouse(
    project: &Project,
) -> Result<Option<ClickHouseRemote>, RoutineFailure> {
    let Some(config) = &project.dev.remote_clickhouse else {
        debug!("No remote_clickhouse configured");
        return Ok(None);
    };

    let host = config.host.as_ref().ok_or_else(|| {
        RoutineFailure::error(Message::new(
            "Config".to_string(),
            "remote_clickhouse.host is required".to_string(),
        ))
    })?;

    let database = config.database.as_ref().ok_or_else(|| {
        RoutineFailure::error(Message::new(
            "Config".to_string(),
            "remote_clickhouse.database is required".to_string(),
        ))
    })?;

    if config.protocol != ClickHouseProtocol::Http {
        return Err(RoutineFailure::error(Message::new(
            "Config".to_string(),
            "Only HTTP protocol is currently supported".to_string(),
        )));
    }

    let port = config.effective_port();
    let project_name = project.name();
    let repo = KeyringSecretRepository;

    let (user, password) = match get_stored_credentials(&repo, &project_name)? {
        Some((u, p)) => (u, p),
        None => {
            let (u, p) = prompt_for_credentials(config)?;
            store_credentials(&repo, &project_name, &u, &p)?;
            (u, p)
        }
    };

    Ok(Some(ClickHouseRemote::new(
        host.clone(),
        port,
        database.clone(),
        user,
        password,
        config.use_ssl,
        Protocol::Http,
    )))
}

fn prompt_for_credentials(
    config: &RemoteClickHouseConfig,
) -> Result<(String, String), RoutineFailure> {
    let host = config.host.as_deref().unwrap_or("unknown");
    let database = config.database.as_deref().unwrap_or("default");

    display::show_message_wrapper(
        MessageType::Highlight,
        Message::new(
            "Credentials".to_string(),
            format!(
                "Remote ClickHouse credentials required:\n\
                 Host:     {}\n\
                 Database: {}",
                host, database
            ),
        ),
    );

    let user = prompt_user("Enter username", Some("default"), None)?;
    let password = prompt_password("Enter password")?;

    if password.is_empty() {
        return Err(RoutineFailure::error(Message::new(
            "Credentials".to_string(),
            "Password cannot be empty".to_string(),
        )));
    }

    Ok((user, password))
}

fn store_credentials<R: SecretRepository>(
    repo: &R,
    project_name: &str,
    user: &str,
    password: &str,
) -> Result<(), RoutineFailure> {
    repo.store(project_name, KEY_REMOTE_CLICKHOUSE_USER, user)
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Keychain".to_string(),
                format!("Failed to store username: {e:?}"),
            ))
        })?;

    if let Err(e) = repo.store(project_name, KEY_REMOTE_CLICKHOUSE_PASSWORD, password) {
        // Roll back the user entry to avoid partial keychain state
        let _ = repo.delete(project_name, KEY_REMOTE_CLICKHOUSE_USER);
        return Err(RoutineFailure::error(Message::new(
            "Keychain".to_string(),
            format!("Failed to store password: {e:?}"),
        )));
    }

    display::show_message_wrapper(
        MessageType::Success,
        Message::new(
            "Keychain".to_string(),
            format!("Stored credentials securely for project '{}'", project_name),
        ),
    );

    Ok(())
}

/// Stores remote ClickHouse credentials in the OS keychain.
///
/// This is a public wrapper around the internal store_credentials function,
/// used by `moose init --from-remote` to persist credentials.
pub fn store_remote_clickhouse_credentials(
    project_name: &str,
    user: &str,
    password: &str,
) -> Result<(), RoutineFailure> {
    if user.is_empty() || password.is_empty() {
        return Err(RoutineFailure::error(Message::new(
            "Credentials".to_string(),
            "Username and password must not be empty".to_string(),
        )));
    }
    let repo = KeyringSecretRepository;
    store_credentials(&repo, project_name, user, password)
}

fn get_stored_credentials<R: SecretRepository>(
    repo: &R,
    project_name: &str,
) -> Result<Option<(String, String)>, RoutineFailure> {
    let user = repo
        .get(project_name, KEY_REMOTE_CLICKHOUSE_USER)
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Keychain".to_string(),
                format!("Failed to read username: {e:?}"),
            ))
        })?;

    let password = repo
        .get(project_name, KEY_REMOTE_CLICKHOUSE_PASSWORD)
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Keychain".to_string(),
                format!("Failed to read password: {e:?}"),
            ))
        })?;

    match (user, password) {
        (Some(u), Some(p)) => {
            debug!("Retrieved credentials from keychain for '{}'", project_name);
            Ok(Some((u, p)))
        }
        _ => {
            debug!("No stored credentials for '{}'", project_name);
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utilities::keyring::SecretError;
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// Mock secret repository for testing.
    ///
    /// `fail_store_after` controls when `store()` starts failing:
    /// - `None` means all stores succeed
    /// - `Some(n)` means the first `n` stores succeed, then subsequent ones fail
    struct MockSecretRepository {
        secrets: Mutex<HashMap<(String, String), String>>,
        fail_on_get: bool,
        fail_store_after: Option<usize>,
        store_call_count: Mutex<usize>,
    }

    impl MockSecretRepository {
        fn new() -> Self {
            Self {
                secrets: Mutex::new(HashMap::new()),
                fail_on_get: false,
                fail_store_after: None,
                store_call_count: Mutex::new(0),
            }
        }

        fn with_credentials(project: &str, user: &str, password: &str) -> Self {
            let repo = Self::new();
            {
                let mut secrets = repo.secrets.lock().unwrap();
                secrets.insert(
                    (project.to_string(), KEY_REMOTE_CLICKHOUSE_USER.to_string()),
                    user.to_string(),
                );
                secrets.insert(
                    (
                        project.to_string(),
                        KEY_REMOTE_CLICKHOUSE_PASSWORD.to_string(),
                    ),
                    password.to_string(),
                );
            }
            repo
        }

        fn failing() -> Self {
            Self {
                secrets: Mutex::new(HashMap::new()),
                fail_on_get: true,
                fail_store_after: None,
                store_call_count: Mutex::new(0),
            }
        }

        /// Creates a mock where the Nth store call fails (0-indexed).
        /// e.g., `failing_on_nth_store(1)` succeeds on first store, fails on second.
        fn failing_on_nth_store(n: usize) -> Self {
            Self {
                secrets: Mutex::new(HashMap::new()),
                fail_on_get: false,
                fail_store_after: Some(n),
                store_call_count: Mutex::new(0),
            }
        }
    }

    impl SecretRepository for MockSecretRepository {
        fn get(&self, service: &str, key: &str) -> Result<Option<String>, SecretError> {
            if self.fail_on_get {
                return Err(SecretError::StorageError(
                    "Simulated keychain error".to_string(),
                ));
            }
            let secrets = self.secrets.lock().unwrap();
            Ok(secrets
                .get(&(service.to_string(), key.to_string()))
                .cloned())
        }

        fn store(&self, service: &str, key: &str, value: &str) -> Result<(), SecretError> {
            let mut count = self.store_call_count.lock().unwrap();
            let current = *count;
            *count += 1;
            if let Some(n) = self.fail_store_after {
                if current >= n {
                    return Err(SecretError::StorageError(
                        "Simulated store error".to_string(),
                    ));
                }
            }
            let mut secrets = self.secrets.lock().unwrap();
            secrets.insert((service.to_string(), key.to_string()), value.to_string());
            Ok(())
        }

        fn delete(&self, service: &str, key: &str) -> Result<(), SecretError> {
            let mut secrets = self.secrets.lock().unwrap();
            secrets.remove(&(service.to_string(), key.to_string()));
            Ok(())
        }
    }

    #[test]
    fn test_get_stored_credentials_returns_both() {
        let repo = MockSecretRepository::with_credentials("test-project", "admin", "secret123");

        let result = get_stored_credentials(&repo, "test-project").unwrap();

        assert!(result.is_some());
        let (user, password) = result.unwrap();
        assert_eq!(user, "admin");
        assert_eq!(password, "secret123");
    }

    #[test]
    fn test_get_stored_credentials_returns_none_when_missing() {
        let repo = MockSecretRepository::new();

        let result = get_stored_credentials(&repo, "test-project").unwrap();

        assert!(result.is_none());
    }

    #[test]
    fn test_get_stored_credentials_returns_none_when_only_user() {
        let repo = MockSecretRepository::new();
        {
            let mut secrets = repo.secrets.lock().unwrap();
            secrets.insert(
                (
                    "test-project".to_string(),
                    KEY_REMOTE_CLICKHOUSE_USER.to_string(),
                ),
                "admin".to_string(),
            );
        }

        let result = get_stored_credentials(&repo, "test-project").unwrap();

        assert!(
            result.is_none(),
            "Should return None when only user is stored"
        );
    }

    #[test]
    fn test_get_stored_credentials_returns_none_when_only_password() {
        let repo = MockSecretRepository::new();
        {
            let mut secrets = repo.secrets.lock().unwrap();
            secrets.insert(
                (
                    "test-project".to_string(),
                    KEY_REMOTE_CLICKHOUSE_PASSWORD.to_string(),
                ),
                "secret".to_string(),
            );
        }

        let result = get_stored_credentials(&repo, "test-project").unwrap();

        assert!(
            result.is_none(),
            "Should return None when only password is stored"
        );
    }

    #[test]
    fn test_get_stored_credentials_error_on_keychain_failure() {
        let repo = MockSecretRepository::failing();

        let result = get_stored_credentials(&repo, "test-project");

        assert!(result.is_err());
    }

    #[test]
    fn test_effective_port_defaults_ssl() {
        let config = RemoteClickHouseConfig {
            host: Some("example.com".to_string()),
            port: None,
            database: Some("db".to_string()),
            use_ssl: true,
            protocol: ClickHouseProtocol::Http,
        };

        assert_eq!(config.effective_port(), 8443);
    }

    #[test]
    fn test_effective_port_defaults_non_ssl() {
        let config = RemoteClickHouseConfig {
            host: Some("example.com".to_string()),
            port: None,
            database: Some("db".to_string()),
            use_ssl: false,
            protocol: ClickHouseProtocol::Http,
        };

        assert_eq!(config.effective_port(), 8123);
    }

    #[test]
    fn test_effective_port_explicit_overrides_default() {
        let config = RemoteClickHouseConfig {
            host: Some("example.com".to_string()),
            port: Some(9000),
            database: Some("db".to_string()),
            use_ssl: true,
            protocol: ClickHouseProtocol::Http,
        };

        assert_eq!(config.effective_port(), 9000);
    }

    #[test]
    fn test_store_credentials_success() {
        let repo = MockSecretRepository::new();

        let result = store_credentials(&repo, "test-project", "admin", "secret");
        assert!(result.is_ok());

        let secrets = repo.secrets.lock().unwrap();
        assert_eq!(
            secrets.get(&(
                "test-project".to_string(),
                KEY_REMOTE_CLICKHOUSE_USER.to_string()
            )),
            Some(&"admin".to_string())
        );
        assert_eq!(
            secrets.get(&(
                "test-project".to_string(),
                KEY_REMOTE_CLICKHOUSE_PASSWORD.to_string()
            )),
            Some(&"secret".to_string())
        );
    }

    #[test]
    fn test_store_credentials_rolls_back_on_password_failure() {
        // First store (username) succeeds, second store (password) fails
        let repo = MockSecretRepository::failing_on_nth_store(1);

        let result = store_credentials(&repo, "test-project", "admin", "secret");
        assert!(result.is_err());

        // Username should have been rolled back via delete
        let secrets = repo.secrets.lock().unwrap();
        assert!(
            !secrets.contains_key(&(
                "test-project".to_string(),
                KEY_REMOTE_CLICKHOUSE_USER.to_string()
            )),
            "Username should have been rolled back after password store failure"
        );
        assert!(
            !secrets.contains_key(&(
                "test-project".to_string(),
                KEY_REMOTE_CLICKHOUSE_PASSWORD.to_string()
            )),
            "Password should not have been stored"
        );
    }

    #[test]
    fn test_store_remote_clickhouse_credentials_rejects_empty_user() {
        let result = store_remote_clickhouse_credentials("test-project", "", "secret");
        assert!(result.is_err());
    }

    #[test]
    fn test_store_remote_clickhouse_credentials_rejects_empty_password() {
        let result = store_remote_clickhouse_credentials("test-project", "admin", "");
        assert!(result.is_err());
    }
}
