use crate::{infrastructure::stream, project::Project};

use super::infrastructure_map::{OlapChange, TableChange};
use super::plan::InfraPlan;

#[derive(Debug, thiserror::Error)]
pub enum ValidationError {
    #[error("Some of the changes derived for the streaming engine are invalid")]
    StreamingChange(#[from] stream::StreamingChangesError),

    #[error("Table validation failed: {0}")]
    TableValidation(String),
}

pub fn validate(project: &Project, plan: &InfraPlan) -> Result<(), ValidationError> {
    stream::validate_changes(project, &plan.changes.streaming_engine_changes)?;

    // Check for validation errors in OLAP changes
    for change in &plan.changes.olap_changes {
        if let OlapChange::Table(TableChange::ValidationError { message, .. }) = change {
            return Err(ValidationError::TableValidation(message.clone()));
        }
    }

    Ok(())
}
