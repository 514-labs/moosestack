use super::{
    validate::{
        validate_clickhouse_run, validate_redpanda_cluster, validate_redpanda_run,
        validate_temporal_run,
    },
    RoutineFailure, RoutineSuccess,
};
use crate::cli::display::{
    show_message_wrapper, with_spinner_completion, with_timing, Message, MessageType,
};
use crate::cli::routines::dev_tui::infra_status::{
    BootPhase, InfraStatusSender, InfraStatusUpdate, ServiceStatus,
};
use crate::cli::settings::Settings;
use crate::framework::languages::SupportedLanguages;
use crate::project::Project;
use crate::utilities::constants::{
    CLICKHOUSE_CONTAINER_NAME, CLI_PROJECT_INTERNAL_DIR, REDPANDA_CONTAINER_NAME, SHOW_TIMING,
    TEMPORAL_CONTAINER_NAME,
};
use crate::utilities::package_managers::{
    check_local_pnpm_version_warning, detect_pnpm_deploy_mode, find_pnpm_workspace_root,
    legacy_deploy_terminal_message, legacy_deploy_warning_message, PnpmDeployMode,
};
use crate::{cli::routines::util::ensure_docker_running, utilities::docker::DockerClient};
use lazy_static::lazy_static;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread::sleep;
use std::time::Duration;

pub fn run_local_infrastructure(
    project: &Project,
    settings: &Settings,
    docker_client: &DockerClient,
) -> anyhow::Result<()> {
    // Debug log to check load_infra value at runtime
    tracing::info!(
        "[moose] DEBUG: load_infra from config: {:?}, should_load_infra(): {}",
        project.load_infra,
        project.should_load_infra()
    );
    create_docker_compose_file(project, settings, docker_client)?.show();

    // Warn about pnpm deploy configuration for TypeScript projects in pnpm workspaces
    if project.language == SupportedLanguages::Typescript {
        // Check local pnpm version (informational only - doesn't affect Docker builds)
        if let Some(warning) = check_local_pnpm_version_warning() {
            tracing::info!("{}", warning);
        }

        if let Some(workspace_root) = find_pnpm_workspace_root(&project.project_location) {
            let deploy_mode = detect_pnpm_deploy_mode(&workspace_root);
            if let PnpmDeployMode::Legacy(reason) = deploy_mode {
                // Full message for logs
                let warning_msg = legacy_deploy_warning_message(&reason);
                tracing::warn!("{}", warning_msg);
                // Condensed message for terminal
                show_message_wrapper(
                    MessageType::Warning,
                    Message {
                        action: "Warning".to_string(),
                        details: legacy_deploy_terminal_message(&reason),
                    },
                );
            }
        }
    }

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

        // Show connection for primary database
        show_message_wrapper(
            MessageType::Info,
            Message {
                action: "ClickHouse Connection:".to_string(),
                details: project.clickhouse_config.display_url(),
            },
        );

        // Show connections for additional databases
        for db in &project.clickhouse_config.additional_databases {
            show_message_wrapper(
                MessageType::Info,
                Message {
                    action: "".to_string(),
                    details: project.clickhouse_config.display_url_for_database(db),
                },
            );
        }

        show_message_wrapper(
            MessageType::Info,
            Message {
                action: "".to_string(),
                details: "See moose.config.toml for complete connection details".to_string(),
            },
        );
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
    with_timing("Start Infra", || {
        with_spinner_completion(
            "Starting local infrastructure",
            "Local infrastructure started successfully",
            || docker_client.start_containers(project),
            !project.is_production && !SHOW_TIMING.load(Ordering::Relaxed),
        )
    })
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

/// Infrastructure boot error type for TUI mode
#[derive(Debug, thiserror::Error)]
pub enum InfraBootError {
    #[error("Docker is not running")]
    DockerNotRunning,
    #[error("Failed to create docker-compose file: {0}")]
    ComposeFileError(String),
    #[error("Failed to start containers: {0}")]
    ContainerStartError(String),
    #[error("Service validation failed for {service}: {message}")]
    ValidationError { service: String, message: String },
}

/// Run infrastructure startup with status updates sent to the TUI
///
/// This function performs the same operations as `run_local_infrastructure`
/// but sends progress updates through a channel for display in the TUI.
///
/// # Arguments
/// * `project` - The project configuration
/// * `settings` - Application settings
/// * `tx` - Channel sender for status updates
pub async fn run_infrastructure_with_updates(
    project: Arc<Project>,
    settings: Settings,
    tx: InfraStatusSender,
) -> Result<(), InfraBootError> {
    let docker_client = DockerClient::new(&settings);

    // Phase 1: Check Docker
    let _ = tx.send(InfraStatusUpdate::PhaseChanged(BootPhase::CheckingDocker));
    let _ = tx.send(InfraStatusUpdate::DockerStatus(ServiceStatus::Starting));

    if let Err(_e) = ensure_docker_running(&docker_client) {
        let _ = tx.send(InfraStatusUpdate::DockerStatus(ServiceStatus::Failed(
            "Docker daemon not running".to_string(),
        )));
        let _ = tx.send(InfraStatusUpdate::BootFailed(
            "Docker is not running".to_string(),
        ));
        return Err(InfraBootError::DockerNotRunning);
    }
    let _ = tx.send(InfraStatusUpdate::DockerStatus(ServiceStatus::Healthy));

    // Phase 2: Create compose file
    let _ = tx.send(InfraStatusUpdate::PhaseChanged(
        BootPhase::CreatingComposeFile,
    ));

    if let Err(e) = docker_client.create_compose_file(&project, &settings) {
        let error_msg = format!("{}", e);
        let _ = tx.send(InfraStatusUpdate::BootFailed(format!(
            "Failed to create compose file: {}",
            error_msg
        )));
        return Err(InfraBootError::ComposeFileError(error_msg));
    }

    // Check if we should skip container startup
    if !project.should_load_infra() {
        let _ = tx.send(InfraStatusUpdate::BootCompleted);
        return Ok(());
    }

    // Phase 3: Start containers
    let _ = tx.send(InfraStatusUpdate::PhaseChanged(
        BootPhase::StartingContainers,
    ));

    // Mark services as starting
    if project.features.olap {
        let _ = tx.send(InfraStatusUpdate::ClickHouseStatus(ServiceStatus::Starting));
    }
    if project.features.streaming_engine {
        let _ = tx.send(InfraStatusUpdate::RedpandaStatus(ServiceStatus::Starting));
    }
    if project.features.workflows || settings.features.scripts {
        let _ = tx.send(InfraStatusUpdate::TemporalStatus(ServiceStatus::Starting));
    }
    let _ = tx.send(InfraStatusUpdate::RedisStatus(ServiceStatus::Starting));

    if let Err(e) = docker_client.start_containers(&project) {
        let error_msg = format!("{}", e);
        let _ = tx.send(InfraStatusUpdate::BootFailed(format!(
            "Failed to start containers: {}",
            error_msg
        )));
        return Err(InfraBootError::ContainerStartError(error_msg));
    }

    // Phase 4: Validate services
    let _ = tx.send(InfraStatusUpdate::PhaseChanged(
        BootPhase::ValidatingServices,
    ));

    // Validate ClickHouse
    if project.features.olap {
        validate_service_with_updates(
            &project,
            &docker_client,
            CLICKHOUSE_CONTAINER_NAME,
            Some("healthy"),
            &tx,
            InfraStatusUpdate::ClickHouseStatus,
        )?;
    }

    // Validate Redpanda
    if project.features.streaming_engine {
        validate_service_with_updates(
            &project,
            &docker_client,
            REDPANDA_CONTAINER_NAME,
            None, // Redpanda doesn't have health check
            &tx,
            InfraStatusUpdate::RedpandaStatus,
        )?;

        // Also validate cluster
        if let Err(e) = docker_client.run_rpk_cluster_info(&project.name(), 10) {
            let _ = tx.send(InfraStatusUpdate::RedpandaStatus(ServiceStatus::Failed(
                format!("Cluster validation failed: {}", e),
            )));
            return Err(InfraBootError::ValidationError {
                service: "Redpanda".to_string(),
                message: format!("Cluster validation failed: {}", e),
            });
        }
    }

    // Validate Temporal
    if project.features.workflows || settings.features.scripts {
        validate_service_with_updates(
            &project,
            &docker_client,
            TEMPORAL_CONTAINER_NAME,
            Some("healthy"),
            &tx,
            InfraStatusUpdate::TemporalStatus,
        )?;
    }

    // Mark Redis as healthy (it doesn't have a separate container validation)
    let _ = tx.send(InfraStatusUpdate::RedisStatus(ServiceStatus::Healthy));

    // All done!
    let _ = tx.send(InfraStatusUpdate::PhaseChanged(BootPhase::Ready));
    let _ = tx.send(InfraStatusUpdate::BootCompleted);

    Ok(())
}

/// Validate a service container with status updates
fn validate_service_with_updates<F>(
    project: &Project,
    docker_client: &DockerClient,
    container_name: &str,
    expected_health: Option<&str>,
    tx: &InfraStatusSender,
    status_update: F,
) -> Result<(), InfraBootError>
where
    F: Fn(ServiceStatus) -> InfraStatusUpdate,
{
    let _full_container_name = format!("{}-{}-1", project.name().to_lowercase(), container_name);

    // Find the container
    let containers = docker_client.list_containers(project).map_err(|e| {
        let _ = tx.send(status_update(ServiceStatus::Failed(format!(
            "Failed to list containers: {}",
            e
        ))));
        InfraBootError::ValidationError {
            service: container_name.to_string(),
            message: format!("Failed to list containers: {}", e),
        }
    })?;

    let mut container = containers
        .into_iter()
        .find(|c| c.name.contains(container_name))
        .ok_or_else(|| {
            let _ = tx.send(status_update(ServiceStatus::Failed(
                "Container not found".to_string(),
            )));
            InfraBootError::ValidationError {
                service: container_name.to_string(),
                message: "Container not found".to_string(),
            }
        })?;

    // Wait for health check if required
    if let Some(expected) = expected_health {
        const MAX_ATTEMPTS: u8 = 30;

        for attempt in 1..=MAX_ATTEMPTS {
            let _ = tx.send(status_update(ServiceStatus::WaitingHealthy {
                attempt,
                max_attempts: MAX_ATTEMPTS,
            }));

            if let Some(ref effective_health) = container.health {
                if effective_health == expected {
                    break;
                }
            } else {
                // No health info available, skip health check
                break;
            }

            if attempt == MAX_ATTEMPTS {
                let _ = tx.send(status_update(ServiceStatus::Failed(
                    "Health check timeout".to_string(),
                )));
                return Err(InfraBootError::ValidationError {
                    service: container_name.to_string(),
                    message: "Health check timeout".to_string(),
                });
            }

            // Re-fetch container status
            sleep(Duration::from_secs(1));
            let containers = docker_client.list_containers(project).map_err(|e| {
                InfraBootError::ValidationError {
                    service: container_name.to_string(),
                    message: format!("Failed to list containers: {}", e),
                }
            })?;
            if let Some(c) = containers
                .into_iter()
                .find(|c| c.name.contains(container_name))
            {
                container = c;
            }
        }
    }

    let _ = tx.send(status_update(ServiceStatus::Healthy));
    Ok(())
}
