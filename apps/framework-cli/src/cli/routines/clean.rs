use crate::utilities::docker::DockerClient;
use crate::{cli::display::Message, cli::settings::Settings, project::Project};
use tracing::info;

use super::util::ensure_docker_running;
use super::{RoutineFailure, RoutineSuccess};

pub fn clean_project(
    project: &Project,
    docker_client: &DockerClient,
) -> Result<RoutineSuccess, RoutineFailure> {
    ensure_docker_running(docker_client).map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Failed".to_string(),
                "to ensure docker is running".to_string(),
            ),
            e,
        )
    })?;

    // Get the settings to check if containers should be shut down
    let settings = Settings::load().map_err(|e| {
        RoutineFailure::new(
            Message::new("Failed".to_string(), "to load settings".to_string()),
            e,
        )
    })?;

    if settings.should_shutdown_containers() {
        docker_client.stop_containers(project).map_err(|err| {
            RoutineFailure::new(
                Message::new("Failed".to_string(), "to stop containers".to_string()),
                err,
            )
        })?;
    } else {
        info!("Skipping container shutdown based on settings and environment variables");
    }

    Ok(RoutineSuccess::success(Message::new(
        "Cleaned".to_string(),
        "project".to_string(),
    )))
}
