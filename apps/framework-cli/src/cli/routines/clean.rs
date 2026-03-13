use crate::cli::display::Message;
use crate::cli::settings::Settings;
use crate::project::Project;
use crate::utilities::infra_provider::InfraProvider;

use super::{RoutineFailure, RoutineSuccess};

pub fn clean_project(
    project: &Project,
    provider: &dyn InfraProvider,
) -> Result<RoutineSuccess, RoutineFailure> {
    let settings = Settings::load().map_err(|e| {
        RoutineFailure::new(
            Message::new("Failed".to_string(), "to load settings".to_string()),
            e,
        )
    })?;

    provider.stop(project, &settings)?;

    Ok(RoutineSuccess::success(Message::new(
        "Cleaned".to_string(),
        "project".to_string(),
    )))
}
