use tracing::info;
use serde::Deserialize;
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{absolute, Path},
};

use crate::framework::core::partial_infrastructure_map::{
    DmV2LoadingError, PartialInfrastructureMap,
};
use crate::framework::{
    data_model::config::{ConfigIdentifier, DataModelConfig, ModelConfigurationError},
    python::executor::{run_python_command, run_python_file, PythonCommand},
};
use crate::project::Project;

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Default, Hash)]
pub struct PythonDataModelConfig {
    #[serde(default)]
    pub class_name: String,
    #[serde(default)]
    pub config: DataModelConfig,
}

pub async fn execute_python_model_file_for_config(
    project_location: &Path,
    path: &Path,
) -> Result<HashMap<ConfigIdentifier, DataModelConfig>, ModelConfigurationError> {
    let abs_path = path.canonicalize().or_else(|_| absolute(path));
    let path_str = abs_path.as_deref().unwrap_or(path).to_string_lossy();
    let process = run_python_file(
        project_location,
        path,
        &[("MOOSE_PYTHON_DM_DUMP", &*path_str)],
    )
    .await
    .map_err(|e| ModelConfigurationError::PythonRunner(e.to_string()))?;

    let output = process
        .wait_with_output()
        .await
        .map_err(|e| ModelConfigurationError::PythonRunner(e.to_string()))?;

    if !output.status.success() {
        return Err(ModelConfigurationError::PythonRunner(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    let raw_string_stdout = String::from_utf8_lossy(&output.stdout);

    let configs: HashMap<ConfigIdentifier, DataModelConfig> = raw_string_stdout
        .split("___DATAMODELCONFIG___")
        .filter_map(|entry| {
            let config = serde_json::from_str::<PythonDataModelConfig>(entry).ok()?;
            Some((config.class_name, config.config))
        })
        .collect();

    info!("Data Model configuration for {:?}: {:?}", path, configs);

    Ok(configs)
}

pub async fn load_main_py(
    project: &Project,
    project_location: &Path,
) -> anyhow::Result<PartialInfrastructureMap, DmV2LoadingError> {
    let child = run_python_command(project, project_location, PythonCommand::DmV2Serializer)?;
    PartialInfrastructureMap::from_subprocess(child, "main.py").await
}
