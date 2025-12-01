use std::io::ErrorKind::NotFound;
use std::path::Path;
use std::{env, fs};

use serde_json::{json, Value};

use crate::framework::data_model::parser::FileObjects;
use crate::project::Project;
use crate::utilities::constants::TSCONFIG_JSON;
use crate::utilities::process_output::run_command_with_output_proxy;

#[derive(Debug, thiserror::Error)]
#[error("Failed to parse the typescript file")]
#[non_exhaustive]
pub enum TypescriptParsingError {
    #[error("Failure setting up the file structure")]
    FileSystemError(#[from] std::io::Error),
    TypescriptCompilerError(Option<Box<dyn std::error::Error + Send + Sync>>),
    #[error("Typescript Parser - Unsupported data type in {field_name}: {type_name}")]
    UnsupportedDataTypeError {
        type_name: String,
        field_name: String,
    },

    #[error("Invalid output from compiler plugin. Possible incompatible versions between moose-lib and moose-cli")]
    DeserializationError(#[from] serde_json::Error),

    OtherError {
        message: String,
    },
}

pub async fn extract_data_model_from_file(
    path: &Path,
    project: &Project,
    version: &str,
) -> Result<FileObjects, TypescriptParsingError> {
    let internal = project.internal_dir().unwrap();
    let output_dir = internal.join("serialized_datamodels");

    tracing::info!("Extracting data model from file: {:?}", path);

    fs::write(
        internal.join(TSCONFIG_JSON),
        json!({
            "compilerOptions":{
                "outDir": "dist", // relative path, so .moose/dist
                "plugins": [{
                    "transform": "../node_modules/@514labs/moose-lib/dist/dataModels/toDataModels.js"
                }],
                "strict":true,
                "esModuleInterop": true
            },
            "include":[path]
        })
        .to_string(),
    )?;
    fs::remove_dir_all(&output_dir).or_else(
        |e| {
            if e.kind() == NotFound {
                Ok(())
            } else {
                Err(e)
            }
        },
    )?;

    // This adds the node_modules/.bin to the PATH so that we can run moose-tspc
    let path_env = env::var("PATH").unwrap_or_else(|_| "/usr/local/bin".to_string());
    let bin_path = format!(
        "{}:{}/node_modules/.bin",
        path_env,
        project.project_location.to_str().unwrap()
    );

    let ts_return_code = {
        let mut command = tokio::process::Command::new("tspc");
        command
            .arg("--project")
            .arg(format!(".moose/{TSCONFIG_JSON}"))
            .env("PATH", bin_path)
            .env("NPM_CONFIG_UPDATE_NOTIFIER", "false")
            .current_dir(&project.project_location);

        run_command_with_output_proxy(command, "TypeScript Compiler")
            .await
            .map_err(|err| {
                tracing::error!("Error while running moose-tspc: {}", err);
                TypescriptParsingError::TypescriptCompilerError(Some(err))
            })?
    };

    tracing::info!("Typescript compiler return code: {:?}", ts_return_code);

    if !ts_return_code.success() {
        return Err(TypescriptParsingError::TypescriptCompilerError(None));
    }
    let json_path = path.with_extension("json");
    let output_file_name = json_path
        .file_name()
        .ok_or_else(|| TypescriptParsingError::OtherError {
            message: "Missing file name in path".to_string(),
        })?
        .to_str()
        .ok_or_else(|| TypescriptParsingError::OtherError {
            message: "File name is not valid UTF-8".to_string(),
        })?;
    let output = fs::read(output_dir.join(output_file_name)).map_err(|e| {
        TypescriptParsingError::OtherError {
            message: format!("Unable to read output of compiler: {e}"),
        }
    })?;

    let mut output_json = serde_json::from_slice::<Value>(&output).map_err(|e| {
        TypescriptParsingError::OtherError {
            message: format!("Unable to parse output JSON: {e}"),
        }
    })?;

    if let Some(error_type) = output_json.get("error_type") {
        if let Some(error_type) = error_type.as_str() {
            if error_type == "unknown_type" {
                let type_name = output_json
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let field_name = output_json
                    .get("field")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                return Err(TypescriptParsingError::UnsupportedDataTypeError {
                    type_name,
                    field_name,
                });
            } else if error_type == "unsupported_enum" {
                return Err(TypescriptParsingError::OtherError {
                    message: "We do not allow to mix String enums with Number based enums, please choose one".to_string()
                });
            } else if error_type == "unsupported_feature" {
                let feature = output_json
                    .get("feature_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                return Err(TypescriptParsingError::OtherError {
                    message: format!("Unsupported feature: {feature}"),
                });
            } else if error_type == "index_type" {
                let type_name = output_json
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                return Err(TypescriptParsingError::OtherError {
                    message: format!("Unsupported index signature in {type_name}"),
                });
            }
        }
    }

    // There is probably a better way to do this by communicating to the underlying
    // process. But for now, we will just add the version and file path to the output
    if let Some(data_models) = output_json.get_mut("models") {
        if let Some(data_models) = data_models.as_array_mut() {
            for data_model in data_models {
                if let Some(dm) = data_model.as_object_mut() {
                    dm.insert("version".to_string(), version.into());
                    dm.insert(
                        "abs_file_path".to_string(),
                        path.to_string_lossy().to_string().into(),
                    );
                }
            }
        }
    }

    Ok(serde_json::from_value(output_json)?)
}
