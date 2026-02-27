use std::path::Path;

use crate::utilities::constants;
use clap::ValueEnum;
use serde::{Deserialize, Serialize};

#[derive(ValueEnum, Copy, Serialize, Deserialize, Debug, Clone, Eq, PartialEq, Hash)]
pub enum SupportedLanguages {
    #[value(name = "typescript", alias = "ts")]
    #[serde(alias = "typescript", alias = "ts")]
    Typescript,
    #[value(name = "python", alias = "py")]
    #[serde(alias = "python", alias = "py")]
    Python,
}

impl SupportedLanguages {
    pub fn extension(self) -> &'static str {
        match self {
            SupportedLanguages::Typescript => constants::TYPESCRIPT_FILE_EXTENSION,
            SupportedLanguages::Python => constants::PYTHON_FILE_EXTENSION,
        }
    }

    pub fn from_file_path(path: &Path) -> Self {
        match path.extension().unwrap().to_str().unwrap() {
            constants::TYPESCRIPT_FILE_EXTENSION => SupportedLanguages::Typescript,
            constants::PYTHON_FILE_EXTENSION => SupportedLanguages::Python,
            _ => panic!("Unsupported language: {}", path.display()),
        }
    }

    pub fn from_proto(language: String) -> Self {
        match language.as_str() {
            "ts" => SupportedLanguages::Typescript,
            "python" => SupportedLanguages::Python,
            _ => panic!("Unsupported language: {language}"),
        }
    }
}

impl std::fmt::Display for SupportedLanguages {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            SupportedLanguages::Typescript => "ts",
            SupportedLanguages::Python => "python",
        };

        s.fmt(f)
    }
}

impl std::str::FromStr for SupportedLanguages {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "ts" => Ok(SupportedLanguages::Typescript),
            "python" => Ok(SupportedLanguages::Python),
            _ => Err(format!("{s} is not a supported language")),
        }
    }
}
