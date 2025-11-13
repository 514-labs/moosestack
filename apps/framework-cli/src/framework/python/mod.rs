use crate::framework::versions::Version;

pub mod blocks;
pub mod checker;
pub mod consumption;
pub mod datamodel_config;
pub mod executor;
pub mod generate;
pub mod parser;
pub mod scripts_worker;
pub mod streaming;
pub mod templates;
pub mod utils;

pub fn version_to_identifier(version: &Version) -> String {
    format!("v{}", version.as_suffix())
}
