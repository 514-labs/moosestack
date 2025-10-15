use super::{
    validate::{
        validate_clickhouse_run, validate_redpanda_cluster, validate_redpanda_run,
        validate_temporal_run,
    },
    RoutineFailure, RoutineSuccess,
};
use crate::cli::{display::with_spinner_completion, settings::Settings};
use crate::utilities::constants::CLI_PROJECT_INTERNAL_DIR;
use crate::{cli::display::Message, project::Project};
use crate::{cli::routines::util::ensure_docker_running, utilities::docker::DockerClient};
use lazy_static::lazy_static;

pub fn run_local_infrastructure(
    project: &Project,
    settings: &Settings,
    docker_client: &DockerClient,
) -> anyhow::Result<()> {
    // Debug log to check load_infra value at runtime
    log::info!(
        "[moose] DEBUG: load_infra from config: {:?}, should_load_infra(): {}",
        project.load_infra,
        project.should_load_infra()
    );
    create_docker_compose_file(project, settings, docker_client)?.show();

    // Inform user if override file is present
    let override_file = project
        .project_location
        .join("docker-compose.dev.override.yaml");
    if override_file.exists() {
        println!("[moose] Using docker-compose.dev.override.yaml for custom infrastructure");
    }

    // Check the load_infra flag before starting containers
    // If load_infra is false, skip infra loading for this instance
    if !project.should_load_infra() {
        println!("[moose] Skipping infra container startup: load_infra is set to false in moose.config.toml");
        return Ok(());
    }

    ensure_docker_running(docker_client)?;
    run_containers(project, docker_client)?;

    if project.features.olap {
        validate_clickhouse_run(project, docker_client)?.show();
    }
    if project.features.streaming_engine {
        validate_redpanda_run(project, docker_client)?.show();
        validate_redpanda_cluster(project.name(), docker_client)?.show();
    }
    if settings.features.scripts || project.features.workflows {
        validate_temporal_run(project, docker_client)?.show();
    }

    Ok(())
}

lazy_static! {
    static ref FAILED_TO_CREATE_INTERNAL_DIR: Message = Message::new(
        "Failed".to_string(),
        format!("to create {CLI_PROJECT_INTERNAL_DIR} directory. Check permissions or contact us`"),
    );
}

pub fn run_containers(project: &Project, docker_client: &DockerClient) -> anyhow::Result<()> {
    with_spinner_completion(
        "Starting local infrastructure",
        "Local infrastructure started successfully",
        || docker_client.start_containers(project),
        !project.is_production,
    )
}

pub fn create_docker_compose_file(
    project: &Project,
    settings: &Settings,
    docker_client: &DockerClient,
) -> Result<RoutineSuccess, RoutineFailure> {
    let output = docker_client.create_compose_file(project, settings);

    match output {
        Ok(_) => Ok(RoutineSuccess::success(Message::new(
            "Created".to_string(),
            "docker compose file".to_string(),
        ))),
        Err(err) => Err(RoutineFailure::new(
            Message::new(
                "Failed".to_string(),
                "to create docker compose file".to_string(),
            ),
            err,
        )),
    }
}
