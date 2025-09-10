#[macro_use]
pub(crate) mod display;

mod commands;
pub mod local_webserver;
pub mod logger;
pub mod routines;
use crate::cli::routines::seed_data;
pub mod settings;
mod watcher;
use super::metrics::Metrics;
use crate::utilities::docker::DockerClient;
use clap::Parser;
use commands::{Commands, DbCommands, GenerateCommand, TemplateSubCommands, WorkflowCommands};
use config::ConfigError;
use display::with_spinner_completion;
use log::{debug, info, warn};
use regex::Regex;
use routines::auth::generate_hash_token;
use routines::build::build_package;
use routines::clean::clean_project;
use routines::docker_packager::{build_dockerfile, create_dockerfile};
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
use crate::utilities::constants::{
    CLI_VERSION, MIGRATION_AFTER_STATE_FILE, MIGRATION_BEFORE_STATE_FILE, MIGRATION_FILE,
    PROJECT_NAME_ALLOW_PATTERN,
};

use crate::cli::commands::DbArgs;
use crate::cli::routines::code_generation::{db_pull, db_to_dmv2};
use crate::cli::routines::ls::ls_dmv2;
use crate::cli::routines::templates::create_project_from_template;
use crate::framework::core::migration_plan::MIGRATION_SCHEMA;
use crate::utilities::clickhouse_url::convert_http_to_clickhouse;
use anyhow::Result;
use std::time::Duration;
use tokio::time::timeout;

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
            // database,
        } => {
            info!(
                "Running init command with name: {}, location: {:?}, template: {:?}, language: {:?}",
                name, location, template, language
            );

            // Determine template, prompting for language if needed (especially for --from-remote)
            let template = match template {
                Some(t) => t.to_lowercase(),
                None => {
                    let lang_lower = match language.as_ref().map(|l| l.to_lowercase()) {
                        Some(l) => l,
                        None => {
                            // Interactive prompt for language selection
                            use std::io::{self, Write};
                            display::show_message_wrapper(
                                MessageType::Info,
                                Message::new(
                                    "Init".to_string(),
                                    "Select language: [1] TypeScript  [2] Python (default: 1)"
                                        .to_string(),
                                ),
                            );
                            print!("Enter choice (1/2): ");
                            let _ = io::stdout().flush();
                            let mut input = String::new();
                            io::stdin().read_line(&mut input).unwrap_or(0);
                            match input.trim() {
                                "2" | "python" | "Python" => "python".to_string(),
                                _ => "typescript".to_string(),
                            }
                        }
                    };

                    match lang_lower.as_str() {
                        "typescript" => "typescript-empty".to_string(),
                        "python" => "python-empty".to_string(),
                        other => {
                            return Err(RoutineFailure::error(Message::new(
                                "Init".to_string(),
                                format!("Unknown language '{other}'. Choose typescript or python."),
                            )));
                        }
                    }
                }
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

            let normalized_url = if let Some(remote_val) = from_remote {
                // If empty or invalid, optionally prompt; otherwise validate and proceed
                let url = if remote_val.as_deref().unwrap_or("").trim().is_empty() {
                    use std::io::{self, Write};
                    print!("Enter HTTPS host and port (e.g. https://your-service-id.region.clickhouse.cloud:8443)\n  ❓ Help: https://docs.fiveonefour.com/moose/getting-started/from-clickhouse#connect-to-your-remote-clickhouse\n  ☁️ ClickHouse Cloud Console: https://clickhouse.cloud/\n> ");
                    let _ = io::stdout().flush();
                    let mut base = String::new();
                    io::stdin().read_line(&mut base).unwrap_or(0);
                    let base = base.trim().trim_end_matches('/');

                    print!("Enter username: ");
                    let _ = io::stdout().flush();
                    let mut user = String::new();
                    io::stdin().read_line(&mut user).unwrap_or(0);
                    let user = user.trim();

                    print!("Enter password: ");
                    let _ = io::stdout().flush();
                    let mut pass = String::new();
                    io::stdin().read_line(&mut pass).unwrap_or(0);
                    let pass = pass.trim();

                    print!("Enter database name (optional): ");
                    let _ = io::stdout().flush();
                    let mut db = String::new();
                    io::stdin().read_line(&mut db).unwrap_or(0);
                    let db = db.trim();

                    let mut out = format!(
                        "https://{}:{}@{}",
                        user,
                        pass,
                        base.trim_start_matches("https://")
                    );
                    if !db.is_empty() {
                        let sep = if out.contains('?') { '&' } else { '?' };
                        out.push_str(&format!("{}database={}", sep, db));
                    }
                    out
                } else {
                    let url_str = remote_val.as_deref().unwrap();
                    match convert_http_to_clickhouse(url_str) {
                        Ok(_) => url_str.to_string(),
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
                };

                db_to_dmv2(&url, dir_path).await?;
                Some(url)
            } else {
                None
            };

            wait_for_usage_capture(capture_handle).await;

            let success_message = if let Some(connection_string) = normalized_url {
                format!(
                    "\n\n{post_install_message}\n\n🔗 Your ClickHouse connection string:\n{}\n\n📋 After setting up your development environment, open a new terminal and seed your local database:\n      moose seed clickhouse \"{}\" --limit 1000\n\n💡 Tip: Save the connection string as an environment variable for future use:\n   export MOOSE_SEED_CLICKHOUSE_URL=\"{}\"\n",
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
        Commands::Dev {} => {
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
            run_local_infrastructure_with_timeout(&project_arc, &settings)
                .await
                .map_err(|e| {
                    RoutineFailure::error(Message {
                        action: "Dev".to_string(),
                        details: format!("Failed to run local infrastructure: {e:?}"),
                    })
                })?;

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

            routines::start_development_mode(project_arc, arc_metrics, redis_client, &settings)
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
            Some(GenerateCommand::Migration { url, token, save }) => {
                info!("Running generate migration command");

                let project = load_project()?;

                let capture_handle = crate::utilities::capture::capture_usage(
                    ActivityType::GenerateMigrationCommand,
                    Some(project.name()),
                    &settings,
                    machine_id.clone(),
                    HashMap::new(),
                );

                check_project_name(&project.name())?;

                let result = routines::remote_gen_migration(&project, url, token)
                    .await
                    .map_err(|e| {
                        RoutineFailure::new(
                            Message {
                                action: "Plan".to_string(),
                                details: "Failed to plan changes".to_string(),
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
        Commands::Plan { url, token } => {
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

            let result = routines::remote_plan(&project, url, token).await;

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
            db_pull(connection_string, &project, file_path.as_deref())
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
