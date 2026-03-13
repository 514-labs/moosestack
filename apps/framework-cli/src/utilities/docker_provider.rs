use crate::cli::display::{with_spinner_completion, with_timing, Message};
use crate::cli::routines::util::ensure_docker_running;
use crate::cli::routines::{RoutineFailure, RoutineSuccess};
use crate::cli::settings::Settings;
use crate::project::Project;
use crate::utilities::constants::SHOW_TIMING;
use crate::utilities::docker::DockerClient;
use crate::utilities::infra_provider::InfraProvider;
use std::sync::atomic::Ordering;
use std::thread::sleep;
use std::time::Duration;
use tracing::debug;

use crate::utilities::constants::{
    CLICKHOUSE_CONTAINER_NAME, REDPANDA_CONTAINER_NAME, TEMPORAL_CONTAINER_NAME,
};
use crate::utilities::docker::DockerComposeContainerInfo;

/// Docker-based infrastructure provider.
///
/// Wraps the existing `DockerClient` behind the `InfraProvider` trait.
/// All behaviour is identical to the pre-trait code paths.
pub struct DockerInfraProvider {
    docker_client: DockerClient,
}

impl DockerInfraProvider {
    pub fn new(settings: &Settings) -> Self {
        Self {
            docker_client: DockerClient::new(settings),
        }
    }

    /// Access the underlying `DockerClient` for operations not covered by
    /// the trait (e.g. `buildx`, `tail_container_logs`, compose file creation).
    pub fn docker_client(&self) -> &DockerClient {
        &self.docker_client
    }
}

impl InfraProvider for DockerInfraProvider {
    fn setup(&self, project: &Project, settings: &Settings) -> Result<(), RoutineFailure> {
        let output = self.docker_client.create_compose_file(project, settings);
        match output {
            Ok(_) => {
                RoutineSuccess::success(Message::new(
                    "Created".to_string(),
                    "docker compose file".to_string(),
                ))
                .show();
                Ok(())
            }
            Err(err) => Err(RoutineFailure::new(
                Message::new(
                    "Failed".to_string(),
                    "to create docker compose file".to_string(),
                ),
                err,
            )),
        }
    }

    fn start(&self, project: &Project) -> Result<(), RoutineFailure> {
        ensure_docker_running(&self.docker_client).map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Failed".to_string(),
                    "to ensure docker is running".to_string(),
                ),
                e,
            )
        })?;

        with_timing("Start Infra", || {
            with_spinner_completion(
                "Starting local infrastructure",
                "Local infrastructure started successfully",
                || self.docker_client.start_containers(project),
                !project.is_production && !SHOW_TIMING.load(Ordering::Relaxed),
            )
        })
        .map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Failed".to_string(),
                    "to start docker containers".to_string(),
                ),
                e,
            )
        })
    }

    fn stop(&self, project: &Project, settings: &Settings) -> Result<(), RoutineFailure> {
        ensure_docker_running(&self.docker_client).map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Failed".to_string(),
                    "to ensure docker is running".to_string(),
                ),
                e,
            )
        })?;

        if settings.should_shutdown_containers() {
            self.docker_client.stop_containers(project).map_err(|err| {
                RoutineFailure::new(
                    Message::new("Failed".to_string(), "to stop containers".to_string()),
                    err,
                )
            })?;
        } else {
            tracing::info!(
                "Skipping container shutdown based on settings and environment variables"
            );
        }

        Ok(())
    }

    fn validate_clickhouse(&self, project: &Project) -> Result<RoutineSuccess, RoutineFailure> {
        let container_name = format!(
            "{}-{}-1",
            project.name().to_lowercase(),
            CLICKHOUSE_CONTAINER_NAME
        );
        validate_container_run(
            project,
            &container_name,
            Some("healthy"),
            &self.docker_client,
        )
    }

    fn validate_redpanda(&self, project: &Project) -> Result<RoutineSuccess, RoutineFailure> {
        let container_name = format!(
            "{}-{}-1",
            project.name().to_lowercase(),
            REDPANDA_CONTAINER_NAME
        );
        validate_container_run(project, &container_name, None, &self.docker_client)
    }

    fn validate_redpanda_cluster(
        &self,
        project_name: &str,
    ) -> Result<RoutineSuccess, RoutineFailure> {
        self.docker_client
            .run_rpk_cluster_info(project_name, 10)
            .map_err(|err| {
                RoutineFailure::new(
                    Message::new(
                        "Failed".to_string(),
                        format!("to validate red panda cluster, {err}"),
                    ),
                    err,
                )
            })?;

        Ok(RoutineSuccess::success(Message::new(
            "Validated".to_string(),
            "Redpanda cluster".to_string(),
        )))
    }

    fn validate_temporal(&self, project: &Project) -> Result<RoutineSuccess, RoutineFailure> {
        let container_name = format!(
            "{}-{}-1",
            project.name().to_lowercase(),
            TEMPORAL_CONTAINER_NAME
        );
        validate_container_run(
            project,
            &container_name,
            Some("healthy"),
            &self.docker_client,
        )
    }
}

// ---------------------------------------------------------------------------
// Helpers migrated from cli/routines/validate.rs
// ---------------------------------------------------------------------------

fn find_container(
    project: &Project,
    container_name: &str,
    docker_client: &DockerClient,
) -> Result<DockerComposeContainerInfo, RoutineFailure> {
    let containers = docker_client.list_containers(project).map_err(|err| {
        RoutineFailure::new(
            Message::new("Failed".to_string(), "to get the containers".to_string()),
            err,
        )
    })?;

    containers
        .into_iter()
        .find(|container| container.name.contains(container_name))
        .ok_or_else(|| {
            RoutineFailure::error(Message::new(
                "Failed".to_string(),
                format!("to find {container_name} docker container"),
            ))
        })
}

fn validate_container_run(
    project: &Project,
    container_name: &str,
    health: Option<&str>,
    docker_client: &DockerClient,
) -> Result<RoutineSuccess, RoutineFailure> {
    let mut container = find_container(project, container_name, docker_client)?;

    if let Some(expected) = health {
        for _ in 0..30 {
            if let Some(effective_health) = container.health {
                if effective_health == expected {
                    break;
                }
            } else {
                debug!("No health info for container {}", container_name);
                break;
            }

            container = find_container(project, container_name, docker_client)?;
            sleep(Duration::from_secs(1));
        }
    }

    Ok(RoutineSuccess::success(Message::new(
        "Validated".to_string(),
        format!("{container_name} docker container"),
    )))
}
