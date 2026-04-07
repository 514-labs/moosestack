use super::RoutineFailure;
use crate::cli::display::{show_message_wrapper, Message, MessageType};
use crate::cli::settings::Settings;
use crate::framework::languages::SupportedLanguages;
use crate::project::Project;
use crate::utilities::infra_provider::InfraProvider;
use crate::utilities::package_managers::{
    check_local_pnpm_version_warning, detect_pnpm_deploy_mode, find_pnpm_workspace_root,
    legacy_deploy_terminal_message, legacy_deploy_warning_message, PnpmDeployMode,
};

pub fn run_local_infrastructure(
    project: &Project,
    settings: &Settings,
    provider: &dyn InfraProvider,
) -> Result<(), RoutineFailure> {
    // Debug log to check load_infra value at runtime
    tracing::info!(
        "[moose] DEBUG: load_infra from config: {:?}, should_load_infra(): {}",
        project.load_infra,
        project.should_load_infra()
    );

    provider.setup(project, settings)?;

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

    provider.start(project)?;

    if project.features.olap {
        provider.validate_clickhouse(project)?.show();

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
        provider.validate_redpanda(project)?.show();
        provider.validate_redpanda_cluster(&project.name())?.show();
    }
    if settings.features.scripts || project.features.workflows {
        provider.validate_temporal(project)?.show();
    }

    Ok(())
}
