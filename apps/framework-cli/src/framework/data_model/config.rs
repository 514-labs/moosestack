use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::framework::core::infrastructure::table::Metadata;
use crate::framework::python::datamodel_config::execute_python_model_file_for_config;
use crate::framework::typescript::export_collectors::get_data_model_configs;
use crate::project::Project;
use crate::utilities::_true;
use serde::Deserialize;
use serde::Serialize;
use std::ffi::OsStr;
use tracing::info;

pub type ConfigIdentifier = String;

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Hash, Default)]
pub struct IngestionConfig {}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Hash)]
pub struct StorageConfig {
    #[serde(default = "_true")]
    pub enabled: bool,
    #[serde(default)]
    pub order_by_fields: Vec<String>,
    #[serde(default)]
    pub deduplicate: bool,
    #[serde(default)]
    pub name: Option<String>,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            order_by_fields: vec![],
            deduplicate: false,
            name: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Hash)]
pub struct DataModelConfig {
    #[serde(default)]
    pub ingestion: IngestionConfig,
    #[serde(default)]
    pub storage: StorageConfig,
    #[serde(default = "default_parallelism")]
    pub parallelism: usize,
    #[serde(default)]
    pub metadata: Option<Metadata>,
}

impl Default for DataModelConfig {
    fn default() -> Self {
        Self {
            ingestion: IngestionConfig::default(),
            storage: StorageConfig::default(),
            parallelism: default_parallelism(),
            metadata: None,
        }
    }
}

fn default_parallelism() -> usize {
    1
}

#[derive(Debug, thiserror::Error)]
#[error("Failed to get the Data Model configuration")]
#[non_exhaustive]
pub enum ModelConfigurationError {
    TypescriptRunner(#[from] crate::framework::typescript::export_collectors::ExportCollectorError),
    #[error("Failed to get the Data Model configuration with Python\n{0}")]
    PythonRunner(String),
}

pub async fn get(
    path: &Path,
    project: &Project,
    project_path: &Path,
    enums: HashSet<&str>,
) -> Result<HashMap<ConfigIdentifier, DataModelConfig>, ModelConfigurationError> {
    if path.extension() == Some(OsStr::new("ts")) {
        let config = get_data_model_configs(path, project, project_path, enums).await?;
        info!("Data Model configuration for {:?}: {:?}", path, config);
        Ok(config)
    } else if path.extension() == Some(OsStr::new("py"))
        && path.file_name() != Some(OsStr::new("__init__.py"))
    {
        return execute_python_model_file_for_config(project_path, path).await;
    } else {
        // We will use defaults values for the configuration for each data model.
        Ok(HashMap::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_partial_config() {
        let _config: DataModelConfig =
            serde_json::from_str("{\"storage\":{\"enabled\": true}}").unwrap();
        println!("{_config:?}")
    }
}
