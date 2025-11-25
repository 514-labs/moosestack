use super::bin;
use crate::framework::consumption::model::ConsumptionQueryParam;
use crate::framework::data_model::config::{ConfigIdentifier, DataModelConfig};
use crate::framework::typescript::consumption::{extract_intput_param, extract_schema};
use crate::project::Project;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use tokio::io::AsyncReadExt;
use tokio::process::Child;
use tracing::debug;

const EXPORT_SERIALIZER_BIN: &str = "export-serializer";
const EXPORT_FUNC_TYPE_BIN: &str = "consumption-type-serializer";

const EXPORT_CONFIG_PROCESS: &str = "Data model config";
const EXPORT_FUNC_TYPE_PROCESS: &str = "API schema";

#[derive(Debug, thiserror::Error)]
#[error("Failed to run code")]
#[non_exhaustive]
pub enum ExportCollectorError {
    Tokio(#[from] tokio::io::Error),
    JsonParsing(#[from] serde_json::Error),
    #[error("{message}")]
    Other {
        message: String,
    },
}

pub fn collect_from_index(
    project: &Project,
    project_path: &Path,
) -> Result<Child, ExportCollectorError> {
    let process_name = "dmv2-serializer";
    let process = bin::run(process_name, project_path, &[], project)?;
    Ok(process)
}

async fn collect_exports(
    command_name: &str,
    process_name: &str,
    file: &Path,
    project: &Project,
    project_path: &Path,
) -> Result<Value, ExportCollectorError> {
    let file_path_str = file.to_str().ok_or(ExportCollectorError::Other {
        message: "Did not get a proper file path to load exports from".to_string(),
    })?;

    let args = vec![file_path_str];
    let process = bin::run(command_name, project_path, &args, project)?;

    let mut stdout = process.stdout.ok_or_else(|| ExportCollectorError::Other {
        message: format!("{process_name} process did not have a handle to stdout"),
    })?;

    let mut stderr = process.stderr.ok_or_else(|| ExportCollectorError::Other {
        message: format!("{process_name} process did not have a handle to stderr"),
    })?;

    let mut raw_string_stderr: String = String::new();
    stderr.read_to_string(&mut raw_string_stderr).await?;

    if !raw_string_stderr.is_empty() {
        return Err(ExportCollectorError::Other {
            message: format!(
                "Error collecting exports in the file {file:?}: \n{raw_string_stderr}"
            ),
        });
    }

    let mut raw_string_stdout: String = String::new();
    stdout.read_to_string(&mut raw_string_stdout).await?;

    serde_json::from_str(&raw_string_stdout).map_err(|e| ExportCollectorError::Other {
        message: format!("Invalid JSON from exports: {e}\nRaw output: {raw_string_stdout}"),
    })
}

pub async fn get_data_model_configs(
    file: &Path,
    project: &Project,
    project_path: &Path,
    enums: HashSet<&str>,
) -> Result<HashMap<ConfigIdentifier, DataModelConfig>, ExportCollectorError> {
    let exports = collect_exports(
        EXPORT_SERIALIZER_BIN,
        EXPORT_CONFIG_PROCESS,
        file,
        project,
        project_path,
    )
    .await?;

    match exports {
        Value::Object(map) => {
            let mut result = HashMap::new();
            for (key, value) in map {
                if enums.contains(key.as_str()) {
                    continue;
                }
                if let Ok(model_config) = serde_json::from_value(value) {
                    result.insert(key, model_config);
                }
            }
            Ok(result)
        }
        _ => Err(ExportCollectorError::Other {
            message: "Expected an object as the root of the exports".to_string(),
        }),
    }
}

pub async fn get_func_types(
    file: &Path,
    project: &Project,
    project_path: &Path,
) -> Result<(Vec<ConsumptionQueryParam>, Value, Option<String>), ExportCollectorError> {
    let exports = collect_exports(
        EXPORT_FUNC_TYPE_BIN,
        EXPORT_FUNC_TYPE_PROCESS,
        file,
        project,
        project_path,
    )
    .await?;

    debug!("Schema for path {:?} {}", file, exports);

    let (input_params, output_schema, version) = match exports {
        Value::Object(mut map) => (
            extract_intput_param(&map)?,
            match map.remove("outputSchema") {
                None => Value::Null,
                Some(Value::Object(schema)) => extract_schema(&schema)?.clone(),
                Some(_) => Err(ExportCollectorError::Other {
                    message: "output schema must be an object".to_string(),
                })?,
            },
            map.get("version")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        ),
        _ => Err(ExportCollectorError::Other {
            message: "Expected an object as the root of the exports".to_string(),
        })?,
    };
    Ok((input_params, output_schema, version))
}
