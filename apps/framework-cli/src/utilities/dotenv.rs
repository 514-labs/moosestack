//! # .env File Loading
//!
//! This module handles loading environment variables from .env files in Moose projects.
//!
//! ## File Loading Strategy
//!
//! Environment files are loaded in the following order (later files override earlier ones):
//! 1. `.env` - Base configuration (committed to git, no secrets)
//! 2. `.env.{environment}` - Environment-specific (e.g., `.env.dev`, `.env.prod`)
//! 3. `.env.local` - Local overrides (gitignored, only loaded in development mode)
//!
//! **Important:** Existing system environment variables are NEVER overwritten.
//! System `MOOSE_*` variables always have the highest priority.
//!
//! ## Environment Detection
//!
//! The environment is automatically determined from the Moose CLI command:
//! - `moose dev` → `dev` (loads `.env.dev`)
//! - `moose prod` → `prod` (loads `.env.prod`)
//! - `moose build` → `prod` (loads `.env.prod`)
//! - Other commands → `dev` (default)
//!
//! ## Example
//!
//! ```
//! # In your project directory:
//! # .env
//! MOOSE_HTTP_SERVER_CONFIG__PORT=4000
//!
//! # .env.dev
//! MOOSE_LOGGER__LEVEL=debug
//!
//! # .env.local (gitignored)
//! MOOSE_CLICKHOUSE_CONFIG__PASSWORD=my-secret
//! ```

use log::{debug, info};
use std::path::Path;

/// Represents the runtime environment for the Moose project
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MooseEnvironment {
    /// Development environment (local development)
    Development,
    /// Production environment (deployed/production)
    Production,
}

impl MooseEnvironment {
    /// Returns the environment name as a string
    pub fn as_str(&self) -> &str {
        match self {
            MooseEnvironment::Development => "dev",
            MooseEnvironment::Production => "prod",
        }
    }
}

impl std::fmt::Display for MooseEnvironment {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Loads .env files from the project directory based on the current environment
///
/// Files are loaded in this order (later files override earlier ones):
/// 1. `.env` - Base configuration
/// 2. `.env.{environment}` - Environment-specific configuration
/// 3. `.env.local` - Local overrides (only in development mode)
///
/// System environment variables are never overwritten.
///
/// # Arguments
///
/// * `directory` - The project directory containing .env files
/// * `environment` - The runtime environment (development or production)
///
/// # Example
///
/// ```rust
/// use std::path::Path;
/// use moose_cli::utilities::dotenv::{load_dotenv_files, MooseEnvironment};
///
/// let project_dir = Path::new("/path/to/project");
/// load_dotenv_files(project_dir, MooseEnvironment::Development);
/// ```
pub fn load_dotenv_files(directory: &Path, environment: MooseEnvironment) {
    info!("Loading .env files for environment: {}", environment);
    info!("Loading from directory: {}", directory.display());

    // Build list of files in REVERSE precedence order
    // (dotenvy doesn't overwrite existing vars, so we load lowest priority first)
    let mut env_files = vec![
        ".env".to_string(),                       // Lowest priority
        format!(".env.{}", environment.as_str()), // Medium priority
    ];

    // Only load .env.local in development mode (highest priority)
    if matches!(environment, MooseEnvironment::Development) {
        env_files.push(".env.local".to_string()); // Highest priority
    }

    // REVERSE the order so we load from highest to lowest priority
    // This way, higher priority files set variables first and won't be overwritten
    env_files.reverse();

    for env_file in &env_files {
        let env_path = directory.join(env_file);

        if env_path.exists() {
            debug!("Found {}, loading...", env_file);
            match dotenvy::from_path(&env_path) {
                Ok(_) => {
                    info!("✓ Loaded environment from {}", env_file);
                    // Log the file contents for debugging
                    if let Ok(contents) = std::fs::read_to_string(&env_path) {
                        debug!("  Contents of {}:\n{}", env_file, contents);
                    }
                }
                Err(e) => {
                    debug!("Failed to load {}: {}", env_file, e);
                }
            }
        } else {
            debug!("Skipping {} (file not found)", env_file);
        }
    }

    info!("Environment configuration loaded");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use tempfile::TempDir;

    #[test]
    fn test_environment_display() {
        assert_eq!(MooseEnvironment::Development.to_string(), "dev");
        assert_eq!(MooseEnvironment::Production.to_string(), "prod");
    }

    #[test]
    fn test_load_dotenv_files_missing_files() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().to_path_buf();

        // Should not panic when files don't exist
        load_dotenv_files(&path, MooseEnvironment::Development);
    }

    #[test]
    fn test_system_env_vars_not_overwritten() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().to_path_buf();

        // Set a system environment variable
        let test_var = "MOOSE_TEST_VAR_DO_NOT_OVERWRITE";
        env::set_var(test_var, "system_value");

        // Create a .env file that tries to override it
        let env_file = path.join(".env");
        std::fs::write(&env_file, format!("{}=file_value", test_var)).unwrap();

        // Load the .env file
        load_dotenv_files(&path, MooseEnvironment::Development);

        // System value should be preserved
        assert_eq!(env::var(test_var).unwrap(), "system_value");

        // Cleanup
        env::remove_var(test_var);
    }

    #[test]
    fn test_local_not_loaded_in_production() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().to_path_buf();

        // Create .env.local with a test variable
        let local_file = path.join(".env.local");
        std::fs::write(&local_file, "MOOSE_LOCAL_ONLY_VAR=local_value").unwrap();

        // Load in production mode
        load_dotenv_files(&path, MooseEnvironment::Production);

        // Variable should NOT be set
        assert!(env::var("MOOSE_LOCAL_ONLY_VAR").is_err());

        // Now load in development mode
        load_dotenv_files(&path, MooseEnvironment::Development);

        // Variable SHOULD be set now
        assert_eq!(env::var("MOOSE_LOCAL_ONLY_VAR").unwrap(), "local_value");

        // Cleanup
        env::remove_var("MOOSE_LOCAL_ONLY_VAR");
    }
}
