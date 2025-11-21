use super::model::DataModel;
use crate::utilities::constants;
use crate::{
    framework::{core::infrastructure::table::DataEnum, python, typescript},
    project::Project,
};
use tracing::info;
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
#[error("Failed to parse the data model file")]
#[non_exhaustive]
pub enum DataModelParsingError {
    TypescriptParsingError(#[from] typescript::parser::TypescriptParsingError),
    PythonParsingError(#[from] python::parser::PythonParserError),
}

#[derive(Deserialize, Debug, Default)]
pub struct FileObjects {
    pub models: Vec<DataModel>,
    pub enums: Vec<DataEnum>,
}

impl FileObjects {
    pub fn new(models: Vec<DataModel>, enums: Vec<DataEnum>) -> FileObjects {
        FileObjects { models, enums }
    }
}

pub async fn parse_data_model_file(
    file_path: &Path,
    version: &str,
    project: &Project,
) -> Result<FileObjects, DataModelParsingError> {
    // TODO - Remove this if when we have deprecated v0.3 of the internal deployment
    if !file_path
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|s| s.contains("generated"))
    {
        if let Some(ext) = file_path.extension() {
            match ext.to_str() {
                Some(constants::TYPESCRIPT_FILE_EXTENSION) => Ok(
                    // we're not using parser, but TS compiler plugin
                    // this way we can/should retrieve all data models in one tspc invocation
                    // but not yet
                    typescript::parser::extract_data_model_from_file(file_path, project, version)
                        .await?,
                ),
                Some(constants::PYTHON_FILE_EXTENSION) => Ok(
                    python::parser::extract_data_model_from_file(file_path, version)?,
                ),
                Some(constants::PYTHON_CACHE_EXTENSION) => Ok(FileObjects::default()), // __pycache__
                _ => unsupported_file_type(file_path),
            }
        } else {
            unsupported_file_type(file_path)
        }
    } else {
        Ok(FileObjects::default())
    }
}

fn unsupported_file_type<T>(path: &Path) -> Result<FileObjects, T> {
    let file_name = match path.file_name() {
        None => "".to_string(),
        Some(f) => f.to_string_lossy().to_string(),
    };
    info!("Unsupported file: {}", file_name);

    Ok(FileObjects::default())
}
