use super::parser::PythonParserError;
use crate::framework::core::check::CheckerError;
use crate::framework::core::infrastructure::table::{Column, ColumnType};
use crate::framework::versions::parse_version;

use tokio::process::Command;

#[derive(Default)]
pub struct ColumnBuilder {
    pub name: String,
    pub data_type: Option<ColumnType>,
    pub required: Option<bool>,
    pub unique: Option<bool>,
    pub primary_key: Option<bool>,
    pub jwt: Option<bool>,
    pub path: Option<String>,
    pub default: Option<String>,
}

impl ColumnBuilder {
    pub fn new(name: String) -> Self {
        Self {
            name,
            ..Self::default()
        }
    }
    pub fn build(self) -> Result<Column, PythonParserError> {
        let name = self.name;

        let data_type =
            self.data_type
                .ok_or_else(|| PythonParserError::UnsupportedDataTypeError {
                    field_name: name.clone(),
                    type_name: "Class builder property, data_type, unsupported or not set properly"
                        .to_string(),
                })?;

        let required = self.required.unwrap_or(true);

        let unique = self.unique.unwrap_or(false);

        let primary_key = self.primary_key.unwrap_or(false);

        Ok(Column {
            name,
            data_type,
            required,
            unique,
            primary_key,
            default: self.default,
            annotations: Default::default(),
            // Comment is None at parsing stage - metadata comments for enum handling
            // are generated later when converting to ClickHouse columns
            comment: None,
            ttl: None,
            codec: None,
            materialized: None,
        })
    }
}

pub async fn check_python_version(required_version: &str) -> Result<(), CheckerError> {
    let output = Command::new("python3").arg("--version").output().await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(CheckerError::NotSupported(format!(
            "Failed to get Python version: {stderr}"
        )));
    }

    let version_str = std::str::from_utf8(&output.stdout).unwrap_or("");
    let version_parts: Vec<&str> = version_str.split_whitespace().collect();
    if version_parts.len() < 2 {
        return Err(CheckerError::NotSupported(format!(
            "Failed to get Python version. Found version: {version_str}"
        )));
    }

    let current_version = version_parts[1];
    let current_version_parts = parse_version(current_version);
    let required_version_parts = parse_version(required_version);

    if current_version_parts < required_version_parts {
        return Err(CheckerError::NotSupported(format!(
            "Python version {current_version} is not supported. Required version is {required_version}+"
        )));
    }

    Ok(())
}
