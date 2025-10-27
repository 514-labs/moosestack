#[macro_use]
pub(crate) mod display;

mod commands;
pub mod local_webserver;
pub mod logger;
pub mod processing_coordinator;
pub mod routines;
use crate::cli::routines::seed_data;
pub mod settings;
mod watcher;
use super::metrics::Metrics;
use crate::utilities::docker::DockerClient;
use clap::Parser;
use commands::{
    Commands, DbCommands, GenerateCommand, KafkaArgs, KafkaCommands, TemplateSubCommands,
    WorkflowCommands,
};
use config::ConfigError;
use display::with_spinner_completion;
use log::{debug, info, warn};
use regex::Regex;
use routines::auth::generate_hash_token;
use routines::build::build_package;
use routines::clean::clean_project;
use routines::docker_packager::{build_dockerfile, create_dockerfile};
use routines::kafka_pull::write_external_topics;
use routines::metrics_console::run_console;
use routines::peek::peek;
use routines::ps::show_processes;
use routines::scripts::{
    cancel_workflow, get_workflow_status, list_workflows_history, pause_workflow, run_workflow,
    terminate_workflow, unpause_workflow,
};
use routines::templates::list_available_templates;

use settings::Settings;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use crate::cli::routines::logs::{follow_logs, show_logs};
use crate::cli::routines::remote_refresh;
use crate::cli::routines::setup_redis_client;
use crate::cli::routines::{RoutineFailure, RoutineSuccess};
use crate::cli::settings::user_directory;
use crate::cli::{
    display::{Message, MessageType},
    routines::dev::run_local_infrastructure,
};
use crate::framework::core::check::check_system_reqs;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::framework::core::primitive_map::PrimitiveMap;
use crate::metrics::TelemetryMetadata;
use crate::project::Project;
use crate::utilities::capture::{wait_for_usage_capture, ActivityType};
use crate::utilities::constants::KEY_REMOTE_CLICKHOUSE_URL;
use crate::utilities::constants::{
    CLI_VERSION, ENV_CLICKHOUSE_URL, MIGRATION_AFTER_STATE_FILE, MIGRATION_BEFORE_STATE_FILE,
    MIGRATION_FILE, PROJECT_NAME_ALLOW_PATTERN,
};
use crate::utilities::keyring::{KeyringSecretRepository, SecretRepository};

use crate::cli::commands::DbArgs;
use crate::cli::routines::code_generation::{db_pull, db_to_dmv2, prompt_user_for_remote_ch_http};
use crate::cli::routines::ls::ls_dmv2;
use crate::cli::routines::templates::create_project_from_template;
use crate::framework::core::migration_plan::MIGRATION_SCHEMA;
use crate::framework::languages::SupportedLanguages;
use crate::utilities::clickhouse_url::convert_http_to_clickhouse;
use anyhow::Result;
use std::time::Duration;
use tokio::time::timeout;

/// Generic prompt function with hints, default values, and better formatting
pub fn prompt_user(
    prompt_text: &str,
    default: Option<&str>,
    hint: Option<&str>,
) -> Result<String, RoutineFailure> {
    use std::io::{self, Write};

    // Build the prompt with proper formatting
    let mut full_prompt = String::new();

    // Add the main prompt text
    full_prompt.push_str(prompt_text);

    // Add default value if provided
    if let Some(default_value) = default {
        full_prompt.push_str(&format!(" (default: {})", default_value));
    }

    // Add hint if provided
    if let Some(hint_text) = hint {
        full_prompt.push_str(&format!("\n  💡 Hint: {}", hint_text));
    }

    // Add the prompt indicator
    full_prompt.push_str("\n> ");

    print!("{}", full_prompt);
    let _ = io::stdout().flush();
    let mut input = String::new();
    io::stdin().read_line(&mut input).map_err(|e| {
        RoutineFailure::new(
            Message {
                action: "Init".to_string(),
                details: "Failed to prompt user".to_string(),
            },
            e,
        )
    })?;
    let trimmed = input.trim();

    // Return default if input is empty, otherwise return the trimmed input
    let result = if trimmed.is_empty() {
        default.unwrap_or("").to_string()
    } else {
        trimmed.to_string()
    };

    Ok(result)
}

#[derive(Parser)]
#[command(author, version, about, long_about = None, arg_required_else_help(true), next_display_order = None)]
pub struct Cli {
    /// Turn debugging information on
    #[arg(short, long)]
    debug: bool,

    /// Print backtraces for all errors (same as RUST_LIB_BACKTRACE=1)
    #[arg(
        long,
        global = true,
        help = "Print backtraces for all errors (same as RUST_LIB_BACKTRACE=1)"
    )]
    pub backtrace: bool,

    #[command(subcommand)]
    pub command: Commands,
}

fn load_project() -> Result<Project, RoutineFailure> {
    Project::load_from_current_dir().map_err(|e| match e {
        ConfigError::Foreign(_) => RoutineFailure::error(Message {
            action: "Loading".to_string(),
            details: "No project found, please run `moose init` to create a project".to_string(),
        }),
        _ => RoutineFailure::error(Message {
            action: "Loading".to_string(),
            details: format!("Please validate the project's configs: {e:?}"),
        }),
    })
}

fn check_project_name(name: &str) -> Result<(), RoutineFailure> {
    // Special case: Allow "." as a valid project name to indicate current directory
    if name == "." {
        return Ok(());
    }

    let project_name_regex = Regex::new(PROJECT_NAME_ALLOW_PATTERN).unwrap();
    if !project_name_regex.is_match(name) {
        return Err(RoutineFailure::error(Message {
            action: "Init".to_string(),
            details: format!(
                "Project name should match the following: {PROJECT_NAME_ALLOW_PATTERN}"
            ),
        }));
    }
    Ok(())
}

/// Resolves ClickHouse and Redis URLs from flags and environment variables, and validates Redis URL if needed
fn resolve_serverless_urls<'a>(
    project: &Project,
    clickhouse_url: Option<&'a str>,
    redis_url: Option<&'a str>,
) -> Result<(Option<String>, Option<String>), RoutineFailure> {
    use crate::utilities::constants::{ENV_CLICKHOUSE_URL, ENV_REDIS_URL};

    // Resolve ClickHouse URL from flag or env var
    let clickhouse_url_from_env = std::env::var(ENV_CLICKHOUSE_URL).ok();
    let resolved_clickhouse_url = clickhouse_url.map(String::from).or(clickhouse_url_from_env);

    // Resolve Redis URL from flag or env var
    let redis_url_from_env = std::env::var(ENV_REDIS_URL).ok();
    let resolved_redis_url = redis_url.map(String::from).or(redis_url_from_env);

    // Validate Redis URL is provided when using Redis for state storage
    if project.state_config.storage == "redis" && resolved_redis_url.is_none() {
        return Err(RoutineFailure::error(Message {
            action: "Configuration".to_string(),
            details: format!(
                "--redis-url required when state_config.storage = \"redis\" \
                 (or set {} environment variable)",
                ENV_REDIS_URL
            ),
        }));
    }

    Ok((resolved_clickhouse_url, resolved_redis_url))
}

/// Runs local infrastructure with a configurable timeout
async fn run_local_infrastructure_with_timeout(
    project: &Arc<Project>,
    settings: &Settings,
) -> anyhow::Result<()> {
    let timeout_duration = Duration::from_secs(settings.dev.infrastructure_timeout_seconds);

    // Wrap the synchronous function in a blocking task to make it work with timeout
    let run_future = tokio::task::spawn_blocking({
        let project = project.clone();
        let settings = settings.clone();
        move || {
            let docker_client = DockerClient::new(&settings);
            run_local_infrastructure(&project, &settings, &docker_client)
        }
    });

    match timeout(timeout_duration, run_future).await {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => Err(e.into()),
        Err(_) => {
            Err(anyhow::anyhow!(
                "Docker container startup and validation timed out after {} seconds.\n\n\
                This usually happens when Docker is in an unresponsive state.\n\n\
                Troubleshooting steps:\n\
                • Check if Docker is running: `docker info`\n\
                • Stop existing containers: `docker stop $(docker ps -aq)`\n\
                • Restart Docker Desktop (if using Desktop)\n\
                • On Linux, restart Docker daemon: `sudo systemctl restart docker`\n\
                • Check for port conflicts: `lsof -i :4000-4002`\n\
                • If the issue persists, you can increase the timeout in your Moose configuration:\n\
                  [dev]\n\
                  infrastructure_timeout_seconds = {}\n\n\
                For more help, visit: https://docs.moosejs.com/help/troubleshooting",
                timeout_duration.as_secs(),
                timeout_duration.as_secs() * 2
            ))
        }
    }
}

pub async fn top_command_handler(
    settings: Settings,
    commands: &Commands,
    machine_id: String,
) -> Result<RoutineSuccess, RoutineFailure> {
    match commands {
        Commands::Init {
            name,
            location,
            template,
            no_fail_already_exists,
            from_remote,
            language,
        } => {
            info!(
                "Running init command with name: {}, location: {:?}, template: {:?}, language: {:?}",
                name, location, template, language
            );

            // Determine template, prompting for language if needed (especially for --from-remote)
            let template = match template {
                Some(t) => t.to_lowercase(),
                None => match language.as_deref().map(|l| l.to_lowercase()).as_deref() {
                    Some("typescript") => "typescript-empty".to_string(),
                    Some("python") => "python-empty".to_string(),
                    Some(lang) => {
                        return Err(RoutineFailure::error(Message::new(
                            "Unknown".to_string(),
                            format!("language {lang}"),
                        )))
                    }
                    None => {
                        display::show_message_wrapper(
                            MessageType::Info,
                            Message::new(
                                "Init".to_string(),
                                "Setting up your new Moose project".to_string(),
                            ),
                        );
                        let input = prompt_user(
                            "Select language [1] TypeScript [2] Python",
                            Some("1"),
                            None,
                        )?
                        .to_lowercase();

                        match input.as_str() {
                            "2" | "Python" | "py" => "python-empty".to_string(),
                            _ => "typescript-empty".to_string(),
                        }
                    }
                },
            };

            let dir_path = Path::new(location.as_deref().unwrap_or(name));

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::InitTemplateCommand,
                Some(name.to_string()),
                &settings,
                machine_id.clone(),
                HashMap::from([("template".to_string(), template.to_string())]),
            );

            check_project_name(name)?;

            let post_install_message =
                create_project_from_template(&template, name, dir_path, *no_fail_already_exists)
                    .await?;

            let normalized_url = match from_remote {
                None => {
                    // No --from-remote flag provided
                    None
                }
                Some(None) => {
                    // --from-remote flag provided, but no URL given - use interactive prompts
                    let url = prompt_user_for_remote_ch_http()?;
                    db_to_dmv2(&url, dir_path).await?;
                    Some(url)
                }
                Some(Some(url_str)) => {
                    // --from-remote flag provided with URL - validate and use
                    match convert_http_to_clickhouse(url_str) {
                        Ok(_) => {
                            db_to_dmv2(url_str, dir_path).await?;
                            Some(url_str.to_string())
                        }
                        Err(e) => {
                            return Err(RoutineFailure::error(Message::new(
                                "Init from remote".to_string(),
                                format!(
                                    "Invalid ClickHouse URL. Use HTTPS protocol and correct port. Run `moose init {} --from-remote` without arguments for interactive setup.\nDetails: {}",
                                    name,
                                    e
                                ),
                            )));
                        }
                    }
                }
            };

            // Offer to store the connection string for future db pull convenience
            if let Some(ref connection_string) = normalized_url {
                let save_choice = prompt_user(
                    "\n  Would you like to save this connection string to your system keychain for easy `moose db pull` later? [Y/n]",
                    Some("Y"),
                    Some("You can always pass --connection-string explicitly to override."),
                )?;

                let save = save_choice.trim().is_empty()
                    || matches!(save_choice.trim().to_lowercase().as_str(), "y" | "yes");
                if save {
                    let repo = KeyringSecretRepository;
                    match repo.store(name, KEY_REMOTE_CLICKHOUSE_URL, connection_string) {
                        Ok(()) => display::show_message_wrapper(
                            MessageType::Success,
                            Message::new(
                                "Keychain".to_string(),
                                format!(
                                    "Saved ClickHouse connection string for project '{}'.",
                                    name
                                ),
                            ),
                        ),
                        Err(e) => warn!("Failed to store connection string: {e:?}"),
                    }
                }
            }

            wait_for_usage_capture(capture_handle).await;

            let success_message = if let Some(connection_string) = normalized_url {
                format!(
                    "\n\n{post_install_message}\n\n🔗 Your ClickHouse connection string:\n{}\n\n📋 After setting up your development environment, open a new terminal and seed your local database:\n      moose seed clickhouse --connection-string \"{}\" --limit 1000\n\n💡 Tip: Save the connection string as an environment variable for future use:\n   export MOOSE_REMOTE_CLICKHOUSE_URL=\"{}\"\n",
                    connection_string,
                    connection_string,
                    connection_string
                )
            } else {
                format!("\n\n{post_install_message}")
            };

            Ok(RoutineSuccess::highlight(Message::new(
                "Get Started".to_string(),
                success_message,
            )))
        }
        // This command is used to check the project for errors that are not related to runtime
        // For example, it checks that the project is valid and that all the primitives are loaded
        // It is used in the build process to ensure that the project is valid while building docker images
        Commands::Check { write_infra_map } => {
            info!(
                "Running check command with write_infra_map: {}",
                *write_infra_map
            );
            let project_arc = Arc::new(load_project()?);

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::CheckCommand,
                Some(project_arc.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            check_project_name(&project_arc.name())?;

            check_system_reqs(&project_arc.language_project_config)
                .await
                .map_err(|e| {
                    RoutineFailure::error(Message {
                        action: "System".to_string(),
                        details: format!("Failed to validate system requirements: {e:?}"),
                    })
                })?;

            let infra_map = if project_arc.features.data_model_v2 {
                debug!("Loading InfrastructureMap from user code (DMV2)");
                InfrastructureMap::load_from_user_code(&project_arc)
                    .await
                    .map_err(|e| {
                        RoutineFailure::error(Message {
                            action: "Build".to_string(),
                            details: format!("Failed to load InfrastructureMap: {e:?}"),
                        })
                    })?
            } else {
                debug!("Loading InfrastructureMap from primitives");
                let primitive_map = PrimitiveMap::load(&project_arc).await.map_err(|e| {
                    RoutineFailure::error(Message {
                        action: "Build".to_string(),
                        details: format!("Failed to load Primitives: {e:?}"),
                    })
                })?;

                InfrastructureMap::new(&project_arc, primitive_map)
            };

            if *write_infra_map {
                let json_path = project_arc
                    .internal_dir_with_routine_failure_err()?
                    .join("infrastructure_map.json");

                infra_map.save_to_json(&json_path).map_err(|e| {
                    RoutineFailure::new(
                        Message::new(
                            "Failed".to_string(),
                            "to save InfrastructureMap as JSON".to_string(),
                        ),
                        e,
                    )
                })?;
            }

            wait_for_usage_capture(capture_handle).await;

            Ok(RoutineSuccess::success(Message::new(
                "Checked".to_string(),
                "No Errors found".to_string(),
            )))
        }
        Commands::Build {
            docker,
            amd64,
            arm64,
        } => {
            info!("Running build command");
            let project_arc = Arc::new(load_project()?);

            check_project_name(&project_arc.name())?;

            // docker flag is true then build docker images
            if *docker {
                let capture_handle = crate::utilities::capture::capture_usage(
                    ActivityType::DockerCommand,
                    Some(project_arc.name()),
                    &settings,
                    machine_id.clone(),
                    HashMap::new(),
                );

                let docker_client = DockerClient::new(&settings);
                create_dockerfile(&project_arc, &docker_client)?.show();
                let _: RoutineSuccess =
                    build_dockerfile(&project_arc, &docker_client, *amd64, *arm64)?;

                wait_for_usage_capture(capture_handle).await;

                Ok(RoutineSuccess::success(Message::new(
                    "Built".to_string(),
                    "Docker image(s)".to_string(),
                )))
            } else {
                let capture_handle = crate::utilities::capture::capture_usage(
                    ActivityType::BuildCommand,
                    Some(project_arc.name()),
                    &settings,
                    machine_id.clone(),
                    HashMap::new(),
                );

                // Use the new build_package function instead of Docker build
                let package_path = with_spinner_completion(
                    "Bundling deployment package",
                    "Package bundled successfully",
                    || {
                        build_package(&project_arc).map_err(|e| {
                            RoutineFailure::error(Message {
                                action: "Build".to_string(),
                                details: format!("Failed to build package: {e:?}"),
                            })
                        })
                    },
                    !project_arc.is_production,
                )?;

                wait_for_usage_capture(capture_handle).await;

                Ok(RoutineSuccess::success(Message::new(
                    "Built".to_string(),
                    format!("Package available at {}", package_path.display()),
                )))
            }
        }
        Commands::Dev { no_infra, mcp } => {
            info!("Running dev command");
            info!("Moose Version: {}", CLI_VERSION);

            let mut project = load_project()?;
            project.set_is_production_env(false);
            let project_arc = Arc::new(project);

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::DevCommand,
                Some(project_arc.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            check_project_name(&project_arc.name())?;

            // Only run infrastructure if --no-infra flag is not set
            if !no_infra {
                run_local_infrastructure_with_timeout(&project_arc, &settings)
                    .await
                    .map_err(|e| {
                        RoutineFailure::error(Message {
                            action: "Dev".to_string(),
                            details: format!("Failed to run local infrastructure: {e:?}"),
                        })
                    })?;
            } else {
                info!("Skipping infrastructure startup due to --no-infra flag");
            }

            let redis_client = setup_redis_client(project_arc.clone()).await.map_err(|e| {
                RoutineFailure::error(Message {
                    action: "Dev".to_string(),
                    details: format!("Failed to setup redis client: {e:?}"),
                })
            })?;

            let (metrics, rx_events) = Metrics::new(
                TelemetryMetadata {
                    anonymous_telemetry_enabled: settings.telemetry.enabled,
                    machine_id: machine_id.clone(),
                    metric_labels: settings.metric.labels.clone(),
                    is_moose_developer: settings.telemetry.is_moose_developer,
                    is_production: project_arc.is_production,
                    project_name: project_arc.name().to_string(),
                    export_metrics: settings.telemetry.export_metrics,
                    metric_endpoints: settings.metric.endpoints.clone(),
                },
                if settings.features.metrics_v2 {
                    Some(redis_client.clone())
                } else {
                    None
                },
            );

            let arc_metrics = Arc::new(metrics);
            arc_metrics.start_listening_to_metrics(rx_events).await;

            routines::start_development_mode(
                project_arc,
                arc_metrics,
                redis_client,
                &settings,
                *mcp,
            )
            .await
            .map_err(|e| {
                RoutineFailure::error(Message {
                    action: "Dev".to_string(),
                    details: format!("Failed to start development mode: {e:?}"),
                })
            })?;

            wait_for_usage_capture(capture_handle).await;

            Ok(RoutineSuccess::success(Message::new(
                "Dev".to_string(),
                "Server shutdown".to_string(),
            )))
        }
        Commands::Generate(generate) => match &generate.command {
            Some(GenerateCommand::HashToken {}) => {
                info!("Running generate hash token command");
                let project = load_project()?;
                let project_arc = Arc::new(project);

                let capture_handle = crate::utilities::capture::capture_usage(
                    ActivityType::GenerateHashCommand,
                    Some(project_arc.name()),
                    &settings,
                    machine_id.clone(),
                    HashMap::new(),
                );

                check_project_name(&project_arc.name())?;
                generate_hash_token();

                wait_for_usage_capture(capture_handle).await;

                Ok(RoutineSuccess::success(Message::new(
                    "Token".to_string(),
                    "Success".to_string(),
                )))
            }
            Some(GenerateCommand::Migration {
                url,
                token,
                clickhouse_url,
                redis_url,
                save,
            }) => {
                info!("Running generate migration command");

                let mut project = load_project()?;

                let capture_handle = crate::utilities::capture::capture_usage(
                    ActivityType::GenerateMigrationCommand,
                    Some(project.name()),
                    &settings,
                    machine_id.clone(),
                    HashMap::new(),
                );

                check_project_name(&project.name())?;

                // Resolve URLs from flags or env vars
                let (resolved_clickhouse_url, resolved_redis_url) = resolve_serverless_urls(
                    &project,
                    clickhouse_url.as_deref(),
                    redis_url.as_deref(),
                )?;

                // Validate that at least one remote source is configured
                let remote = if let Some(ref ch_url) = resolved_clickhouse_url {
                    routines::RemoteSource::Serverless {
                        clickhouse_url: ch_url,
                        redis_url: &resolved_redis_url,
                    }
                } else if let Some(ref moose_url) = url {
                    routines::RemoteSource::Moose {
                        url: moose_url,
                        token,
                    }
                } else {
                    return Err(RoutineFailure::error(Message {
                        action: "Configuration".to_string(),
                        details: "Either --url or --clickhouse-url is required (or set environment variables)".to_string(),
                    }));
                };

                let result = routines::remote_gen_migration(&mut project, remote)
                    .await
                    .map_err(|e| {
                        RoutineFailure::new(
                            Message {
                                action: "Plan".to_string(),
                                details: "Failed to generate migration plan".to_string(),
                            },
                            e,
                        )
                    })?;

                let plan_yaml = result.db_migration.to_yaml().map_err(|e| {
                    RoutineFailure::new(
                        Message {
                            action: "Plan".to_string(),
                            details: "Failed to serialize".to_string(),
                        },
                        e,
                    )
                })?;

                wait_for_usage_capture(capture_handle).await;

                if *save {
                    std::fs::create_dir_all("./migrations").map_err(|e| {
                        RoutineFailure::new(
                            Message::new(
                                "Migration".to_string(),
                                "plan writing failed.".to_string(),
                            ),
                            e,
                        )
                    })?;

                    if let Err(e) = std::fs::write(
                        project
                            .internal_dir_with_routine_failure_err()?
                            .join("migration_schema.json"),
                        MIGRATION_SCHEMA,
                    ) {
                        warn!("Error writing migration schema file: {e:?}");
                    };
                    // Prepend YAML language server schema directive for better editor support
                    let plan_yaml_with_header = format!(
                        "# yaml-language-server: $schema=../.moose/migration_schema.json\n\n{}",
                        plan_yaml
                    );
                    std::fs::write(MIGRATION_FILE, plan_yaml_with_header.as_str()).map_err(
                        |e| {
                            RoutineFailure::new(
                                Message::new(
                                    "Migration".to_string(),
                                    "plan writing failed.".to_string(),
                                ),
                                e,
                            )
                        },
                    )?;
                    std::fs::write(
                        MIGRATION_BEFORE_STATE_FILE,
                        serde_json::to_string_pretty(&result.remote_state).map_err(|e| {
                            RoutineFailure::new(
                                Message::new(
                                    "Error".to_string(),
                                    "serializing remote state.".to_string(),
                                ),
                                e,
                            )
                        })?,
                    )
                    .map_err(|e| {
                        RoutineFailure::new(
                            Message::new(
                                "Migration".to_string(),
                                "plan writing failed.".to_string(),
                            ),
                            e,
                        )
                    })?;
                    std::fs::write(
                        MIGRATION_AFTER_STATE_FILE,
                        serde_json::to_string_pretty(&result.local_infra_map).map_err(|e| {
                            RoutineFailure::new(
                                Message::new(
                                    "Error".to_string(),
                                    "serializing local state.".to_string(),
                                ),
                                e,
                            )
                        })?,
                    )
                    .map_err(|e| {
                        RoutineFailure::new(
                            Message::new(
                                "Migration".to_string(),
                                "plan writing failed.".to_string(),
                            ),
                            e,
                        )
                    })?;
                } else {
                    println!("Changes: \n\n{}", plan_yaml);
                }

                Ok(RoutineSuccess::success(Message::new(
                    "Migration".to_string(),
                    "generated".to_string(),
                )))
            }
            None => Err(RoutineFailure::error(Message {
                action: "Generate".to_string(),
                details: "Please provide a subcommand".to_string(),
            })),
        },
        Commands::Prod {
            start_include_dependencies,
        } => {
            info!("Running prod command");
            info!("Moose Version: {}", CLI_VERSION);

            let mut project = load_project()?;

            project.set_is_production_env(true);
            let project_arc = Arc::new(project);

            check_project_name(&project_arc.name())?;

            // If start_include_dependencies is true, manage Docker containers like dev mode
            if *start_include_dependencies {
                let docker_client = DockerClient::new(&settings);
                run_local_infrastructure(&project_arc, &settings, &docker_client).map_err(|e| {
                    RoutineFailure::error(Message {
                        action: "Prod".to_string(),
                        details: format!("Failed to run local infrastructure: {e:?}"),
                    })
                })?;
            }

            let redis_client = setup_redis_client(project_arc.clone()).await.map_err(|e| {
                RoutineFailure::error(Message {
                    action: "Prod".to_string(),
                    details: format!("Failed to setup redis client: {e:?}"),
                })
            })?;

            let (metrics, rx_events) = Metrics::new(
                TelemetryMetadata {
                    anonymous_telemetry_enabled: settings.telemetry.enabled,
                    machine_id: machine_id.clone(),
                    metric_labels: settings.metric.labels.clone(),
                    is_moose_developer: settings.telemetry.is_moose_developer,
                    is_production: project_arc.is_production,
                    project_name: project_arc.name().to_string(),
                    export_metrics: settings.telemetry.export_metrics,
                    metric_endpoints: settings.metric.endpoints.clone(),
                },
                if settings.features.metrics_v2 {
                    Some(redis_client.clone())
                } else {
                    None
                },
            );

            let arc_metrics = Arc::new(metrics);
            arc_metrics.start_listening_to_metrics(rx_events).await;

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::ProdCommand,
                Some(project_arc.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            routines::start_production_mode(&settings, project_arc, arc_metrics, redis_client)
                .await
                .map_err(|e| {
                    RoutineFailure::error(Message {
                        action: "Prod".to_string(),
                        details: format!("Failed to start production mode: {e:?}"),
                    })
                })?;

            wait_for_usage_capture(capture_handle).await;

            Ok(RoutineSuccess::success(Message::new(
                "Ran".to_string(),
                "production infrastructure".to_string(),
            )))
        }
        Commands::Plan {
            url,
            token,
            clickhouse_url,
        } => {
            info!("Running plan command");
            let project = load_project()?;

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::PlanCommand,
                Some(project.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            check_project_name(&project.name())?;

            let result = routines::remote_plan(&project, url, token, clickhouse_url).await;

            result.map_err(|e| {
                RoutineFailure::error(Message {
                    action: "Plan".to_string(),
                    details: format!("Failed to plan changes: {e:?}"),
                })
            })?;

            wait_for_usage_capture(capture_handle).await;

            Ok(RoutineSuccess::success(Message::new(
                "Plan".to_string(),
                "Successfully planned changes to the infrastructure".to_string(),
            )))
        }
        Commands::Migrate {
            clickhouse_url,
            redis_url,
        } => {
            info!("Running migrate command");
            let mut project = load_project()?;

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::MigrateCommand,
                Some(project.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            check_project_name(&project.name())?;

            // Resolve URLs from flags or env vars
            let (resolved_clickhouse_url, resolved_redis_url) =
                resolve_serverless_urls(&project, clickhouse_url.as_deref(), redis_url.as_deref())?;

            let resolved_clickhouse_url = resolved_clickhouse_url.ok_or_else(|| {
                RoutineFailure::error(Message {
                    action: "Configuration".to_string(),
                    details: format!(
                        "--clickhouse-url required (or set {} environment variable)",
                        ENV_CLICKHOUSE_URL
                    ),
                })
            })?;

            routines::migrate::execute_migration(
                &mut project,
                &resolved_clickhouse_url,
                resolved_redis_url.as_deref(),
            )
            .await?;

            wait_for_usage_capture(capture_handle).await;

            Ok(RoutineSuccess::success(Message::new(
                "Migrate".to_string(),
                "Successfully executed migration plan".to_string(),
            )))
        }
        Commands::Clean {} => {
            let project = load_project()?;
            let project_arc = Arc::new(project);

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::CleanCommand,
                Some(project_arc.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            check_project_name(&project_arc.name())?;

            let docker_client = DockerClient::new(&settings);
            let _ = clean_project(&project_arc, &docker_client)?;

            wait_for_usage_capture(capture_handle).await;

            Ok(RoutineSuccess::success(Message::new(
                "Cleaned".to_string(),
                "Project".to_string(),
            )))
        }
        Commands::Logs { tail, filter } => {
            info!("Running logs command");

            let project = load_project()?;

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::LogsCommand,
                Some(project.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            check_project_name(&project.name())?;

            let log_file_path = chrono::Local::now()
                .format(&settings.logger.log_file_date_format)
                .to_string();

            let log_file_path = user_directory()
                .join(log_file_path)
                .to_str()
                .unwrap()
                .to_string();

            let filter_value = filter.clone().unwrap_or_else(|| "".to_string());

            let result = if *tail {
                follow_logs(log_file_path, filter_value)
            } else {
                show_logs(log_file_path, filter_value)
            };

            wait_for_usage_capture(capture_handle).await;

            result
        }
        Commands::Ps {} => {
            info!("Running ps command");

            let project = load_project()?;
            let project_arc = Arc::new(project);

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::PsCommand,
                Some(project_arc.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            let result = show_processes(project_arc);

            wait_for_usage_capture(capture_handle).await;

            result
        }
        Commands::Ls { _type, name, json } => {
            info!("Running ls command");

            let project = load_project()?;
            let project_arc = Arc::new(project);

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::LsCommand,
                Some(project_arc.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            let res = if project_arc.features.data_model_v2 {
                ls_dmv2(&project_arc, _type.as_deref(), name.as_deref(), *json).await
            } else {
                Err(RoutineFailure::error(Message {
                    action: "List".to_string(),
                    details: "Please upgrade to Moose Data Model v2".to_string(),
                }))
            };

            wait_for_usage_capture(capture_handle).await;

            res
        }
        Commands::Peek {
            name,
            limit,
            file,
            table: _,
            stream,
        } => {
            info!("Running peek command");

            let project = load_project()?;
            let project_arc = Arc::new(project);

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::PeekCommand,
                Some(project_arc.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            // Default to table if neither table nor stream is specified
            let is_stream = if *stream {
                true
            } else {
                // Default to table (false) when neither flag is specified or table is explicitly specified
                false
            };

            let result = peek(project_arc, name, *limit, file.clone(), is_stream).await;

            wait_for_usage_capture(capture_handle).await;

            result
        }
        Commands::Metrics {} => {
            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::MetricsCommand,
                None,
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            let result = run_console().await;

            wait_for_usage_capture(capture_handle).await;

            result
        }
        Commands::Workflow(workflow_args) => {
            let project = load_project()?;

            if !(settings.features.scripts || project.features.workflows) {
                return Err(RoutineFailure::error(Message {
                    action: "Workflow".to_string(),
                    details: "Feature not enabled, to turn on go to moose.config.toml and set 'workflows' to true under the 'features' section".to_string(),
                }));
            }

            let activity_type = match &workflow_args.command {
                Some(WorkflowCommands::Run { .. }) => ActivityType::WorkflowRunCommand,
                Some(WorkflowCommands::List { .. }) => ActivityType::WorkflowListCommand,
                Some(WorkflowCommands::History { .. }) => ActivityType::WorkflowListCommand,
                Some(WorkflowCommands::Resume { .. }) => ActivityType::WorkflowResumeCommand,
                Some(WorkflowCommands::Terminate { .. }) => ActivityType::WorkflowTerminateCommand,
                Some(WorkflowCommands::Cancel { .. }) => ActivityType::WorkflowTerminateCommand,
                Some(WorkflowCommands::Pause { .. }) => ActivityType::WorkflowPauseCommand,
                Some(WorkflowCommands::Unpause { .. }) => ActivityType::WorkflowUnpauseCommand,
                Some(WorkflowCommands::Status { .. }) => ActivityType::WorkflowStatusCommand,
                None => ActivityType::WorkflowCommand,
            };

            let capture_handle = crate::utilities::capture::capture_usage(
                activity_type,
                Some(project.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            let result = match &workflow_args.command {
                Some(WorkflowCommands::Run { name, input }) => {
                    run_workflow(&project, name, input.clone()).await
                }
                Some(WorkflowCommands::List { json }) => {
                    ls_dmv2(&project, Some("workflows"), None, *json).await
                }
                Some(WorkflowCommands::History {
                    status,
                    limit,
                    json,
                }) => list_workflows_history(&project, status.clone(), *limit, *json).await,
                Some(WorkflowCommands::Resume { .. }) => Err(RoutineFailure::error(Message {
                    action: "Workflow Resume".to_string(),
                    details: "Not implemented yet".to_string(),
                })),
                Some(WorkflowCommands::Terminate { name }) => {
                    terminate_workflow(&project, name).await
                }
                Some(WorkflowCommands::Cancel { name }) => cancel_workflow(&project, name).await,
                Some(WorkflowCommands::Pause { name }) => pause_workflow(&project, name).await,
                Some(WorkflowCommands::Unpause { name }) => unpause_workflow(&project, name).await,
                Some(WorkflowCommands::Status {
                    name,
                    id,
                    verbose,
                    json,
                }) => get_workflow_status(&project, name, id.clone(), *verbose, *json).await,
                None => Err(RoutineFailure::error(Message {
                    action: "Workflow".to_string(),
                    details: "No subcommand provided".to_string(),
                })),
            };

            wait_for_usage_capture(capture_handle).await;

            result
        }
        Commands::Template(template_args) => {
            info!("Running template command");

            let template_cmd = template_args.command.as_ref().unwrap();
            match template_cmd {
                TemplateSubCommands::List {} => {
                    let capture_handle = crate::utilities::capture::capture_usage(
                        ActivityType::TemplateListCommand,
                        None,
                        &settings,
                        machine_id.clone(),
                        HashMap::new(),
                    );

                    let result = list_available_templates(CLI_VERSION).await;

                    wait_for_usage_capture(capture_handle).await;

                    result
                }
            }
        }
        Commands::Db(DbArgs {
            command:
                DbCommands::Pull {
                    connection_string,
                    file_path,
                },
        }) => {
            info!("Running db pull command");
            let project = load_project()?;

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::DbPullCommand,
                Some(project.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );
            let resolved_connection_string: String = match connection_string {
                Some(s) => s.clone(),
                None => {
                    let repo = KeyringSecretRepository;
                    match repo.get(&project.name(), KEY_REMOTE_CLICKHOUSE_URL) {
                        Ok(Some(s)) => s,
                        Ok(None) => return Err(RoutineFailure::error(Message {
                            action: "DB Pull".to_string(),
                            details: "No connection string provided and none saved. Pass --connection-string or save one during `moose init --from-remote`.".to_string(),
                        })),
                        Err(e) => {
                            return Err(RoutineFailure::error(Message {
                                action: "DB Pull".to_string(),
                                details: format!(
                                    "Failed to read saved connection string from keychain: {e:?}"
                                ),
                            }));
                        }
                    }
                }
            };

            db_pull(&resolved_connection_string, &project, file_path.as_deref())
                .await
                .map_err(|e| {
                    RoutineFailure::new(
                        Message::new("DB Pull".to_string(), "failed".to_string()),
                        e,
                    )
                })?;

            wait_for_usage_capture(capture_handle).await;
            Ok(RoutineSuccess::success(Message::new(
                "DB Pull".to_string(),
                "External models refreshed".to_string(),
            )))
        }
        Commands::Refresh { url, token } => {
            info!("Running refresh command");

            let project = load_project()?;

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::RefreshListCommand,
                Some(project.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            let output = remote_refresh(&project, url, token).await.map_err(|e| {
                RoutineFailure::new(Message::new("failed".to_string(), "".to_string()), e)
            });

            wait_for_usage_capture(capture_handle).await;

            output
        }
        Commands::Seed(seed_args) => {
            let project = load_project()?;
            seed_data::handle_seed_command(seed_args, &project).await
        }
        Commands::Truncate { tables, all, rows } => {
            let project = load_project()?;
            routines::truncate_table::truncate_tables(&project, tables.clone(), *all, *rows).await
        }
        Commands::Kafka(KafkaArgs { command }) => match command {
            KafkaCommands::Pull {
                bootstrap,
                path,
                include,
                exclude,
                schema_registry,
            } => {
                let project = load_project()?;
                let path = path.as_deref().unwrap_or(match project.language {
                    SupportedLanguages::Typescript => "app/external-topics",
                    SupportedLanguages::Python => "app/external_topics",
                });
                write_external_topics(&project, bootstrap, path, include, exclude, schema_registry)
                    .await?;
                Ok(RoutineSuccess::success(Message::new(
                    "Kafka".to_string(),
                    "external topics written".to_string(),
                )))
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use crate::{cli::settings::read_settings, utilities::machine_id::get_or_create_machine_id};

    use super::*;

    fn set_test_temp_dir() {
        let test_dir = "tests/tmp";
        // check that the directory isn't already set to test_dir
        let current_dir = std::env::current_dir().unwrap();
        if current_dir.ends_with(test_dir) {
            return;
        }
        std::env::set_current_dir(test_dir).unwrap();
    }

    fn get_test_project_dir() -> std::path::PathBuf {
        set_test_temp_dir();
        let current_dir = std::env::current_dir().unwrap();
        current_dir.join("test_project")
    }

    fn set_test_project_dir() {
        let test_project_dir = get_test_project_dir();
        std::env::set_current_dir(test_project_dir).unwrap();
    }

    async fn run_project_init(project_type: &str) -> Result<RoutineSuccess, RoutineFailure> {
        let cli = Cli::parse_from([
            "moose",
            "init",
            "test_project",
            project_type,
            "--no-fail-already-exists",
        ]);

        let config = read_settings().unwrap();
        let machine_id = get_or_create_machine_id();

        top_command_handler(config, &cli.command, machine_id).await
    }

    #[tokio::test]
    #[ignore] // Ignoring this test until we have a better way of creating temp directories
    async fn cli_python_init() {
        let og_directory = std::env::current_dir().unwrap();
        // Set current working directory to the tmp test directory
        set_test_temp_dir();
        let result = run_project_init("python").await;
        std::env::set_current_dir(og_directory).unwrap();
        assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore] // Ignoring this test until we have a better way of creating temp directories
    async fn test_project_has_py_data_model() {
        let og_directory = std::env::current_dir().unwrap();

        set_test_temp_dir();
        let _ = run_project_init("python").await.unwrap();
        set_test_project_dir();

        let project = Project::load_from_current_dir().unwrap();

        let data_model_path = project.app_dir().join("datamodels");

        // Make sure all the data models are .py files
        let data_model_files = std::fs::read_dir(data_model_path).unwrap();

        std::env::set_current_dir(og_directory).unwrap();
        for file in data_model_files {
            let file = file.unwrap();
            let file_name = file.file_name();
            let file_name = file_name.to_str().unwrap();
            assert!(file_name.ends_with(".py"));
        }
    }

    #[tokio::test]
    async fn test_list_templates() {
        let cli = Cli::parse_from(["moose", "template", "list"]);

        let config = read_settings().unwrap();
        let machine_id = get_or_create_machine_id();

        let result = top_command_handler(config, &cli.command, machine_id).await;

        assert!(result.is_ok());
        let success_message = result.unwrap().message.details;

        // Basic check to see if the output contains expected template info structure
        assert!(success_message.contains("Available templates for version"));
        assert!(success_message.contains("- typescript (typescript)"));
        assert!(success_message.contains("- python (python)"));
    }
}
