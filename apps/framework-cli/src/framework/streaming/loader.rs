use super::model::{FunctionError, StreamingFunction};
use crate::framework::versions::Version;
use crate::utilities::constants::PYTHON_INIT_FILE;
use crate::utilities::PathExt;
use crate::{
    framework::data_model::model::DataModelSet,
    project::Project,
    utilities::constants::{PY_FLOW_FILE, TS_FLOW_FILE},
};
use tracing::{debug, info, warn};
use regex::{Captures, Regex};
use std::ffi::OsStr;
use std::{fs, path::Path};

const MIGRATION_REGEX: &str =
    r"^([a-zA-Z0-9_]+)_migrate__([0-9_]+)__(([a-zA-Z0-9_]+)__)?([0-9_]+)$";

/**
 * This function gets the streaming functions as defined by the user for the
 * current version of the moose application.
 */
pub async fn get_all_current_streaming_functions(
    project: &Project,
    data_models: &DataModelSet,
) -> Result<Vec<StreamingFunction>, FunctionError> {
    let functions_path = project.streaming_func_dir();
    get_all_streaming_functions(data_models, project.cur_version().as_str(), &functions_path).await
}

pub fn parse_streaming_function(file_name_no_extension: &str) -> Option<(&str, Option<&str>)> {
    let split: Vec<&str> = file_name_no_extension.split("__").collect();
    match split.len() {
        1 => Some((split[0], None)),
        2 => Some((split[0], Some(split[1]))),
        _ => None,
    }
}

/**
 * This function should be pointed at the root of the 'functions' directory.
 * Whether this is an old version of the moose app function (inside the version directory)
 * or the current version of the application.
 *
 * It will assume that all the first children of the directory are the data models
 * sources and the the second children are the data model targets.
 *
 * This also retrieves the migration streaming functions.
 *
 * TODO - handle historical versions. For now this only collects the latest/current version
 * of streaming functions using the latest available topics for each data model.
 */
async fn get_all_streaming_functions(
    data_models: &DataModelSet,
    current_version: &str,
    path: &Path,
) -> Result<Vec<StreamingFunction>, FunctionError> {
    // This should not fail since the regex is hardcoded
    let migration_regex = Regex::new(MIGRATION_REGEX).unwrap();

    let mut functions = vec![];

    for source in fs::read_dir(path)? {
        let source = source?;

        // We check if the file is a migration streaming function
        if source.metadata()?.is_file() {
            if source.path().ext_is_supported_lang()
                && source.path().file_name() != Some(OsStr::new(PYTHON_INIT_FILE))
            {
                let potential_function_file_name = &source
                    .path()
                    .with_extension("")
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string();

                match migration_regex.captures(potential_function_file_name) {
                    None => {
                        if let Some((source_data_model_name, target_data_model_name)) =
                            parse_streaming_function(potential_function_file_name)
                        {
                            let source_data_model = if let Some(source_data_model) =
                                data_models.get(source_data_model_name, current_version)
                            {
                                source_data_model
                            } else {
                                warn!(
                                    "Data model {} not found in the data model set",
                                    source_data_model_name
                                );
                                continue;
                            };

                            let target_data_model =
                                if let Some(target_name) = target_data_model_name {
                                    if let Some(target_data_model) =
                                        data_models.get(target_name, current_version)
                                    {
                                        Some(target_data_model.clone())
                                    } else {
                                        warn!(
                                            "Data model {} not found in the data model set",
                                            target_name
                                        );
                                        continue;
                                    }
                                } else {
                                    None
                                };

                            let function = StreamingFunction {
                                name: potential_function_file_name.clone(),
                                source_data_model: source_data_model.clone(),
                                target_data_model: target_data_model.clone(),
                                executable: source.path(),
                                version: Version::from_string(current_version.to_string()),
                            };
                            functions.push(function);
                        } else {
                            debug!(
                                "Fragments of file {:?} does not match the convention",
                                source.path()
                            );
                        }
                    }
                    Some(caps) => {
                        let func = build_migration_function(
                            &source.file_name().to_string_lossy(),
                            data_models,
                            current_version,
                            caps,
                            &source.path(),
                        );
                        functions.push(func);
                    }
                }
            }
            // In this case we are currently processing a single file
            // As such we can skip the following steps which are specific
            // to the old naming convention, i.e. nested directories
            continue;
        }

        let source_data_model_name = source.file_name().to_string_lossy().to_string();
        let source_data_model = match data_models.get(&source_data_model_name, current_version) {
            Some(model) => model,
            None => {
                warn!(
                    "Data model {} not found in the data model set",
                    source_data_model_name
                );
                continue;
            }
        };

        let target = fs::read_dir(source.path())?;

        for target in target {
            let target = target?;
            let target_data_model_name = target.file_name().to_string_lossy().to_string();
            let target_data_model = match data_models.get(&target_data_model_name, current_version)
            {
                Some(model) => model,
                None => {
                    warn!(
                        "Data model {} not found in the data model set",
                        target_data_model_name
                    );
                    continue;
                }
            };

            for function_file in fs::read_dir(target.path())? {
                let function_file = function_file?;
                let file_name = function_file.file_name().to_string_lossy().to_string();

                if function_file.metadata()?.is_file()
                    && (file_name.starts_with(TS_FLOW_FILE) || file_name.starts_with(PY_FLOW_FILE))
                {
                    let func = StreamingFunction {
                        name: file_name.clone(),
                        source_data_model: source_data_model.clone(),
                        target_data_model: Some(target_data_model.clone()),
                        executable: function_file.path().to_path_buf(),
                        version: Version::from_string(current_version.to_string()),
                    };
                    functions.push(func);

                    // There can only be one streaming function file per target
                    continue;
                }
            }
        }
    }

    Ok(functions)
}

fn build_migration_function(
    file_name: &str,
    data_models: &DataModelSet,
    current_version: &str,
    caps: Captures,
    executable: &Path,
) -> StreamingFunction {
    info!(
        "Streaming function regex captures for migrations {:?}",
        caps
    );
    let source_model_name = caps.get(1).unwrap().as_str();
    let source_version = caps.get(2).unwrap().as_str().replace('_', ".");

    let source_data_model = data_models.get(source_model_name, &source_version).unwrap();

    let target_model_name = caps.get(4).map(|m| m.as_str()).unwrap_or(source_model_name);
    let target_version = caps.get(5).unwrap().as_str().replace('_', ".");
    let target_data_model = data_models.get(target_model_name, &target_version).unwrap();

    StreamingFunction {
        name: file_name.to_string(),
        source_data_model: source_data_model.clone(),
        target_data_model: Some(target_data_model.clone()),
        executable: executable.to_path_buf(),
        version: Version::from_string(current_version.to_string()),
    }
}
