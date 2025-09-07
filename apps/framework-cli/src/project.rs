//! # Project
//!
//! This module contains the `Project` struct, which represents a users project.
//! These projects are data-intensive applications or services.
//! A project is initialized using the `moose init` command and is stored
//!  in the `$PROJECT_PATH/.moose` directory.
//!
//! ## Infrastructure Loading (`load_infra` flag)
//! - The `load_infra` flag in `moose.config.toml` determines if this Moose instance should load infrastructure (Docker) containers during `moose dev`.
//! - If `load_infra` is **missing** from the config, the default is **true** (infra is loaded, for backward compatibility).
//! - If `load_infra` is **present and set to true**, infra containers are loaded.
//! - If `load_infra` is **present and set to false**, infra containers are NOT loaded.
//! - If the config file is missing or malformed, infra is loaded by default.
//!
//! Example:
//! ```toml
//! load_infra = true  # or false
//! ```
//!
//! The `Project` struct contains the following fields:
//! - `name` - The name of the project
//! - `language` - The language of the project
//! - `project_file_location` - The location of the project file on disk
//! ```

use std::collections::HashMap;
pub mod python_project;
pub mod typescript_project;

use std::fmt::Debug;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Once;

use crate::cli::local_webserver::LocalWebserverConfig;
use crate::framework::languages::SupportedLanguages;
use crate::framework::streaming::loader::parse_streaming_function;
use crate::framework::versions::Version;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::orchestration::temporal::TemporalConfig;

use crate::infrastructure::redis::redis_client::RedisConfig;
use crate::infrastructure::stream::kafka::models::KafkaConfig;

use crate::cli::display::Message;
use crate::cli::routines::RoutineFailure;
use crate::project::typescript_project::TypescriptProject;
use crate::utilities::constants::BLOCKS_DIR;
use crate::utilities::constants::CLI_INTERNAL_VERSIONS_DIR;
use crate::utilities::constants::ENVIRONMENT_VARIABLE_PREFIX;
use crate::utilities::constants::PROJECT_CONFIG_FILE;
use crate::utilities::constants::{APP_DIR, CLI_PROJECT_INTERNAL_DIR, SCHEMAS_DIR};
use crate::utilities::constants::{
    CONSUMPTION_DIR, FUNCTIONS_DIR, OLD_PROJECT_CONFIG_FILE, TS_FLOW_FILE,
};
use crate::utilities::git::GitConfig;
use crate::utilities::PathExt;
use crate::utilities::_true;
use config::{Config, ConfigError, Environment, File};
use log::{debug, error};
use python_project::PythonProject;
use serde::Deserialize;
use serde::Serialize;

/// Represents errors that can occur during project file operations
#[derive(Debug, thiserror::Error)]
#[error("Failed to create or delete project files")]
#[non_exhaustive]
pub enum ProjectFileError {
    /// Error when creating the internal directory structure
    InternalDirCreationFailed(std::io::Error),
    /// Generic error with custom message
    #[error("Failed to create project files: {message}")]
    Other { message: String },
    /// Standard IO error
    IO(#[from] std::io::Error),
    /// TypeScript project specific error
    TSProjectFileError(#[from] typescript_project::TSProjectFileError),
    /// Python project specific error
    PythonProjectError(#[from] python_project::PythonProjectError),
    /// JSON serialization error
    JSONSerde(#[from] serde_json::Error),
    /// TOML serialization error
    TOMLSerde(#[from] toml::ser::Error),
}

/// Configuration for JWT authentication
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JwtConfig {
    /// Whether to enforce JWT on all consumption APIs
    #[serde(default)]
    pub enforce_on_all_consumptions_apis: bool,
    /// Whether to enforce JWT on all ingestion APIs
    #[serde(default)]
    pub enforce_on_all_ingest_apis: bool,
    /// Secret key for JWT signing
    pub secret: String,
    /// JWT issuer
    pub issuer: String,
    /// JWT audience
    pub audience: String,
}

/// Language-specific project configuration
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum LanguageProjectConfig {
    /// TypeScript project configuration
    Typescript(TypescriptProject),
    /// Python project configuration
    Python(PythonProject),
}

impl Default for LanguageProjectConfig {
    fn default() -> Self {
        LanguageProjectConfig::Typescript(TypescriptProject::default())
    }
}

/// Authentication configuration for the project
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AuthenticationConfig {
    /// Optional admin API key for authentication
    #[serde(default)]
    pub admin_api_key: Option<String>,
}

/// TypeScript-specific configuration
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TypescriptConfig {
    /// Package manager to use (npm, pnpm, yarn)
    #[serde(default = "default_package_manager")]
    pub package_manager: String,
}

impl Default for TypescriptConfig {
    fn default() -> Self {
        Self {
            package_manager: default_package_manager(),
        }
    }
}

fn default_package_manager() -> String {
    "npm".to_string()
}

/// Feature flags for the project
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectFeatures {
    /// Whether streaming engine is enabled
    #[serde(default = "_true")]
    pub streaming_engine: bool,

    /// Whether workflows are enabled
    #[serde(default)]
    pub workflows: bool,

    /// ongoing redesign of data models
    #[serde(default)]
    pub data_model_v2: bool,

    /// Whether OLAP (ClickHouse) is enabled
    #[serde(default = "_true")]
    pub olap: bool,

    /// Execute planned DDL file unless MOOSE_AUTO_APPROVE_MIGRATIONS=true
    #[serde(default)]
    pub ddl_plan: bool,
}

impl Default for ProjectFeatures {
    fn default() -> Self {
        ProjectFeatures {
            streaming_engine: true,
            workflows: false,
            data_model_v2: false,
            olap: true,
            ddl_plan: false,
        }
    }
}

/// Represents a user's Moose project
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    /// Programming language used in the project
    pub language: SupportedLanguages,
    /// Redpanda streaming configuration
    #[serde(default, alias = "kafka_config")]
    pub redpanda_config: KafkaConfig,
    /// ClickHouse database configuration
    pub clickhouse_config: ClickHouseConfig,
    /// HTTP server configuration for local development
    pub http_server_config: LocalWebserverConfig,
    /// Redis configuration
    #[serde(default)]
    pub redis_config: RedisConfig,
    /// Git configuration
    #[serde(default)]
    pub git_config: GitConfig,
    /// Temporal workflow configuration
    #[serde(default)]
    pub temporal_config: TemporalConfig,
    /// Language-specific project configuration (not serialized)
    #[serde(skip)]
    pub language_project_config: LanguageProjectConfig,
    /// Project root directory location (not serialized)
    #[serde(skip)]
    pub project_location: PathBuf,
    /// Whether the project is running in production mode
    #[serde(skip, default = "Project::default_production")]
    pub is_production: bool,
    /// Map of supported old versions and their locations
    #[serde(default = "HashMap::new")]
    pub supported_old_versions: HashMap<Version, String>,
    /// JWT configuration
    #[serde(default)]
    pub jwt: Option<JwtConfig>,
    /// Authentication configuration
    #[serde(default)]
    pub authentication: AuthenticationConfig,

    /// Feature flags
    #[serde(default)]
    pub features: ProjectFeatures,
    /// Whether this instance should load infra containers (see module docs)
    #[serde(default)]
    pub load_infra: Option<bool>,
    /// TypeScript-specific configuration
    #[serde(default)]
    pub typescript_config: TypescriptConfig,
}

static STREAMING_FUNCTION_RENAME_WARNING: Once = Once::new();

static DATA_MODEL_V2_ENABLED: AtomicBool = AtomicBool::new(false);

pub fn is_data_model_v2_enabled() -> bool {
    DATA_MODEL_V2_ENABLED.load(Ordering::SeqCst)
}

impl Project {
    /// Returns the default production state (false)
    pub fn default_production() -> bool {
        false
    }

    /// Returns the project name based on the language configuration
    pub fn name(&self) -> String {
        match &self.language_project_config {
            LanguageProjectConfig::Typescript(p) => p.name.clone(),
            LanguageProjectConfig::Python(p) => p.name.clone(),
        }
    }

    pub fn main_file(&self) -> PathBuf {
        let mut location = self.app_dir();
        location.push(match &self.language_project_config {
            LanguageProjectConfig::Typescript(p) => p.main_file(),
            LanguageProjectConfig::Python(p) => p.main_file(),
        });
        location
    }

    /// Creates a new project with the specified parameters
    ///
    /// # Arguments
    /// * `dir_location` - The directory where the project will be created
    /// * `name` - The name of the project
    /// * `language` - The programming language to use
    pub fn new(dir_location: &Path, name: String, language: SupportedLanguages) -> Project {
        let mut location = dir_location.to_path_buf();

        location = location
            .canonicalize()
            .expect("The directory provided does not exist");

        debug!("Package.json file location: {:?}", location);

        let language_project_config = match language {
            SupportedLanguages::Typescript => {
                LanguageProjectConfig::Typescript(TypescriptProject::new(name))
            }
            SupportedLanguages::Python => LanguageProjectConfig::Python(PythonProject::new(name)),
        };

        Project {
            language,
            is_production: false,
            project_location: location.clone(),
            redpanda_config: KafkaConfig::default(),
            clickhouse_config: ClickHouseConfig::default(),
            redis_config: RedisConfig::default(),
            http_server_config: LocalWebserverConfig::default(),
            temporal_config: TemporalConfig::default(),
            language_project_config,
            supported_old_versions: HashMap::new(),
            git_config: GitConfig::default(),
            jwt: None,
            features: Default::default(),
            authentication: AuthenticationConfig::default(),
            load_infra: None,
            typescript_config: TypescriptConfig::default(),
        }
    }

    /// Sets whether the project is running in production mode
    pub fn set_is_production_env(&mut self, is_production: bool) {
        self.is_production = is_production;
    }

    /// Loads a project from the specified directory
    pub fn load(directory: &PathBuf) -> Result<Project, ConfigError> {
        let mut project_file = directory.clone();

        // Prioritize the new project file name
        if directory.clone().join(PROJECT_CONFIG_FILE).exists() {
            project_file.push(PROJECT_CONFIG_FILE);
        } else {
            project_file.push(OLD_PROJECT_CONFIG_FILE);
        }

        let mut project_config: Project = Config::builder()
            .add_source(File::from(project_file).required(true))
            .add_source(
                Environment::with_prefix(ENVIRONMENT_VARIABLE_PREFIX)
                    .prefix_separator("_")
                    .separator("__"),
            )
            .build()?
            .try_deserialize()?;

        project_config.project_location.clone_from(directory);

        match project_config.language {
            SupportedLanguages::Typescript => {
                let ts_config = TypescriptProject::load(directory)?;
                project_config.language_project_config =
                    LanguageProjectConfig::Typescript(ts_config);
            }
            SupportedLanguages::Python => {
                let py_config = PythonProject::load(directory)?;
                project_config.language_project_config = LanguageProjectConfig::Python(py_config);
            }
        }

        DATA_MODEL_V2_ENABLED.store(project_config.features.data_model_v2, Ordering::SeqCst);

        // Show Redis configuration warnings for mixed configurations
        project_config.redis_config.show_config_warnings();

        Ok(project_config)
    }

    /// Loads a project from the current directory
    pub fn load_from_current_dir() -> Result<Project, ConfigError> {
        let current_dir = std::env::current_dir().expect("Failed to get the current directory");
        Project::load(&current_dir)
    }

    /// Writes the project configuration to disk
    pub fn write_to_disk(&self) -> Result<(), ProjectFileError> {
        // Write to disk what is common to all project types, the moose.config.toml
        let project_file = self.project_location.join(PROJECT_CONFIG_FILE);

        let toml_project = toml::to_string(&self)?;

        std::fs::write(project_file, toml_project)?;

        // Write language specific files to disk
        match &self.language_project_config {
            LanguageProjectConfig::Typescript(p) => Ok(p.write_to_disk(&self.project_location)?),
            LanguageProjectConfig::Python(p) => Ok(p.write_to_disk(&self.project_location)?),
        }
    }

    /// Returns the path to the app directory
    pub fn app_dir(&self) -> PathBuf {
        let mut app_dir = self.project_location.clone();
        app_dir.push(APP_DIR);

        debug!("App dir: {:?}", app_dir);

        if !app_dir.exists() {
            std::fs::create_dir_all(&app_dir).expect("Failed to create app directory");
        }
        app_dir
    }

    /// Returns the path to the data models directory
    pub fn data_models_dir(&self) -> PathBuf {
        let mut schemas_dir = self.app_dir();
        schemas_dir.push(SCHEMAS_DIR);

        if !schemas_dir.exists() {
            std::fs::create_dir_all(&schemas_dir).expect("Failed to create schemas directory");
        }

        debug!("Schemas dir: {:?}", schemas_dir);
        schemas_dir
    }

    /// Returns the path to the versioned data model directory
    pub fn versioned_data_model_dir(&self, version: &str) -> Result<PathBuf, ProjectFileError> {
        if version == self.cur_version().as_str() {
            Ok(self.data_models_dir())
        } else {
            Ok(self.old_version_location(version)?)
        }
    }

    /// Returns the path to the streaming functions directory
    pub fn streaming_func_dir(&self) -> PathBuf {
        let functions_dir = self.app_dir().join(FUNCTIONS_DIR);

        if !functions_dir.exists() {
            let flows_dir = self.app_dir().join("flows");
            if flows_dir.exists() {
                STREAMING_FUNCTION_RENAME_WARNING.call_once(|| {
                    println!("❗️Action Required: 'Flows' are now called 'Functions.' Please rename the directory.");
                });
                return flows_dir;
            }

            std::fs::create_dir_all(&functions_dir).expect("Failed to create functions directory");
        }

        debug!("Functions dir: {:?}", functions_dir);
        functions_dir
    }

    /// Returns the path to the blocks directory
    pub fn blocks_dir(&self) -> PathBuf {
        let blocks_dir = self.app_dir().join(BLOCKS_DIR);

        if !blocks_dir.exists() {
            std::fs::create_dir_all(&blocks_dir).expect("Failed to create blocks directory");
        }

        debug!("Blocks dir: {:?}", blocks_dir);
        blocks_dir
    }

    /// Returns the path to the consumption directory
    pub fn consumption_dir(&self) -> PathBuf {
        let apis_dir = self.app_dir().join(CONSUMPTION_DIR);

        if !apis_dir.exists() {
            std::fs::create_dir_all(&apis_dir).expect("Failed to create consumption directory");
        }

        debug!("Consumptions dir: {:?}", apis_dir);
        apis_dir
    }

    /// Returns the path to the internal directory
    pub fn internal_dir(&self) -> Result<PathBuf, ProjectFileError> {
        let mut internal_dir = self.project_location.clone();
        internal_dir.push(CLI_PROJECT_INTERNAL_DIR);

        if !internal_dir.is_dir() {
            if internal_dir.exists() {
                debug!("Internal dir exists as a file: {:?}", internal_dir);
                return Err(ProjectFileError::Other {
                    message: format!(
                        "The {CLI_PROJECT_INTERNAL_DIR} file exists but is not a directory"
                    ),
                });
            } else {
                debug!("Creating internal dir: {:?}", internal_dir);
                std::fs::create_dir_all(&internal_dir).map_err(|e| ProjectFileError::Other {
                    message: format!(
                        "Failed to create internal directory {}: {}",
                        internal_dir.display(),
                        e
                    ),
                })?;
            }
        } else {
            debug!("Internal directory Exists: {:?}", internal_dir);
        }

        Ok(internal_dir)
    }

    pub fn internal_dir_with_routine_failure_err(&self) -> Result<PathBuf, RoutineFailure> {
        self.internal_dir().map_err(|err| {
            error!("Failed to get internal directory for project: {}", err);
            RoutineFailure::new(
                Message::new(
                    "Failed".to_string(),
                    "to get internal directory for project".to_string(),
                ),
                err,
            )
        })
    }

    /// Deletes the internal directory
    pub fn delete_internal_dir(&self) -> Result<(), ProjectFileError> {
        let internal_dir = self.internal_dir()?;
        Ok(std::fs::remove_dir_all(internal_dir)?)
    }

    /// Returns the location of an old version
    pub fn old_version_location(&self, version: &str) -> Result<PathBuf, ProjectFileError> {
        let mut old_base_path = self.internal_dir()?;
        old_base_path.push(CLI_INTERNAL_VERSIONS_DIR);
        old_base_path.push(version);

        Ok(old_base_path)
    }

    /// Returns the current version
    pub fn cur_version(&self) -> &Version {
        match &self.language_project_config {
            LanguageProjectConfig::Typescript(package_json) => &package_json.version,
            LanguageProjectConfig::Python(proj) => &proj.version,
        }
    }

    /// Returns all versions including current
    pub fn versions(&self) -> Vec<String> {
        vec![self.cur_version().to_string()]
    }

    /// Returns a map of functions and their associated models
    pub fn get_functions(&self) -> HashMap<String, Vec<String>> {
        let mut functions_map = HashMap::new();

        if let Ok(entries) = std::fs::read_dir(self.streaming_func_dir()) {
            // flatten here means ignoring the Err case
            for entry in entries.flatten() {
                if entry.file_type().is_ok_and(|t| t.is_file())
                    && entry.path().ext_is_supported_lang()
                {
                    parse_streaming_function(
                        entry
                            .path()
                            .with_extension("")
                            .file_name()
                            .unwrap()
                            .to_string_lossy()
                            .as_ref(),
                    )
                    .iter()
                    .for_each(|(input, output)| {
                        if let Some(output_str) = output {
                            functions_map
                                .entry(input.to_string())
                                .or_insert_with(Vec::new)
                                .push(output_str.to_string());
                        }
                    });
                } else if let Some((input_model, output_models)) =
                    self.process_function_input(&entry)
                {
                    functions_map.insert(input_model, output_models);
                }
            }
        }

        functions_map
    }

    /// Processes function input for a directory entry
    fn process_function_input(&self, entry: &std::fs::DirEntry) -> Option<(String, Vec<String>)> {
        let input_model = entry.file_name().to_string_lossy().into_owned();
        let mut output_models = Vec::new();

        if let Ok(output_entries) = std::fs::read_dir(entry.path()) {
            for output_entry in output_entries.flatten() {
                if let Some(output_model) = self.process_function_output(&output_entry) {
                    output_models.push(output_model);
                }
            }
        }

        if !output_models.is_empty() {
            Some((input_model, output_models))
        } else {
            None
        }
    }

    /// Processes function output for a directory entry
    fn process_function_output(&self, entry: &std::fs::DirEntry) -> Option<String> {
        if let Ok(file_type) = entry.file_type() {
            if file_type.is_dir() {
                let function_path = entry.path().join(TS_FLOW_FILE);
                if function_path.exists() {
                    return Some(entry.file_name().to_string_lossy().into_owned());
                }
            }
        }
        None
    }

    /// Checks if the project is running in a docker container
    pub fn is_docker_image(&self) -> bool {
        std::env::var("DOCKER_IMAGE").unwrap_or("false".to_string()) == "true"
    }

    /// Returns true if this instance should load infra containers, according to the load_infra flag.
    ///
    /// - If load_infra is Some(true) or None (missing), returns true (default: load infra).
    /// - If load_infra is Some(false), returns false (do not load infra).
    pub fn should_load_infra(&self) -> bool {
        self.load_infra.unwrap_or(true)
    }
}

// Tests
#[cfg(test)]
pub mod tests {
    use super::*;

    fn create_python_project() -> Project {
        Project::new(
            Path::new("tests/python/project"),
            "test_project".to_string(),
            SupportedLanguages::Python,
        )
    }

    #[test]
    fn test_new_python_project() {
        let project = create_python_project();

        assert_eq!(project.language, SupportedLanguages::Python);
        assert_eq!(project.name(), "test_project");
    }

    #[test]
    fn test_write_to_disk() {
        // Use a temporary directory to avoid interfering with other tests
        use tempfile::tempdir;
        let temp_dir = tempdir().expect("Failed to create temp dir");
        let project = Project::new(
            temp_dir.path(),
            "test_project".to_string(),
            SupportedLanguages::Python,
        );
        project.write_to_disk().unwrap();

        assert!(project.project_location.join(PROJECT_CONFIG_FILE).exists());
        // Temp directory is automatically cleaned up when it goes out of scope
    }

    #[test]
    fn test_new_python_project_from_file() {
        // Use a temporary directory to avoid interfering with other tests
        use tempfile::tempdir;
        let temp_dir = tempdir().expect("Failed to create temp dir");
        let project = Project::new(
            temp_dir.path(),
            "test_project".to_string(),
            SupportedLanguages::Python,
        );
        project.write_to_disk().unwrap();

        assert_eq!(project.language, SupportedLanguages::Python);
        assert_eq!(project.name(), "test_project");
    }
}
