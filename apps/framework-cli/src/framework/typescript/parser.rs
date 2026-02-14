use std::io::ErrorKind::NotFound;
use std::path::Path;
use std::{env, fs};

use serde_json::{json, Value};
use tracing::debug;

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

    #[error("TypeScript compilation failed: {0}")]
    CompilationError(String),
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

/// Default output directory for compiled TypeScript code.
pub const DEFAULT_OUT_DIR: &str = ".moose/compiled";

/// Reads the outDir from .moose/.compile-config.json (written by moose-tspc).
/// Falls back to default if the file doesn't exist.
///
/// This avoids duplicating the outDir resolution logic between Rust and TypeScript.
/// moose-tspc is the source of truth for where it compiles to.
fn read_compile_config_out_dir(project: &Project) -> Option<String> {
    let config_path = project
        .project_location
        .join(".moose")
        .join(".compile-config.json");

    fs::read_to_string(&config_path)
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        .and_then(|json| json.get("outDir")?.as_str().map(String::from))
}

/// Gets the path to the compiled index.js for a TypeScript project.
/// Reads from .moose/.compile-config.json (written by moose-tspc) to know where output is.
pub fn get_compiled_index_path(project: &Project) -> std::path::PathBuf {
    let out_dir =
        read_compile_config_out_dir(project).unwrap_or_else(|| DEFAULT_OUT_DIR.to_string());
    project
        .project_location
        .join(&out_dir)
        .join(&project.source_dir)
        .join("index.js")
}

/// Ensures TypeScript is compiled before loading infrastructure.
///
/// Runs moose-tspc to compile TypeScript. Respects user's tsconfig.json outDir
/// if specified, otherwise uses .moose/compiled.
///
/// This should be called before loading TypeScript infrastructure to ensure
/// compiled artifacts exist for the dmv2-serializer.
pub fn ensure_typescript_compiled(project: &Project) -> Result<(), TypescriptParsingError> {
    use crate::utilities::constants::IS_DEV_MODE;
    use std::sync::atomic::Ordering;

    // In dev mode, tspc --watch handles compilation. We don't need to run tspc ourselves
    // because spawn_and_await_initial_compile() already started it and the watcher keeps
    // it running for incremental compilation.
    if IS_DEV_MODE.load(Ordering::Relaxed) {
        debug!(
            "Skipping ensure_typescript_compiled: tspc --watch is handling compilation in dev mode"
        );
        return Ok(());
    }

    let path = std::env::var("PATH").unwrap_or_else(|_| "/usr/local/bin".to_string());
    let bin_path = format!(
        "{}/node_modules/.bin:{}",
        project.project_location.display(),
        path
    );

    // Don't pass outDir - let moose-tspc read from tsconfig or use default
    // Call moose-tspc directly (bin from @514labs/moose-lib) instead of npx
    // since npx would try to find a standalone package named "moose-tspc"
    let output = std::process::Command::new("moose-tspc")
        .current_dir(&project.project_location)
        .env("MOOSE_SOURCE_DIR", &project.source_dir)
        .env("PATH", bin_path)
        .output()
        .map_err(|e| {
            TypescriptParsingError::CompilationError(format!("Failed to run moose-tspc: {}", e))
        })?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Check if output was generated despite errors (noEmitOnError: false)
        let compiled_index = get_compiled_index_path(project);
        if compiled_index.exists() {
            // Compilation succeeded with warnings
            debug!("TypeScript compiled with warnings: {}", stderr);
            Ok(())
        } else {
            Err(TypescriptParsingError::CompilationError(stderr.to_string()))
        }
    }
}
