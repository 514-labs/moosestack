use tracing::debug;

use super::{RoutineFailure, RoutineSuccess};
use crate::cli::display::Message;
use crate::project::Project;
use crate::utilities::constants::{
    CLICKHOUSE_CONTAINER_NAME, REDPANDA_CONTAINER_NAME, TEMPORAL_CONTAINER_NAME,
};
use crate::utilities::docker::{DockerClient, DockerComposeContainerInfo};
use std::thread::sleep;
use std::time::Duration;

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
        // Make sure to account for CI environments slowness
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

pub fn validate_clickhouse_run(
    project: &Project,
    docker_client: &DockerClient,
) -> Result<RoutineSuccess, RoutineFailure> {
    let container_name = format!(
        "{}-{}-1",
        project.name().to_lowercase(),
        CLICKHOUSE_CONTAINER_NAME
    );
    validate_container_run(project, &container_name, Some("healthy"), docker_client)
}

pub fn validate_redpanda_run(
    project: &Project,
    docker_client: &DockerClient,
) -> Result<RoutineSuccess, RoutineFailure> {
    let container_name = format!(
        "{}-{}-1",
        project.name().to_lowercase(),
        REDPANDA_CONTAINER_NAME
    );
    validate_container_run(project, &container_name, None, docker_client)
}

pub fn validate_temporal_run(
    project: &Project,
    docker_client: &DockerClient,
) -> Result<RoutineSuccess, RoutineFailure> {
    let container_name = format!(
        "{}-{}-1",
        project.name().to_lowercase(),
        TEMPORAL_CONTAINER_NAME
    );
    validate_container_run(project, &container_name, Some("healthy"), docker_client)
}

pub fn validate_redpanda_cluster(
    project_name: String,
    docker_client: &DockerClient,
) -> Result<RoutineSuccess, RoutineFailure> {
    docker_client
        .run_rpk_cluster_info(&project_name, 10)
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
