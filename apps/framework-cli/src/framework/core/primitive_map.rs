use log::warn;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};
use walkdir::WalkDir;

use crate::framework::core::infrastructure::table::ColumnType;
use crate::framework::data_model::config::DataModelConfig;
use crate::framework::data_model::DuplicateModelError;
use crate::framework::languages::SupportedLanguages;
use crate::utilities::PathExt;
use crate::{
    framework::{
        blocks::model::Blocks,
        data_model::{
            self,
            config::ModelConfigurationError,
            model::{DataModel, DataModelSet},
            parser::DataModelParsingError,
        },
        streaming::{loader::get_all_current_streaming_functions, model::StreamingFunction},
    },
    project::{Project, ProjectFileError},
};

#[derive(Debug, thiserror::Error)]
pub enum PrimitiveMapLoadingError {
    #[error("Failure walking the tree")]
    WalkDir(#[from] walkdir::Error),
    #[error("Failed to parse the data model file")]
    DataModel(#[from] DataModelError),

    #[error("Failed to load the project file")]
    FileLoading(#[from] ProjectFileError),

    #[error("Failed to load functions")]
    FunctionsLoading(#[from] crate::framework::streaming::model::FunctionError),
}

#[derive(Debug, thiserror::Error)]
#[error("Failed to get the Data Model configuration")]
#[non_exhaustive]
pub enum DataModelError {
    Configuration(#[from] ModelConfigurationError),
    Parsing(#[from] DataModelParsingError),
    Duplicate(#[from] DuplicateModelError),

    #[error("{message}")]
    Other {
        message: String,
    },
}

#[derive(Debug, Clone, Default)]
pub struct PrimitiveMap {
    pub datamodels: DataModelSet,
    pub functions: Vec<StreamingFunction>,

    // We are currently not loading blocks 1 by 1 in the CLI, we should load them individually to be able
    // to start/stop them individually. Right now we are starting all of them at once through the language specific
    // blocks runner. We are loading blocks as 1 unique blocks as a default.
    pub blocks: Blocks,
}

fn check_no_empty_nested(
    column_type: &ColumnType,
    field_name: Vec<String>,
) -> Result<(), PrimitiveMapLoadingError> {
    match column_type {
        ColumnType::Array { element_type, .. } => check_no_empty_nested(element_type, field_name),
        ColumnType::Nested(nested) => {
            if nested.columns.is_empty() {
                Err(DataModelError::Other {
                    message: format!("No column inside nested: {}", field_name.join(".")),
                })?
            }
            for inner in nested.columns.iter() {
                let mut with_inner_field_name = field_name.clone();
                with_inner_field_name.push(inner.name.clone());
                check_no_empty_nested(&inner.data_type, with_inner_field_name)?
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn check_invalid_table(dm: &DataModel) -> Result<(), PrimitiveMapLoadingError> {
    let mut no_ordering = dm.config.storage.order_by_fields.is_empty();
    for column in dm.columns.iter() {
        if column.primary_key {
            no_ordering = false
        }
        check_no_empty_nested(&column.data_type, vec![column.name.clone()])?;
    }

    if no_ordering {
        Err(DataModelError::Other {
            message: format!(
                "Missing `Key` field or order_by_fields in data model {}. Key must be a top level field.",
                dm.name
            ),
        })?
    };
    Ok(())
}

impl PrimitiveMap {
    fn validate(&self) -> Result<(), PrimitiveMapLoadingError> {
        for dm in self.datamodels.iter() {
            if dm.config.storage.enabled {
                check_invalid_table(dm)?
            }
        }
        Ok(())
    }

    // Currently limited to the current version - will need to layout previous versions in the future
    pub async fn load(project: &Project) -> Result<PrimitiveMap, PrimitiveMapLoadingError> {
        let mut primitive_map = PrimitiveMap::default();

        for version in project.versions() {
            log::debug!("Loading Versioned primitive map for version: {}", version);
            PrimitiveMap::load_versioned(project, &version, &mut primitive_map).await?;
        }

        // TODO add versioning for primitives other than data models.
        primitive_map.functions =
            get_all_current_streaming_functions(project, &primitive_map.datamodels)
                .await?
                .iter()
                .filter(|func| func.executable.ext_is_supported_lang())
                .cloned()
                .collect();

        log::debug!("Loaded Versioned primitive map: {:?}", primitive_map);

        primitive_map.validate()?;

        Ok(primitive_map)
    }

    /**
     * Loads the PrimitiveMap with all the primitives for the given version.
     * Right now this is only the data models.
     */
    async fn load_versioned(
        project: &Project,
        version: &str,
        primitive_map: &mut PrimitiveMap,
    ) -> Result<(), PrimitiveMapLoadingError> {
        let data_models_root = project.versioned_data_model_dir(version)?;
        log::debug!("Loading data models from: {:?}", data_models_root);

        for res_entry in WalkDir::new(data_models_root) {
            let entry = res_entry?;

            if entry.file_type().is_file() {
                for model in PrimitiveMap::load_data_model(project, version, entry.path()).await? {
                    primitive_map.datamodels.add(model).map_err(|duplicate| {
                        PrimitiveMapLoadingError::DataModel(duplicate.into())
                    })?
                }
            }
        }

        // TODO Add validation that blocks and data model names do not overlap
        Ok(())
    }

    pub fn canonicalize_model_name(name: &str) -> String {
        name.trim().to_lowercase()
    }

    /**
     * Loads the data models from the given file path and with their configurations.
     */
    async fn load_data_model(
        project: &Project,
        version: &str,
        file_path: &Path, // one single file
    ) -> Result<Vec<DataModel>, DataModelError> {
        let file_objects =
            data_model::parser::parse_data_model_file(file_path, version, project).await?;
        log::debug!(
            "Found the following data models: {:?} in path {:?}",
            file_objects.models,
            file_path
        );

        let mut indexed_models: HashMap<String, DataModel> = file_objects
            .models
            .into_iter()
            .map(|model| (Self::canonicalize_model_name(&model.name), model))
            .collect();

        let data_models_configs = data_model::config::get(
            file_path,
            project,
            &project.project_location,
            file_objects
                .enums
                .iter()
                .map(|e| e.name.as_str())
                .collect::<HashSet<&str>>(),
        )
        .await?;

        match project.language {
            SupportedLanguages::Typescript => {
                Self::combine_data_model_with_config_ts(&mut indexed_models, data_models_configs)?;
            }
            SupportedLanguages::Python => {
                Self::combine_data_model_with_config_py(&mut indexed_models, data_models_configs)?;
            }
        }

        log::debug!(
            "Data Models matched with configuration: {:?} from file: {:?}",
            indexed_models,
            file_path
        );

        Ok(indexed_models.into_values().collect())
    }

    fn combine_data_model_with_config_ts(
        indexed_models: &mut HashMap<String, DataModel>,
        data_models_configs: HashMap<String, DataModelConfig>,
    ) -> Result<(), DataModelError> {
        for (config_variable_name, config) in data_models_configs.into_iter() {
            let sanitized_config_name = Self::canonicalize_model_name(&config_variable_name);
            match sanitized_config_name.strip_suffix("config") {
                Some(config_name_without_suffix) => {
                    let data_model_opt = indexed_models.get_mut(config_name_without_suffix);
                    if let Some(data_model) = data_model_opt {
                        data_model.config = config;
                    } else {
                        return Err(DataModelError::Other {
                            message: format!(
                                "Config with name `{config_variable_name}` does not match any data model. Please make sure that the config variable name matches the pattern: <dataModelName>Config"
                            ),
                        });
                    }
                }
                None => {
                    return Err(DataModelError::Other { message: format!("Config name exports have to be of the format <dataModelName>Config so that they can be correlated to the proper data model. \n {config_variable_name} is not respecting this pattern") })
                }
            }
        }
        Ok(())
    }

    fn combine_data_model_with_config_py(
        indexed_models: &mut HashMap<String, DataModel>,
        data_models_configs: HashMap<String, DataModelConfig>,
    ) -> Result<(), DataModelError> {
        let mut from = std::mem::take(indexed_models);
        // models not found in data_models_configs are removed
        // as that means the dataclass is not decorated by moose_data_model
        for (name, config) in data_models_configs {
            let name = Self::canonicalize_model_name(&name);
            if let Some(mut dm) = from.remove(&name) {
                dm.config = config;
                indexed_models.insert(name, dm);
            } else {
                warn!("{} found in configs but not parsed data models.", name);
            };
        }
        Ok(())
    }

    pub fn data_models_iter(&self) -> impl Iterator<Item = &DataModel> {
        self.datamodels.iter()
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use crate::{
        framework::{core::primitive_map::PrimitiveMap, languages::SupportedLanguages},
        project::Project,
    };

    #[tokio::test]
    #[ignore]
    async fn test_load_primitive_map() {
        let project = Project::new(
            Path::new("/Users/nicolas/code/514/test"),
            "test".to_string(),
            SupportedLanguages::Typescript,
        );
        let primitive_map = PrimitiveMap::load(&project).await;
        println!("{primitive_map:?}");
        assert!(primitive_map.is_ok());
    }
}
