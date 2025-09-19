use keyring::Entry;

use crate::utilities::constants::MOOSE_CLI_NAME;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("Storage error: {0}")]
    StorageError(String),
}

#[derive(Debug)]
pub struct KeyringSecretRepository;

pub trait SecretRepository: Send + Sync {
    fn store(&self, project_name: &str, key: &str, value: &str) -> Result<(), SecretError>;
    fn get(&self, project_name: &str, key: &str) -> Result<Option<String>, SecretError>;
    fn delete(&self, project_name: &str, key: &str) -> Result<(), SecretError>;
}

impl SecretRepository for KeyringSecretRepository {
    fn store(&self, project_name: &str, key: &str, value: &str) -> Result<(), SecretError> {
        let service_name = format!("{MOOSE_CLI_NAME}_{project_name}");
        Entry::new(&service_name, key)
            .map_err(|e| SecretError::StorageError(e.to_string()))?
            .set_password(value)
            .map_err(|e| SecretError::StorageError(e.to_string()))
    }

    fn get(&self, project_name: &str, key: &str) -> Result<Option<String>, SecretError> {
        let service_name = format!("{MOOSE_CLI_NAME}_{project_name}");
        match Entry::new(&service_name, key)
            .map_err(|e| SecretError::StorageError(e.to_string()))?
            .get_password()
        {
            Ok(value) => Ok(Some(value)),
            Err(e) => {
                if matches!(e, keyring::Error::NoEntry) {
                    Ok(None)
                } else {
                    Err(SecretError::StorageError(e.to_string()))
                }
            }
        }
    }

    fn delete(&self, project_name: &str, key: &str) -> Result<(), SecretError> {
        let service_name = format!("{MOOSE_CLI_NAME}_{project_name}");
        Entry::new(&service_name, key)
            .map_err(|e| SecretError::StorageError(e.to_string()))?
            .delete_credential()
            .map_err(|e| SecretError::StorageError(e.to_string()))
    }
}
