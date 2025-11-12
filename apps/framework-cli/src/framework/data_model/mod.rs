pub mod config;
pub mod model;
pub mod parser;

use crate::framework::data_model::model::DataModel;
use crate::utilities::system::file_name_contains;
use std::collections::HashMap;
use std::fmt::{Display, Formatter};
use std::{
    fmt,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone)]
pub struct DuplicateModelError {
    pub model_name: String,
    pub file_path: PathBuf,
    pub other_file_path: PathBuf,
}

impl DuplicateModelError {
    pub fn try_insert_core_v2(
        versions: &mut HashMap<String, DataModel>,
        dm: DataModel,
    ) -> Result<(), Self> {
        let maybe_existing = versions.insert(dm.version.to_string(), dm);
        match maybe_existing {
            None => Ok(()),
            Some(other_dm) => Err(DuplicateModelError {
                model_name: other_dm.name,
                file_path: versions
                    .get(other_dm.version.as_str())
                    .unwrap()
                    .abs_file_path
                    .clone(),
                other_file_path: other_dm.abs_file_path,
            }),
        }
    }
}

impl Display for DuplicateModelError {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Duplicate model {} in files: {}, {}",
            self.model_name,
            self.file_path.display(),
            self.other_file_path.display()
        )
    }
}

impl std::error::Error for DuplicateModelError {}

pub fn is_schema_file(path: &Path) -> bool {
    path.extension()
        .map(|extension| extension == "ts" || extension == "py")
        .unwrap_or(false)
        // TODO: There's logic that looks at version history which may have
        // .generated.ts files. Those files need to be ignored. We don't have
        // .generated.ts files anymore, so we can remove this when we can deprecate older versions
        && !file_name_contains(path, ".generated.ts")
}
