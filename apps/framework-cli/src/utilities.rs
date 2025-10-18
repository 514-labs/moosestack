use std::path::Path;

pub mod auth;
pub mod capture;
pub mod clickhouse_url;
pub mod constants;
pub mod decode_object;
pub mod docker;
pub mod git;
pub mod identifiers;
pub mod keyring;
pub mod machine_id;
pub mod nodejs_version;
pub mod package_managers;
pub mod process_output;
pub mod retry;
pub mod secrets;
pub mod system;
pub mod validate_passthrough;

pub trait PathExt {
    fn ext_is_supported_lang(&self) -> bool;
}
impl PathExt for Path {
    fn ext_is_supported_lang(&self) -> bool {
        self.extension().is_some_and(|ext| {
            ext == constants::TYPESCRIPT_FILE_EXTENSION || ext == constants::PYTHON_FILE_EXTENSION
        })
    }
}

pub const fn _true() -> bool {
    true
}
