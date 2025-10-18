use std::{collections::HashMap, path::Path};

use crate::utilities::constants::PACKAGE_JSON;
use crate::{framework::versions::Version, utilities::constants::TYPESCRIPT_MAIN_FILE};
use config::{Config, ConfigError, File};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
#[error("Failed to create or delete project files")]
#[non_exhaustive]
pub enum TSProjectFileError {
    IO(#[from] std::io::Error),
    JSONSerde(#[from] serde_json::Error),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TypescriptProject {
    pub name: String,
    pub version: Version,
    pub scripts: HashMap<String, String>,
    pub dependencies: HashMap<String, String>,
    pub dev_dependencies: HashMap<String, String>,
    /// Preserve any additional fields from package.json (e.g. pnpm, npm, yarn config)
    #[serde(flatten)]
    pub additional_fields: HashMap<String, serde_json::Value>,
}

impl Default for TypescriptProject {
    fn default() -> Self {
        Self {
            name: "new_project".to_string(),
            version: Version::from_string("0.0".to_string()),
            // For local development of the CLI,
            // change `moose-cli` to `<REPO_PATH>/target/debug/moose-cli`
            scripts: HashMap::from([
                ("dev".to_string(), "moose-cli dev".to_string()),
                ("moose".to_string(), "moose-cli".to_string()),
                ("build".to_string(), "moose-cli build --docker".to_string()),
            ]),
            dependencies: HashMap::from([
                ("typescript".to_string(), "^5.7.0".to_string()),
                ("@514labs/moose-lib".to_string(), "latest".to_string()),
                ("ts-patch".to_string(), "^3.3.0".to_string()),
                ("typia".to_string(), "^7.6.0".to_string()),
            ]),
            dev_dependencies: HashMap::from([
                ("@514labs/moose-cli".to_string(), "latest".to_string()),
                ("@types/node".to_string(), "^20.12.12".to_string()),
            ]),
            additional_fields: HashMap::new(),
        }
    }
}

impl TypescriptProject {
    pub fn new(name: String) -> Self {
        TypescriptProject {
            name,
            ..Default::default()
        }
    }

    pub fn load(directory: &Path) -> Result<Self, ConfigError> {
        let mut package_json_location = directory.to_path_buf();
        package_json_location.push(PACKAGE_JSON);

        Config::builder()
            .add_source(File::from(package_json_location).required(true))
            .build()?
            .try_deserialize()
    }

    pub fn write_to_disk(&self, project_location: &Path) -> Result<(), TSProjectFileError> {
        let mut package_json_location = project_location.to_path_buf();
        package_json_location.push(PACKAGE_JSON);

        let json = serde_json::to_string_pretty(&self)?;
        std::fs::write(&package_json_location, json)?;

        Ok(())
    }

    pub fn main_file(&self) -> &str {
        TYPESCRIPT_MAIN_FILE
    }
}
