//! Remote ClickHouse configuration resolution
//!
//! Handles resolution of remote ClickHouse connection configuration from multiple sources
//! (environment variables, config files, keychain) with proper priority ordering.
//!
//! This module provides a unified way to resolve remote ClickHouse connections across
//! different CLI commands, ensuring consistent behavior and single source of truth.

use super::config::{parse_clickhouse_connection_string, ClickHouseConfig, RemoteClickHouseConfig};
use crate::cli::display::{self, Message, MessageType};
use crate::cli::prompt_user;
use crate::cli::routines::RoutineFailure;
use crate::project::Project;
use crate::utilities::constants::{ENV_REMOTE_CLICKHOUSE_URL, KEY_REMOTE_CLICKHOUSE_URL};
use crate::utilities::keyring::{KeyringSecretRepository, SecretRepository};
use tracing::debug;

/// Prompts user for remote ClickHouse password with context
///
/// Shows the user which host and username the password is for,
/// providing clear context for security.
pub fn prompt_user_for_remote_ch_password(
    host: &str,
    user: &str,
    database: &str,
) -> Result<String, RoutineFailure> {
    display::show_message_wrapper(
        MessageType::Highlight,
        Message::new(
            "Password".to_string(),
            format!(
                "Remote ClickHouse password required:\n\
                         Host:     {}\n\
                         User:     {}\n\
                         Database: {}",
                host, user, database
            ),
        ),
    );

    let password = prompt_user("Enter password", None, None)?;

    if password.is_empty() {
        return Err(RoutineFailure::error(Message::new(
            "Password".to_string(),
            "Password cannot be empty".to_string(),
        )));
    }

    Ok(password)
}

/// Retrieves and validates stored remote URL from keychain
///
/// Checks if the stored URL matches the provided config (host, user, database).
/// Returns None if no match or URL is malformed.
fn get_stored_remote_url(
    repo: &KeyringSecretRepository,
    project_name: &str,
    config: &RemoteClickHouseConfig,
) -> Result<Option<String>, RoutineFailure> {
    let Some(stored_url) = repo
        .get(project_name, KEY_REMOTE_CLICKHOUSE_URL)
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Keychain".to_string(),
                format!("Failed to read from keychain: {e:?}"),
            ))
        })?
    else {
        return Ok(None);
    };

    let Ok(parsed_url) = reqwest::Url::parse(&stored_url) else {
        debug!("Stored URL is malformed, will prompt for new password");
        return Ok(None);
    };

    if config.matches_url(&parsed_url) {
        debug!("Found matching stored URL in keychain");
        Ok(Some(stored_url))
    } else {
        debug!("Stored URL doesn't match current config (host/user/database changed)");
        Ok(None)
    }
}

/// Prompts for password and stores complete URL in keychain
///
/// Prompts the user for their password, builds a complete connection URL,
/// and stores it in the system keychain for future use.
fn prompt_and_store_remote_credentials(
    repo: &KeyringSecretRepository,
    project_name: &str,
    config: &RemoteClickHouseConfig,
) -> Result<String, RoutineFailure> {
    let password =
        prompt_user_for_remote_ch_password(&config.host, &config.user, &config.database)?;

    let complete_url = config
        .build_url_with_password(&password)
        .map_err(|e| RoutineFailure::error(Message::new("URL".to_string(), e)))?;

    repo.store(project_name, KEY_REMOTE_CLICKHOUSE_URL, &complete_url)
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Keychain".to_string(),
                format!("Failed to store URL in keychain: {e:?}"),
            ))
        })?;

    display::show_message_wrapper(
        MessageType::Success,
        Message::new(
            "Keychain".to_string(),
            format!(
                "Stored remote ClickHouse credentials securely for project '{}'",
                project_name
            ),
        ),
    );

    Ok(password)
}

/// Resolves remote ClickHouse configuration with priority order
///
/// Priority (highest to lowest):
/// 1. Explicit URL parameter (if provided)
/// 2. MOOSE_REMOTE_CLICKHOUSE_URL environment variable (complete URL with password)
/// 3. [dev.remote_clickhouse] in moose.config.toml + keychain password (recommended for teams)
/// 4. Keychain URL storage (legacy - from initial project setup with `moose init --from-remote`)
/// 5. Returns None (caller can prompt if needed)
///
/// For new developers joining a project:
/// - Team should commit [dev.remote_clickhouse] config (without password)
/// - Each dev will be prompted for password once (stored in their local keychain)
///
/// # Arguments
/// * `project` - The project configuration
/// * `explicit_url` - Optional explicit URL (highest priority, used by `moose seed` command)
///
/// # Returns
/// - `Ok(Some(config))` if remote config is available
/// - `Ok(None)` if no remote configuration found
/// - `Err` on failure (keychain read errors, etc.)
pub fn resolve_remote_clickhouse_config(
    project: &Project,
    explicit_url: Option<&str>,
) -> Result<Option<ClickHouseConfig>, RoutineFailure> {
    let project_name = project.name();
    let repo = KeyringSecretRepository;

    // Priority 1: Check explicit parameter
    if let Some(url) = explicit_url {
        debug!("Using explicit remote ClickHouse URL parameter");
        let config = parse_clickhouse_connection_string(url).map_err(|e| {
            RoutineFailure::error(Message::new(
                "RemoteURL".to_string(),
                format!("Failed to parse explicit URL: {}", e),
            ))
        })?;
        return Ok(Some(config));
    }

    // Priority 2: Check environment variable (complete URL with password)
    if let Ok(url) = std::env::var(ENV_REMOTE_CLICKHOUSE_URL) {
        debug!(
            "Using remote ClickHouse URL from {} environment variable",
            ENV_REMOTE_CLICKHOUSE_URL
        );
        let config = parse_clickhouse_connection_string(&url).map_err(|e| {
            RoutineFailure::error(Message::new(
                "RemoteURL".to_string(),
                format!("Failed to parse {} URL: {}", ENV_REMOTE_CLICKHOUSE_URL, e),
            ))
        })?;
        return Ok(Some(config));
    }

    // Priority 3: Check dev.remote_clickhouse in config + keychain URL
    if let Some(remote_config) = &project.dev.remote_clickhouse {
        debug!(
            "Using remote ClickHouse config from moose.config.toml for project '{}'",
            project_name
        );

        // Try to get matching stored URL from keychain
        if let Some(stored_url) = get_stored_remote_url(&repo, &project_name, remote_config)? {
            let config = parse_clickhouse_connection_string(&stored_url).map_err(|e| {
                RoutineFailure::error(Message::new(
                    "RemoteURL".to_string(),
                    format!("Failed to parse stored URL: {}", e),
                ))
            })?;
            return Ok(Some(config));
        }

        // No matching URL, prompt and store
        let password = prompt_and_store_remote_credentials(&repo, &project_name, remote_config)?;
        return Ok(Some(remote_config.to_clickhouse_config(password)));
    }

    // Priority 4: Check keychain for legacy URL storage (backward compatibility)
    let keychain_url = repo
        .get(&project_name, KEY_REMOTE_CLICKHOUSE_URL)
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Keychain".to_string(),
                format!("Failed to read URL from keychain: {e:?}"),
            ))
        })?;

    if let Some(url) = keychain_url {
        debug!("Using remote ClickHouse URL from keychain (legacy storage)");
        let config = parse_clickhouse_connection_string(&url).map_err(|e| {
            RoutineFailure::error(Message::new(
                "RemoteURL".to_string(),
                format!("Failed to parse keychain URL: {}", e),
            ))
        })?;
        return Ok(Some(config));
    }

    // Priority 5: No configuration found
    Ok(None)
}
