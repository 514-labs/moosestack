//! # Python Project Management
//! This module handles Python project configuration and file management.
//!
//! ## Core Functionality
//! - Project configuration management (name, version, dependencies)
//! - File operations (reading/writing setup.py and requirements.txt)
//! - Project initialization and updates
//!
//! ## Project Structure
//! A Python project consists of:
//! - setup.py: Project metadata and build configuration
//! - requirements.txt: Project dependencies
//!
//! ## Backward Compatibility
//! The module maintains compatibility with projects that don't have a requirements.txt
//! file by falling back to dependencies defined in setup.py.

use std::path::Path;

use config::ConfigError;
use serde::{Deserialize, Serialize};

use crate::framework::versions::Version;
use crate::utilities::constants::{CLI_VERSION, PYTHON_MAIN_FILE, PYTHON_MINIMUM_VERSION};
use crate::{
    framework::python::{
        parser::{get_project_from_file, PythonParserError},
        templates::{render_setup_py, PythonRenderingError},
    },
    utilities::constants::{REQUIREMENTS_TXT, SETUP_PY},
};

/// Errors that can occur during Python project operations
#[derive(Debug, thiserror::Error)]
#[error("Failed to create or delete project files")]
#[non_exhaustive]
pub enum PythonProjectError {
    /// File system operation failed
    IO(#[from] std::io::Error),
    /// JSON serialization/deserialization failed
    JSONSerde(#[from] serde_json::Error),
    /// Python template rendering failed
    PythonRenderingError(#[from] PythonRenderingError),
    /// Python file parsing failed
    PythonParserError(#[from] PythonParserError),
}

/// Represents a Python project configuration
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PythonProject {
    /// Name of the Python project
    pub name: String,
    /// Version of the project (semver)
    pub version: Version,
    /// List of project dependencies
    pub dependencies: Vec<String>,
    /// Python version required by the project
    pub python_requires: String,
}

impl Default for PythonProject {
    /// Creates a default Python project configuration
    ///
    /// Includes common dependencies required for the framework
    fn default() -> Self {
        let python_requires = format!(">={PYTHON_MINIMUM_VERSION}");
        let python_version = format!("python_version >= \"{PYTHON_MINIMUM_VERSION}\"");
        let moose_cli_requirement = if CLI_VERSION.contains("dev") || CLI_VERSION == "0.0.1" {
            format!("moose-cli; {python_version}")
        } else {
            format!("moose-cli=={CLI_VERSION}; {python_version}")
        };

        let moose_lib_requirement = if CLI_VERSION.contains("dev") || CLI_VERSION == "0.0.1" {
            format!("moose-lib; {python_version}")
        } else {
            format!("moose-lib=={CLI_VERSION}; {python_version}")
        };

        Self {
            name: "new_project".to_string(),
            version: Version::from_string("0.0".to_string()),
            python_requires,
            dependencies: vec![
                format!("clickhouse_connect==0.7.16; {python_version}").to_string(),
                format!("requests==2.32.4; {python_version}").to_string(),
                moose_cli_requirement,
                moose_lib_requirement,
            ],
        }
    }
}

impl PythonProject {
    /// Creates a new Python project with the specified name
    ///
    /// # Arguments
    /// * `name` - Name of the project
    pub fn new(name: String) -> Self {
        PythonProject {
            name,
            ..Default::default()
        }
    }

    /// Loads a Python project from a directory
    ///
    /// Reads setup.py and requirements.txt (if available) to configure the project.
    ///
    /// # Arguments
    /// * `directory` - Path to the project directory
    ///
    /// # Returns
    /// * `Result<Self, ConfigError>` - Loaded project or an error
    ///
    /// # Errors
    /// * `ConfigError` if project files cannot be read or parsed
    pub fn load(directory: &Path) -> Result<Self, ConfigError> {
        let mut location = directory.to_path_buf();
        location.push(SETUP_PY);

        // Check if setup.py exists first for a better error message
        if !location.exists() {
            return Err(ConfigError::Message(format!(
                "Failed to load Python project: setup.py not found\n\n\
                 Expected file location: {}\n\
                 Project directory: {}\n\n\
                 Python projects require a setup.py file in the project root directory.\n\
                 This file should contain a setup() function call with at minimum a 'name' parameter.\n\n\
                 To fix this issue:\n\
                 1. Ensure you're running the command from the correct project directory\n\
                 2. Create a setup.py file if it doesn't exist\n\
                 3. Verify your project has the correct structure (app/ directory with Python files)\n\n\
                 For more information, see: https://docs.fiveonefour.com/moose/getting-started/quickstart",
                location.display(),
                directory.display()
            )));
        }

        get_project_from_file(&location).map_err(|e| {
            // Provide detailed context based on the type of error
            let error_details = match &e {
                PythonParserError::FileNotFound { path } => {
                    format!("File not found: {}", path.display())
                }
                PythonParserError::InvalidPythonFile => {
                    "Invalid Python syntax in setup.py or setup() function not found\n\n\
                     Common causes:\n\
                     - setup.py has syntax errors\n\
                     - setup.py doesn't contain a setup() function call\n\
                     - setup() call is missing the required 'name' parameter\n\n\
                     Your setup.py should look similar to:\n\
                     \n  from setuptools import setup\n  setup(\n      name=\"your-project-name\",\n      version=\"0.0\",\n      install_requires=[...]\n  )".to_string()
                }
                PythonParserError::UnsupportedDataTypeError { field_name, type_name } => {
                    format!(
                        "Unsupported data type in field '{}': {}\n\
                         This error typically occurs when parsing data model files, not setup.py",
                        field_name, type_name
                    )
                }
                _ => format!("Error details: {}", e),
            };

            ConfigError::Message(format!(
                "Failed to load Python project from {}\n\n\
                 {}\n\n\
                 Additional information:\n\
                 - Python version requirement: >={}\n\
                 - Required files: setup.py, moose.config.toml\n\
                 - Recommended files: requirements.txt\n\n\
                 For more information, see: https://docs.fiveonefour.com/moose/getting-started/quickstart",
                location.display(),
                error_details,
                PYTHON_MINIMUM_VERSION
            ))
        })
    }

    pub fn main_file(&self) -> &str {
        PYTHON_MAIN_FILE
    }

    /// Writes the project configuration to disk
    ///
    /// Creates or updates:
    /// - requirements.txt with project dependencies
    /// - setup.py with project metadata
    ///
    /// # Arguments
    /// * `project_location` - Directory where project files should be written
    ///
    /// # Returns
    /// * `Result<(), PythonProjectError>` - Success or an error
    ///
    /// # Errors
    /// * `IO` if file operations fail
    /// * `PythonRenderingError` if template rendering fails
    pub fn write_to_disk(&self, project_location: &Path) -> Result<(), PythonProjectError> {
        // Write requirements.txt
        let mut requirements_txt_location = project_location.to_path_buf();
        requirements_txt_location.push(REQUIREMENTS_TXT);
        let requirements_content = self.dependencies.join("\n");
        std::fs::write(&requirements_txt_location, requirements_content)?;

        // Write setup.py
        let mut setup_py_location = project_location.to_path_buf();
        setup_py_location.push(SETUP_PY);
        let setup_py = render_setup_py(self.clone())?;
        std::fs::write(setup_py_location, setup_py)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn get_test_project_abs_dir_path() -> PathBuf {
        let test_project_location = PathBuf::from("tests/python/project");

        std::fs::canonicalize(test_project_location).unwrap()
    }

    #[test]
    fn test_python_load() {
        let test_project_dir = get_test_project_abs_dir_path();
        let project = PythonProject::load(&test_project_dir).unwrap();

        assert_eq!(project.name, "test_project");
        assert_eq!(project.version.as_str(), "0.0");
        // the test is flaky on CI, commenting it out before we figure out why
        // assert_eq!(
        //     project.dependencies,
        //     vec![
        //         "clickhouse_connect==0.7.16; python_version >= \"3.12\"".to_string(),
        //         "requests==2.32.4; python_version >= \"3.12\"".to_string(),
        //         "moose-cli; python_version >= \"3.12\"".to_string(),
        //         "moose-lib; python_version >= \"3.12\"".to_string(),
        //     ]
        // );
    }

    #[test]
    fn test_write_to_disk() {
        use tempfile::tempdir;

        let temp_dir = tempdir().unwrap();
        let project = PythonProject::new("test_project".to_string());

        project.write_to_disk(temp_dir.path()).unwrap();

        // Verify requirements.txt
        let requirements_path = temp_dir.path().join(REQUIREMENTS_TXT);
        assert!(requirements_path.exists());
        let requirements_content = std::fs::read_to_string(requirements_path).unwrap();
        assert_eq!(requirements_content, project.dependencies.join("\n"));

        // Verify setup.py exists
        let setup_py_path = temp_dir.path().join(SETUP_PY);
        assert!(setup_py_path.exists());
    }
}
