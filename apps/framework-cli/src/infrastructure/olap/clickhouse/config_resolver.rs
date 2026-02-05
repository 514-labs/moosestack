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

    let port = config
        .port
        .unwrap_or(if config.use_ssl { 8443 } else { 8123 });
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

fn store_credentials(
    repo: &KeyringSecretRepository,
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

    repo.store(project_name, KEY_REMOTE_CLICKHOUSE_PASSWORD, password)
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Keychain".to_string(),
                format!("Failed to store password: {e:?}"),
            ))
        })?;

    display::show_message_wrapper(
        MessageType::Success,
        Message::new(
            "Keychain".to_string(),
            format!("Stored credentials securely for project '{}'", project_name),
        ),
    );

    Ok(())
}

fn get_stored_credentials(
    repo: &KeyringSecretRepository,
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
