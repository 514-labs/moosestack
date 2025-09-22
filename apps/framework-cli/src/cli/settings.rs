//! Settings module for the Moose CLI
//!
//! This module handles configuration management for the Moose CLI, including:
//! - Reading/writing configuration from the user's home directory
//! - Environment variable overrides
//! - Default configuration values
//! - Feature flags and telemetry settings
//!
//! # Configuration Sources
//! Configuration is loaded in the following order (later sources override earlier ones):
//! 1. Default values
//! 2. Local configuration file (~/.moose/config.toml)
//! 3. Environment variables (prefixed with MOOSE_)
//!
//! # Environment Variables
//! Environment variables can override any config value using double underscores as separators:
//! - `MOOSE_LOGGER__LEVEL=debug`
//! - `MOOSE_TELEMETRY__ENABLED=false`
//!
//! # Example Configuration
//! ```toml
//! [telemetry]
//! enabled = true
//! machine_id = "uuid-here"
//! export_metrics = false
//!
//! [features]
//! metrics_v2 = false
//! scripts = true
//! ```

use config::{Config, ConfigError, Environment, File};
use home::home_dir;
use log::warn;
use serde::Deserialize;
use std::path::PathBuf;
use toml_edit::{table, value, DocumentMut, Entry, Item};

use super::display::{Message, MessageType};
use super::logger::LoggerSettings;
use crate::utilities::constants::{CLI_CONFIG_FILE, CLI_USER_DIRECTORY};

const ENVIRONMENT_VARIABLE_PREFIX: &str = "MOOSE";

/// Configuration for metric collection labels and endpoints
#[derive(Deserialize, Debug, Default, Clone)]
pub struct MetricLabels {
    /// Custom labels to attach to metrics
    pub labels: Option<String>,
    /// Custom endpoints for metric submission
    pub endpoints: Option<String>,
}

/// Telemetry configuration for usage tracking and metrics
#[derive(Deserialize, Debug, Clone)]
pub struct Telemetry {
    /// Whether telemetry collection is enabled
    pub enabled: bool,
    /// Whether to export metrics to external systems
    #[serde(default)]
    pub export_metrics: bool,
    /// Flag indicating if the user is a Moose developer
    #[serde(default)]
    pub is_moose_developer: bool,
}

impl Default for Telemetry {
    fn default() -> Self {
        Telemetry {
            enabled: true,
            is_moose_developer: false,
            export_metrics: false,
        }
    }
}

/// Feature flag configuration for enabling/disabling functionality
#[derive(Deserialize, Debug, Clone)]
pub struct Features {
    /// Whether to use the v2 metrics system
    #[serde(default = "Features::default_metrics_v2")]
    pub metrics_v2: bool,

    /// Whether the scripts feature is enabled
    #[serde(default)]
    pub scripts: bool,
}

impl Default for Features {
    fn default() -> Self {
        Self {
            metrics_v2: Self::default_metrics_v2(),
            scripts: false,
        }
    }
}

impl Features {
    fn default_metrics_v2() -> bool {
        false
    }
}

/// Main settings structure containing all configuration options
#[derive(Deserialize, Debug, Clone)]
pub struct Settings {
    /// Logging configuration settings
    #[serde(default)]
    pub logger: LoggerSettings,

    /// Telemetry and usage tracking settings
    #[serde(default)]
    pub telemetry: Telemetry,

    /// Metric collection configuration
    #[serde(default)]
    pub metric: MetricLabels,

    /// Feature flag settings
    #[serde(default)]
    pub features: Features,

    /// Development-specific settings
    #[serde(default)]
    pub dev: DevSettings,
}

/// Development-specific configuration options
#[derive(Deserialize, Debug, Clone)]
pub struct DevSettings {
    /// Optional custom path to container CLI executable
    pub container_cli_path: Option<PathBuf>,

    /// Whether to skip shutting down containers on exit
    /// This can be set via the MOOSE_SKIP_CONTAINER_SHUTDOWN environment variable
    #[serde(default)]
    pub skip_container_shutdown: bool,

    /// Whether to bypass execution of infrastructure changes (OLAP and streaming)
    /// When enabled, the system will plan changes but not execute them
    /// This can be set via the MOOSE_DEV__BYPASS_INFRASTRUCTURE_EXECUTION environment variable
    #[serde(default)]
    pub bypass_infrastructure_execution: bool,

    /// Timeout in seconds for Docker container startup and validation
    /// Default is 120 seconds if not specified
    #[serde(default = "default_infrastructure_timeout")]
    pub infrastructure_timeout_seconds: u64,

    /// Suppress the dev setup prompt for externally managed tables
    /// When true, `moose dev` will not ask to configure remote drift checks
    #[serde(default)]
    pub suppress_dev_setup_prompt: bool,
}

impl Default for DevSettings {
    fn default() -> Self {
        Self {
            container_cli_path: None,
            skip_container_shutdown: false,
            bypass_infrastructure_execution: false,
            infrastructure_timeout_seconds: default_infrastructure_timeout(),
            suppress_dev_setup_prompt: false,
        }
    }
}

fn default_infrastructure_timeout() -> u64 {
    120
}

/// Returns the path to the config file in the user's home directory
fn config_path() -> PathBuf {
    let mut path: PathBuf = user_directory();
    path.push(CLI_CONFIG_FILE);
    path
}

/// Returns the path to the Moose user directory
pub fn user_directory() -> PathBuf {
    let mut path: PathBuf = home_dir().unwrap();
    path.push(CLI_USER_DIRECTORY);
    path
}

/// Creates the Moose user directory if it doesn't exist
pub fn setup_user_directory() -> Result<(), std::io::Error> {
    let path = user_directory();
    std::fs::create_dir_all(path.clone())?;
    Ok(())
}

/// Reads and parses the settings from all configuration sources
///
/// Configuration is loaded in the following order:
/// 1. Default values
/// 2. Local configuration file
/// 3. Environment variables
///
/// Returns a Result containing the parsed Settings or a ConfigError
pub fn read_settings() -> Result<Settings, ConfigError> {
    let config_file_location: PathBuf = config_path();

    let s = Config::builder()
        .add_source(File::from(config_file_location).required(false))
        .add_source(
            Environment::with_prefix(ENVIRONMENT_VARIABLE_PREFIX)
                .try_parsing(true)
                .prefix_separator("_")
                .separator("__"),
        )
        .build()?;

    s.try_deserialize()
}

/// Initializes the config file with default values if it doesn't exist
///
/// If the config file already exists, this function will:
/// 1. Parse the existing TOML
/// 2. Ensure required fields are present
/// 3. Add any missing fields with default values
/// 4. Write the updated config back to disk
///
/// Returns a Result indicating success or an IO error
pub fn init_config_file() -> Result<(), std::io::Error> {
    let path = config_path();
    if !path.exists() {
        let contents_toml = r#"
# Helps gather insights, identify issues, & improve the user experience
[telemetry]

# Set this to false to opt-out
enabled=true
is_moose_developer=false
"#;
        std::fs::write(path, contents_toml)?;
    } else {
        let data = std::fs::read_to_string(&path)?;
        match data.parse::<DocumentMut>() {
            Ok(mut toml) => {
                let table = match toml.get_mut("telemetry") {
                    Some(Item::Table(table)) => table,
                    Some(_) => {
                        warn!("telemetry in config is not a table.");
                        return Ok(());
                    }
                    None => {
                        toml["telemetry"] = table();
                        toml["telemetry"].as_table_mut().unwrap()
                    }
                };

                table.entry("enabled").or_insert(value(true));
                table.entry("is_moose_developer").or_insert(value(false));

                std::fs::write(path, toml.to_string())?;
            }
            Err(e) => {
                show_message!(
                    MessageType::Error,
                    Message {
                        action: "Init".to_string(),
                        details: format!("Error parsing config file: {e:?}"),
                    }
                );
            }
        }
    }
    Ok(())
}

impl Settings {
    /// Loads settings from all configuration sources
    ///
    /// Convenience method that calls read_settings() and handles errors appropriately.
    /// This method can be called from anywhere in the codebase to get the current settings.
    ///
    /// # Returns
    ///
    /// A Result containing the parsed Settings or a ConfigError
    pub fn load() -> Result<Self, ConfigError> {
        read_settings()
    }

    /// Checks if container shutdown should be skipped based on settings and environment variables
    ///
    /// This function intelligently interprets the MOOSE_SKIP_CONTAINER_SHUTDOWN environment variable:
    /// - Values like "1", "true", "yes" (case-insensitive) are interpreted as true
    /// - Values like "0", "false", "no" (case-insensitive) are interpreted as false
    /// - If the environment variable is not set, uses the value from config
    pub fn should_skip_container_shutdown(&self) -> bool {
        // Check environment variable first (takes precedence over config)
        match std::env::var("MOOSE_SKIP_CONTAINER_SHUTDOWN") {
            Ok(val) => {
                let val = val.to_lowercase();
                val == "1" || val == "true" || val == "yes"
            }
            // Fall back to the configured value if env var is not set
            Err(_) => self.dev.skip_container_shutdown,
        }
    }

    /// Checks if containers should be shut down based on settings and environment variables
    ///
    /// This is the inverse of should_skip_container_shutdown, providing a clearer API
    /// that avoids double negatives in calling code.
    ///
    /// - Returns true when containers should be shut down
    /// - Returns false when shutdown should be skipped
    pub fn should_shutdown_containers(&self) -> bool {
        !self.should_skip_container_shutdown()
    }

    /// Checks if infrastructure execution should be bypassed
    ///
    /// When enabled, OLAP and streaming changes will be planned but not executed.
    /// This is useful for testing or debugging the planning phase without applying changes.
    ///
    /// The value can be set via:
    /// - Configuration file: `dev.bypass_infrastructure_execution = true`
    /// - Environment variable: `MOOSE_DEV__BYPASS_INFRASTRUCTURE_EXECUTION=true`
    pub fn should_bypass_infrastructure_execution(&self) -> bool {
        self.dev.bypass_infrastructure_execution
    }
}

/// Updates the global CLI config (~/.moose/config.toml) to set the
/// dev.suppress_dev_setup_prompt flag using toml_edit. Creates the
/// [dev] table if missing.
pub fn set_suppress_dev_setup_prompt(value_to_set: bool) -> Result<(), std::io::Error> {
    //
    // // Ensure [dev] table and defaults exist
    // let dev_table_exists_as_table = matches!(toml.get("dev"), Some(Item::Table(_)));
    // if !dev_table_exists_as_table {
    //     toml["dev"] = table();
    // }
    // let dev_table = match toml.get_mut("dev") {
    //     Some(Item::Table(tbl)) => tbl,
    //     Some(_) => {
    //         warn!("dev in config is not a table.");
    //         toml["dev"] = table();
    //         toml["dev"].as_table_mut().unwrap()
    //     }
    //     None => unreachable!(),
    // };
    // dev_table
    //     .entry("suppress_dev_setup_prompt")
    //     .or_insert(value(false));

    let path = config_path();
    let contents = std::fs::read_to_string(&path)?;
    let mut doc: DocumentMut = contents
        .parse()
        .map_err(|_| std::io::Error::other("Failed to parse CLI config"))?;

    let table = match doc.get_mut("dev") {
        Some(Item::Table(table)) => table,
        Some(_) => {
            return Err(std::io::Error::other("Dev in config is not a table."));
        }
        None => {
            doc["dev"] = table();
            doc["dev"].as_table_mut().unwrap()
        }
    };

    match table.entry("suppress_dev_setup_prompt") {
        Entry::Occupied(entry) => *entry.into_mut() = value(value_to_set),
        Entry::Vacant(entry) => {
            entry.insert(value(value_to_set));
        }
    }

    std::fs::write(path, doc.to_string())
}

#[cfg(test)]
mod tests {
    use super::{DevSettings, Settings};

    #[test]
    fn test_default_timeout_configuration() {
        let dev_settings = DevSettings::default();
        assert_eq!(dev_settings.infrastructure_timeout_seconds, 120);
    }

    #[test]
    fn test_timeout_configuration_parsing() {
        let toml_content = r#"
[dev]
infrastructure_timeout_seconds = 300
"#;

        let settings: Settings = toml::from_str(toml_content).expect("Failed to parse TOML");
        assert_eq!(settings.dev.infrastructure_timeout_seconds, 300);
    }

    #[test]
    fn test_timeout_configuration_default_when_missing() {
        let toml_content = r#"
[dev]
skip_container_shutdown = true
"#;

        let settings: Settings = toml::from_str(toml_content).expect("Failed to parse TOML");
        assert_eq!(settings.dev.infrastructure_timeout_seconds, 120);
    }
}
