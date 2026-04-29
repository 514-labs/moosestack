#[macro_use]
pub(crate) mod display;

mod commands;
pub mod local_webserver;
pub mod logger;
pub(crate) mod plan_pass;
pub mod processing_coordinator;
pub mod routines;
use crate::cli::routines::seed_data;
pub mod settings;
/// TypeScript compilation watcher: runs `moose-tspc --watch`, parses compile events,
/// and triggers infrastructure planning/execution on successful incremental builds.
/// Used in dev mode for TypeScript projects; see `TsCompilationWatcher` and
/// `spawn_and_await_initial_compile`.
pub mod ts_compilation_watcher;
pub mod watcher;
use super::metrics::Metrics;
use crate::utilities::constants;
use crate::utilities::docker::DockerClient;
use crate::utilities::docker_provider::DockerInfraProvider;
use crate::utilities::infra_provider::InfraProvider;
use clap::Parser;
use commands::{
    Commands, ComponentSubCommands, DbCommands, DocsCommands, GenerateCommand, HarnessSubCommands,
    KafkaArgs, KafkaCommands, TemplateSubCommands, WorkflowCommands,
};
use config::ConfigError;
use display::with_spinner_completion;
use regex::Regex;
use rmcp::ServiceExt;
use routines::auth::{display_hash_token_result, generate_hash_token};
use routines::build::build_package;
use routines::clean::clean_project;
use routines::docker_packager::{build_dockerfile, create_dockerfile};
use routines::harness::run_harness_init;
use routines::kafka_pull::write_external_topics;
use routines::metrics_console::run_console;
use routines::peek::peek;
use routines::project_init::{initialize_project, ProjectInitOptions, RemoteBootstrapSource};
use routines::ps::show_processes;
use routines::query::query;
use routines::scripts::{
    cancel_workflow, get_workflow_status, list_workflows_history, pause_workflow, run_workflow,
    terminate_workflow, unpause_workflow,
};
use routines::templates::{list_available_templates, prompt_for_template_name};
use tracing::{debug, info};

use settings::Settings;
use std::collections::HashMap;
use std::io::stdout;
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
use crate::infrastructure::olap::clickhouse::config::parse_clickhouse_connection_string;
use crate::metrics::TelemetryMetadata;
use crate::project::Project;
use crate::utilities::capture::{wait_for_usage_capture, ActivityType};
use crate::utilities::constants::{
    CLI_VERSION, ENV_CLICKHOUSE_URL, KEY_REMOTE_CLICKHOUSE_URL, PROJECT_NAME_ALLOW_PATTERN,
};
use crate::utilities::keyring::{KeyringSecretRepository, SecretRepository};

use crate::cli::commands::{AddComponent, DbArgs};
use crate::cli::routines::code_generation::{db_pull, db_pull_from_remote};
use crate::cli::routines::ls::ls;
use crate::framework::core::migration_plan::{MigrationPlan, MigrationPlanWithBeforeAfter};
use crate::framework::core::plan_risk::{
    classify_risk_from_deltas, migration_destructive_gate, print_migration_rejected_guidance,
    ConfirmationPolicy, MigrationGateOutcome,
};
use crate::framework::core::prompt_bridge::PromptBridge;
use crate::framework::core::version_bump;
use crate::framework::languages::SupportedLanguages;
use crate::infrastructure::olap::clickhouse::config_resolver::resolve_remote_clickhouse;
use crate::utilities::constants::{QUIET_STDOUT, SHOW_TIMESTAMPS, SHOW_TIMING};
use anyhow::Result;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::time::timeout;

/// Reads a boolean from an environment variable (`"1"` or `"true"`, case-insensitive).
fn env_bool(name: &str) -> bool {
    std::env::var(name)
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Generic prompt function with hints, default values, and better formatting
pub fn prompt_user(
    prompt_text: &str,
    default: Option<&str>,
    hint: Option<&str>,
) -> Result<String, RoutineFailure> {
    use std::io::{self, Write};

    print!("{}", format_prompt(prompt_text, default, hint));
    let _ = stdout().flush();
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
    Ok(apply_default(input.trim(), default))
}

/// Async version of [`prompt_user`] that doesn't block the tokio runtime.
pub async fn prompt_user_async(
    prompt_text: &str,
    default: Option<&str>,
    hint: Option<&str>,
) -> Result<String, RoutineFailure> {
    use std::io::Write;
    use tokio::io::AsyncBufReadExt;

    print!("{}", format_prompt(prompt_text, default, hint));
    let _ = stdout().flush();

    let stdin = tokio::io::BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();
    let line = lines.next_line().await.map_err(|e| {
        RoutineFailure::new(
            Message {
                action: "Prompt".to_string(),
                details: "Failed to read user input".to_string(),
            },
            e,
        )
    })?;
    let trimmed = line.as_deref().unwrap_or("").trim();
    Ok(apply_default(trimmed, default))
}

fn format_prompt(prompt_text: &str, default: Option<&str>, hint: Option<&str>) -> String {
    let mut full_prompt = String::new();
    full_prompt.push_str(prompt_text);
    if let Some(default_value) = default {
        full_prompt.push_str(&format!(" (default: {})", default_value));
    }
    if let Some(hint_text) = hint {
        full_prompt.push_str(&format!("\n  💡 Hint: {}", hint_text));
    }
    full_prompt.push_str("\n> ");
    full_prompt
}

fn apply_default(trimmed: &str, default: Option<&str>) -> String {
    if trimmed.is_empty() {
        default.unwrap_or("").to_string()
    } else {
        trimmed.to_string()
    }
}

/// Prompts user for password input with masked characters (shows * instead of typed chars)
///
/// Uses crossterm for terminal manipulation to hide the actual password input.
pub fn prompt_password(prompt_text: &str) -> Result<String, RoutineFailure> {
    use crossterm::{
        event::{read, Event, KeyCode, KeyModifiers},
        terminal::{disable_raw_mode, enable_raw_mode},
    };
    use std::io::Write;

    // Print the prompt
    print!("{}\n> ", prompt_text);
    let _ = stdout().flush();

    // Enable raw mode to capture individual key presses
    enable_raw_mode().map_err(|e| {
        RoutineFailure::new(
            Message {
                action: "Password".to_string(),
                details: "Failed to enable terminal raw mode".to_string(),
            },
            e,
        )
    })?;

    let mut password = String::new();

    loop {
        match read() {
            Ok(Event::Key(key_event)) => {
                // Handle Ctrl+C to cancel
                if key_event.modifiers.contains(KeyModifiers::CONTROL)
                    && key_event.code == KeyCode::Char('c')
                {
                    let _ = disable_raw_mode();
                    println!();
                    return Err(RoutineFailure::error(Message {
                        action: "Password".to_string(),
                        details: "Input cancelled by user".to_string(),
                    }));
                }

                // Ignore control key combinations (Ctrl+V, Ctrl+A, etc.) to prevent
                // accidental character input. However, allow:
                // - ALT alone: macOS Option key for special characters
                // - CTRL+ALT: Windows AltGr for international keyboard characters
                if key_event.modifiers.contains(KeyModifiers::CONTROL)
                    && !key_event.modifiers.contains(KeyModifiers::ALT)
                {
                    continue;
                }

                match key_event.code {
                    KeyCode::Enter => {
                        let _ = disable_raw_mode();
                        println!(); // Move to next line after password entry
                        return Ok(password);
                    }
                    KeyCode::Backspace if !password.is_empty() => {
                        password.pop();
                        // Erase the last asterisk: move back, print space, move back again
                        print!("\x08 \x08");
                        let _ = stdout().flush();
                    }
                    KeyCode::Char(c) => {
                        password.push(c);
                        print!("*"); // Show asterisk instead of actual character
                        let _ = stdout().flush();
                    }
                    _ => {} // Ignore other keys
                }
            }
            Ok(_) => {} // Ignore non-key events
            Err(e) => {
                let _ = disable_raw_mode();
                return Err(RoutineFailure::new(
                    Message {
                        action: "Password".to_string(),
                        details: "Failed to read input".to_string(),
                    },
                    e,
                ));
            }
        }
    }
}

#[derive(Parser)]
#[command(
    author,
    version = constants::CLI_VERSION,
    about = "MooseStack is a type-safe code-first developer framework for building real-time analytical backends.",
    long_about = None,
    arg_required_else_help(true),
    next_display_order = None,
    after_help = "\x1b[1;4mLEARN MORE\x1b[0m
  Documentation:         https://docs.fiveonefour.com/moosestack
  Implementation guides: https://docs.fiveonefour.com/guides

\x1b[1;4mFEEDBACK\x1b[0m
  Send feedback:  moose feedback
  Join Slack:     moose feedback --community
  Email:          hello@fiveonefour.com

\x1b[1;4mHOSTING\x1b[0m
  Try Fiveonefour's hosting platform built for MooseStack apps.
  Sign up for a free trial: https://fiveonefour.boreal.cloud/sign-up"
)]
pub struct Cli {
    /// Turn debugging information on
    #[arg(short, long)]
    debug: bool,

    /// Print backtraces for all errors (same as RUST_LIB_BACKTRACE=1)
    #[arg(long, global = true)]
    pub backtrace: bool,

    #[command(subcommand)]
    pub command: Commands,
}

/// Determines the runtime environment from the CLI command
fn determine_environment(command: &Commands) -> crate::utilities::dotenv::MooseEnvironment {
    use crate::utilities::dotenv::MooseEnvironment;

    match command {
        // Production commands
        Commands::Prod { .. } => MooseEnvironment::Production,
        Commands::Build { .. } => MooseEnvironment::Production,

        // All other commands default to development
        _ => MooseEnvironment::Development,
    }
}

pub fn load_project(command: &Commands) -> Result<Project, RoutineFailure> {
    let environment = determine_environment(command);
    Project::load_from_current_dir(environment).map_err(|e| match e {
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

/// Load a project with a default development environment
/// Used by internal routines that don't have access to the Commands enum
pub fn load_project_dev() -> Result<Project, RoutineFailure> {
    use crate::utilities::dotenv::MooseEnvironment;
    Project::load_from_current_dir(MooseEnvironment::Development).map_err(|e| match e {
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

pub(crate) fn check_project_name(name: &str) -> Result<(), RoutineFailure> {
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

/// Resolves ClickHouse URL from flag and environment variable (no Redis validation)
/// Use this for commands that only need ClickHouse access (e.g., db pull)
fn resolve_clickhouse_url(clickhouse_url: Option<&str>) -> Option<String> {
    use crate::utilities::constants::ENV_CLICKHOUSE_URL;

    // Resolve ClickHouse URL from flag or env var
    let clickhouse_url_from_env = std::env::var(ENV_CLICKHOUSE_URL).ok();
    clickhouse_url.map(String::from).or(clickhouse_url_from_env)
}

/// Resolves ClickHouse and Redis URLs from flags and environment variables, and validates Redis URL if needed
fn resolve_serverless_urls(
    project: &Project,
    clickhouse_url: Option<&str>,
    redis_url: Option<&str>,
) -> Result<(Option<String>, Option<String>), RoutineFailure> {
    use crate::utilities::constants::ENV_REDIS_URL;

    // Resolve ClickHouse URL from flag or env var
    let resolved_clickhouse_url = resolve_clickhouse_url(clickhouse_url);

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

/// Override project's ClickHouse config from flag/env var url
/// This allows the user to run these commands against other environments
/// while keeping moose config focused on dev infrastructure
fn override_project_config_from_url(
    project: &mut Project,
    clickhouse_url: &str,
) -> Result<(), RoutineFailure> {
    let clickhouse_config = parse_clickhouse_connection_string(clickhouse_url).map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Configuration".to_string(),
                "Failed to parse ClickHouse URL".to_string(),
            ),
            e,
        )
    })?;

    let clusters = project.clickhouse_config.clusters.clone();
    let additional_databases = project.clickhouse_config.additional_databases.clone();

    project.clickhouse_config = clickhouse_config;
    project.clickhouse_config.clusters = clusters;
    project.clickhouse_config.additional_databases = additional_databases;

    info!(
        "Overriding project ClickHouse config from CLI: database = {}",
        project.clickhouse_config.db_name
    );

    Ok(())
}

/// Runs local infrastructure with a configurable timeout
async fn run_local_infrastructure_with_timeout(
    project: &Arc<Project>,
    settings: &Settings,
    provider: Box<dyn InfraProvider + Send>,
) -> anyhow::Result<()> {
    let timeout_duration = Duration::from_secs(settings.dev.infrastructure_timeout_seconds);

    // Wrap the synchronous function in a blocking task to make it work with timeout
    let run_future = tokio::task::spawn_blocking({
        let project = project.clone();
        let settings = settings.clone();
        move || {
            run_local_infrastructure(&project, &settings, provider.as_ref()).map_err(|e| {
                anyhow::anyhow!(
                    "{}: {}",
                    e.message.action,
                    e.error
                        .map(|err| format!("{err:#}"))
                        .unwrap_or_else(|| e.message.details)
                )
            })
        }
    });

    match timeout(timeout_duration, run_future).await {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => Err(e.into()),
        Err(_) => Err(anyhow::anyhow!(
            "Infrastructure startup and validation timed out after {} seconds.\n\n\
                Troubleshooting steps:\n\
                • Check if Docker is running: `docker info`\n\
                • Stop existing containers: `docker stop $(docker ps -aq)`\n\
                • Restart Docker Desktop (if using Desktop)\n\
                • On Linux, restart Docker daemon: `sudo systemctl restart docker`\n\
                • Check for port conflicts: `lsof -i :4000-4002`\n\
                • Dockerless mode: check logs in .moose/native_infra/\n\
                • Docker mode: check if Docker is running with `docker info`\n\
                • Docker mode: stop existing containers with `docker stop $(docker ps -aq)`\n\
                • If the issue persists, you can increase the timeout in your Moose configuration:\n\
                  [dev]\n\
                  infrastructure_timeout_seconds = {}\n\n\
                For more help, visit: https://docs.moosejs.com/help/troubleshooting",
            timeout_duration.as_secs(),
            timeout_duration.as_secs() * 2
        )),
    }
}

const DEV_DOCKERLESS_HINT: &str =
    "Docker is unavailable. For local development without Docker, rerun: moose dev --dockerless";

fn format_local_infrastructure_error(
    error: &anyhow::Error,
    include_dockerless_hint: bool,
) -> String {
    let diagnostics = format!("{error:?}");
    let existing_message = format!("Failed to run local infrastructure: {diagnostics}");

    if include_dockerless_hint && is_container_runtime_unavailable_error(&diagnostics) {
        format!("{DEV_DOCKERLESS_HINT}\n\n{existing_message}")
    } else {
        existing_message
    }
}

fn is_container_runtime_unavailable_error(diagnostics: &str) -> bool {
    let diagnostics = diagnostics.to_ascii_lowercase();
    [
        "failed to run docker commands",
        "to ensure docker is running",
        "is the docker daemon running",
        "cannot connect to the docker daemon",
        "no such file or directory: docker",
        "no such file or directory: finch",
        "os error 2: docker",
        "os error 2: finch",
        "finch is not running",
        "cannot connect to the finch vm",
    ]
    .iter()
    .any(|phrase| diagnostics.contains(phrase))
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
            custom_dockerfile,
        } => {
            info!(
                "Running init command with name: {}, location: {:?}, template: {:?}, custom_dockerfile: {}",
                name, location, template, custom_dockerfile
            );

            // Determine template, prompting when needed.
            let template = match template {
                Some(t) => t.to_lowercase(),
                None => {
                    display::show_message_wrapper(
                        MessageType::Info,
                        Message::new(
                            "Init".to_string(),
                            "Setting up your new Moose project".to_string(),
                        ),
                    );
                    prompt_for_template_name().await?
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

            let project_outcome = initialize_project(&ProjectInitOptions {
                template: &template,
                project_name: name,
                dir_path,
                no_fail_already_exists: *no_fail_already_exists,
                custom_dockerfile: *custom_dockerfile,
                remote_bootstrap: match from_remote {
                    None => RemoteBootstrapSource::None,
                    Some(None) => RemoteBootstrapSource::Prompt,
                    Some(Some(url)) => RemoteBootstrapSource::ConnectionString(url.to_string()),
                },
            })
            .await?;

            wait_for_usage_capture(capture_handle).await;

            let success_message = format!("\n\n{}", project_outcome.post_install_message);

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
            let project_arc = Arc::new(load_project(commands)?);

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

            debug!("Loading InfrastructureMap from user code");
            // Don't resolve credentials for moose check - avoids baking into Docker
            let infra_map = InfrastructureMap::load_from_user_code(&project_arc, false)
                .await
                .map_err(|e| {
                    RoutineFailure::error(Message {
                        action: "Build".to_string(),
                        details: format!("Failed to load InfrastructureMap: {e:?}"),
                    })
                })?;

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
            let project_arc = Arc::new(load_project(commands)?);
            check_project_name(&project_arc.name())?;

            let activity = if *docker {
                ActivityType::DockerCommand
            } else {
                ActivityType::BuildCommand
            };

            let capture_handle = crate::utilities::capture::capture_usage(
                activity,
                Some(project_arc.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            let result = if *docker {
                let docker_client = DockerClient::new(&settings);
                create_dockerfile(&project_arc)?.show();

                let _ = build_dockerfile(
                    &project_arc,
                    &docker_client,
                    *amd64,
                    *arm64,
                    settings.release_channel(),
                )?;

                RoutineSuccess::success(Message::new(
                    "Built".to_string(),
                    "Docker image(s)".to_string(),
                ))
            } else {
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

                RoutineSuccess::success(Message::new(
                    "Built".to_string(),
                    format!("Package available at {}", package_path.display()),
                ))
            };

            wait_for_usage_capture(capture_handle).await;
            Ok(result)
        }
        Commands::Dev {
            no_infra,
            mcp,
            timestamps,
            timing,
            log_payloads,
            yes_all,
            yes_destructive,
            yes_rename,
            agent,
            dockerless,
        } => {
            info!("Running dev command");
            info!("Moose Version: {}", CLI_VERSION);

            // Set global flags for timestamps and timing
            SHOW_TIMESTAMPS.store(*timestamps, Ordering::Relaxed);
            SHOW_TIMING.store(*timing, Ordering::Relaxed);

            let mut project = load_project(commands)?;
            project.set_is_production_env(false);
            project.log_payloads = *log_payloads;
            if *dockerless {
                project.dev.dockerless = true;
            }

            if *log_payloads {
                info!("Payload logging enabled");
            }

            let accept_all = *yes_all || env_bool("MOOSE_ACCEPT_ALL");
            let confirmation_policy = ConfirmationPolicy {
                accept_all,
                accept_destructive: accept_all
                    || *yes_destructive
                    || env_bool("MOOSE_ACCEPT_DESTRUCTIVE"),
                accept_rename: accept_all || *yes_rename || env_bool("MOOSE_ACCEPT_RENAME"),
                is_dev: true,
                agent: *agent || env_bool("MOOSE_AGENT"),
            };

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
                let provider: Box<dyn InfraProvider + Send> = if *dockerless {
                    info!("Using native binaries for ClickHouse and Temporal (--dockerless mode)");
                    Box::new(
                        crate::utilities::native_infra::NativeInfraProvider::new(&settings)
                            .map_err(|e| {
                                RoutineFailure::error(Message {
                                    action: "Dev".to_string(),
                                    details: format!(
                                        "Failed to initialize native infrastructure: {e}"
                                    ),
                                })
                            })?,
                    )
                } else {
                    Box::new(DockerInfraProvider::new(&settings))
                };
                run_local_infrastructure_with_timeout(&project_arc, &settings, provider)
                    .await
                    .map_err(|e| {
                        RoutineFailure::error(Message {
                            action: "Dev".to_string(),
                            details: format_local_infrastructure_error(&e, !*dockerless),
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
                *mcp || *agent,
                confirmation_policy,
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
            Some(GenerateCommand::Dockerfile {}) => {
                info!("Running generate dockerfile command");

                let project_arc = Arc::new(load_project(commands)?);
                check_project_name(&project_arc.name())?;

                if !project_arc.docker_config.custom_dockerfile {
                    return Err(RoutineFailure::error(Message::new(
                        "Error".to_string(),
                        "generate dockerfile requires custom_dockerfile to be enabled in moose.config.toml.\n\
                         \n  Enable it by adding:\n\
                         \n    [docker_config]\n    custom_dockerfile = true\n\
                         \n  Or re-initialize with: moose init --custom-dockerfile"
                            .to_string(),
                    )));
                }

                let capture_handle = crate::utilities::capture::capture_usage(
                    ActivityType::DockerCommand,
                    Some(project_arc.name()),
                    &settings,
                    machine_id.clone(),
                    HashMap::new(),
                );

                create_dockerfile(&project_arc)?.show();

                wait_for_usage_capture(capture_handle).await;

                // create_dockerfile already displayed the path
                Ok(RoutineSuccess::success(Message::new(
                    String::new(),
                    String::new(),
                )))
            }
            Some(GenerateCommand::HashToken { json }) => {
                info!("Running generate hash token command");

                // Set QUIET_STDOUT early to redirect any messages (like config warnings)
                // to stderr, keeping stdout clean for JSON output
                if *json {
                    QUIET_STDOUT.store(true, Ordering::Relaxed);
                }

                let project = load_project(commands)?;
                let project_arc = Arc::new(project);

                let capture_handle = crate::utilities::capture::capture_usage(
                    ActivityType::GenerateHashCommand,
                    Some(project_arc.name()),
                    &settings,
                    machine_id.clone(),
                    HashMap::new(),
                );

                check_project_name(&project_arc.name())?;
                let result = generate_hash_token();

                if *json {
                    println!("{}", serde_json::to_string_pretty(&result).unwrap());
                } else {
                    display_hash_token_result(&result);
                }

                wait_for_usage_capture(capture_handle).await;

                Ok(RoutineSuccess::success(Message::new(
                    "Token".to_string(),
                    "Generated successfully".to_string(),
                )))
            }
            Some(GenerateCommand::Migration {
                url,
                token,
                clickhouse_url,
                redis_url,
                save,
                yes_all,
                yes_destructive,
                yes_rename,
                no_auto_backfill_sql,
                agent,
            }) => {
                info!("Running generate migration command");

                let agent = *agent || env_bool("MOOSE_AGENT");

                let mut project = load_project(commands)?;

                let capture_handle = crate::utilities::capture::capture_usage(
                    ActivityType::GenerateMigrationCommand,
                    Some(project.name()),
                    &settings,
                    machine_id.clone(),
                    HashMap::new(),
                );

                check_project_name(&project.name())?;

                // Start a lightweight MCP server for agent-driven prompts.
                // The bridge is created first and shared: the server's handler
                // clones the same Arc state, so prompt/respond stay in sync.
                let (prompt_bridge, _mcp_server) = if agent {
                    use crate::framework::core::prompt_bridge::PromptBridge;
                    let host = &project.http_server_config.host;
                    let port = project.http_server_config.port;
                    let mcp_url = format!("http://{host}:{port}/mcp");
                    let bridge = PromptBridge::new(mcp_url);
                    match crate::mcp::standalone::start(host, port, bridge.clone()).await {
                        Ok(server) => {
                            display::show_message_wrapper(
                                MessageType::Success,
                                Message {
                                    action: "MCP".to_string(),
                                    details: format!("Prompt server available at {}", server.url()),
                                },
                            );
                            (Some(bridge), Some(server))
                        }
                        Err(e) => {
                            return Err(RoutineFailure::error(Message {
                                action: "MCP".to_string(),
                                details: format!("Failed to start prompt server: {e}"),
                            }));
                        }
                    }
                } else {
                    (None, None)
                };

                // Determine which remote source to use and generate migration
                let result = if let Some(ref moose_url) = url {
                    // Using Moose server - no need for Redis URL (server handles state)
                    let remote = routines::RemoteSource::Moose {
                        url: moose_url,
                        token,
                    };
                    routines::remote_gen_migration(&project, remote).await
                } else if clickhouse_url.is_some() || std::env::var(ENV_CLICKHOUSE_URL).is_ok() {
                    // Using direct ClickHouse - need to resolve URLs and validate Redis if needed
                    let (resolved_clickhouse_url, resolved_redis_url) = resolve_serverless_urls(
                        &project,
                        clickhouse_url.as_deref(),
                        redis_url.as_deref(),
                    )?;

                    let ch_url = resolved_clickhouse_url.ok_or_else(|| {
                        RoutineFailure::error(Message {
                            action: "Configuration".to_string(),
                            details: format!(
                                "--clickhouse-url required (or set {} environment variable)",
                                ENV_CLICKHOUSE_URL
                            ),
                        })
                    })?;

                    override_project_config_from_url(&mut project, &ch_url)?;

                    let remote = routines::RemoteSource::Serverless {
                        clickhouse_url: &ch_url,
                        redis_url: &resolved_redis_url,
                    };
                    routines::remote_gen_migration(&project, remote).await
                } else {
                    return Err(RoutineFailure::error(Message {
                        action: "Configuration".to_string(),
                        details: "Either --url or --clickhouse-url is required (or set environment variables)".to_string(),
                    }));
                };

                let mut result = result.map_err(|e| {
                    RoutineFailure::new(
                        Message {
                            action: "Plan".to_string(),
                            details: "Failed to generate migration plan".to_string(),
                        },
                        e,
                    )
                })?;

                let outcome = confirm_and_save_migration(
                    &project,
                    &mut result,
                    *yes_all,
                    *yes_destructive,
                    *yes_rename,
                    *no_auto_backfill_sql,
                    *save,
                    agent,
                    prompt_bridge.as_ref(),
                )
                .await;

                wait_for_usage_capture(capture_handle).await;

                outcome
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

            let mut project = load_project(commands)?;

            project.set_is_production_env(true);

            let project_arc = Arc::new(project);

            check_project_name(&project_arc.name())?;

            // If start_include_dependencies is true, manage Docker containers like dev mode
            if *start_include_dependencies {
                let provider: Box<dyn InfraProvider + Send> =
                    Box::new(DockerInfraProvider::new(&settings));
                run_local_infrastructure_with_timeout(&project_arc, &settings, provider)
                    .await
                    .map_err(|e| {
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
            json,
        } => {
            info!("Running plan command");

            // Set QUIET_STDOUT early to redirect any messages (like config warnings)
            // to stderr, keeping stdout clean for JSON output
            if *json {
                QUIET_STDOUT.store(true, Ordering::Relaxed);
            }

            let project = load_project(commands)?;

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::PlanCommand,
                Some(project.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            check_project_name(&project.name())?;

            let result = routines::remote_plan(&project, url, token, clickhouse_url, *json).await;

            result.map_err(|e| {
                RoutineFailure::error(Message {
                    action: "Plan".to_string(),
                    details: format!("Failed to plan changes: {e:?}"),
                })
            })?;

            wait_for_usage_capture(capture_handle).await;

            // When --json is used, output is already printed, so suppress success message
            if *json {
                Ok(RoutineSuccess::success(Message::new(
                    "".to_string(),
                    "".to_string(),
                )))
            } else {
                Ok(RoutineSuccess::success(Message::new(
                    "Plan".to_string(),
                    "Successfully planned changes to the infrastructure".to_string(),
                )))
            }
        }
        Commands::Migrate {
            clickhouse_url,
            redis_url,
            validate,
        } => {
            info!("Running migrate command");

            if *validate {
                // Validate-only mode: no ClickHouse or Redis needed
                let project = load_project(commands)?;
                if !project.features.migrate_with_deltas {
                    return Err(RoutineFailure::error(Message::new(
                        "Validate".to_string(),
                        "Migration validation requires features.migrate_with_deltas = true in moose.config.toml".to_string(),
                    )));
                }
                return validate_migrations(&project);
            }

            let mut project = load_project(commands)?;

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

            override_project_config_from_url(&mut project, &resolved_clickhouse_url)?;

            routines::migrate::execute_migration(&project, resolved_redis_url.as_deref()).await?;

            wait_for_usage_capture(capture_handle).await;

            Ok(RoutineSuccess::success(Message::new(
                "Migrate".to_string(),
                "Successfully executed migration plan".to_string(),
            )))
        }
        Commands::Clean {} => {
            let project = load_project(commands)?;
            let project_arc = Arc::new(project);

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::CleanCommand,
                Some(project_arc.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            check_project_name(&project_arc.name())?;

            // Stop native infrastructure first (before Docker cleanup which
            // may fail if Docker is unavailable, e.g. when using --dockerless mode).
            crate::utilities::native_infra::stop_native_infra(&project_arc);

            let provider = DockerInfraProvider::new(&settings);
            let _ = clean_project(&project_arc, &provider)?;

            wait_for_usage_capture(capture_handle).await;

            Ok(RoutineSuccess::success(Message::new(
                "Cleaned".to_string(),
                "Project".to_string(),
            )))
        }
        Commands::Logs { tail, filter } => {
            info!("Running logs command");

            let project = load_project(commands)?;

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
                .map_err(|e| {
                    RoutineFailure::new(
                        Message::new("Failed".to_string(), "to resolve log directory".to_string()),
                        e,
                    )
                })?
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

            let project = load_project(commands)?;
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

            let project = load_project(commands)?;
            let project_arc = Arc::new(project);

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::LsCommand,
                Some(project_arc.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            let res = ls(&project_arc, _type.as_deref(), name.as_deref(), *json).await;

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

            let project = load_project(commands)?;
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
            let project = load_project(commands)?;

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
                    ls(&project, Some("workflows"), None, *json).await
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
                TemplateSubCommands::List { json } => {
                    if *json {
                        QUIET_STDOUT.store(true, Ordering::Relaxed);
                    }

                    let capture_handle = crate::utilities::capture::capture_usage(
                        ActivityType::TemplateListCommand,
                        None,
                        &settings,
                        machine_id.clone(),
                        HashMap::new(),
                    );

                    let result = list_available_templates(CLI_VERSION, *json).await;

                    wait_for_usage_capture(capture_handle).await;

                    result
                }
            }
        }
        Commands::Harness(harness_args) => {
            info!("Running harness command");

            match &harness_args.command {
                HarnessSubCommands::Init(flags) => {
                    run_harness_init(flags, &settings, &machine_id).await
                }
            }
        }
        Commands::Component(component_args) => {
            info!("Running component command");

            let component_cmd = component_args.command.as_ref().unwrap();
            match component_cmd {
                ComponentSubCommands::List {} => {
                    let capture_handle = crate::utilities::capture::capture_usage(
                        ActivityType::ComponentListCommand,
                        None,
                        &settings,
                        machine_id.clone(),
                        HashMap::new(),
                    );

                    let result = routines::components::list_components(CLI_VERSION);

                    wait_for_usage_capture(capture_handle).await;

                    result
                }
            }
        }
        Commands::Db(DbArgs {
            command:
                DbCommands::Pull {
                    clickhouse_url,
                    file_path,
                },
        }) => {
            info!("Running db pull command");
            let project = load_project(commands)?;

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::DbPullCommand,
                Some(project.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            // Use resolve_clickhouse_url for env var fallback (db pull only needs ClickHouse, not Redis)
            let resolved_from_flag_or_env = resolve_clickhouse_url(clickhouse_url.as_deref());

            // Fall back to keyring if not provided via flag or env var
            match resolved_from_flag_or_env {
                Some(url) => {
                    db_pull(&url, &project, file_path.as_deref())
                        .await
                        .map_err(|e| {
                            RoutineFailure::new(
                                Message::new("DB Pull".to_string(), "failed".to_string()),
                                e,
                            )
                        })?;
                }
                None => {
                    // Try keychain URL first (from moose init --from-remote)
                    let repo = KeyringSecretRepository;
                    match repo.get(&project.name(), KEY_REMOTE_CLICKHOUSE_URL) {
                        Ok(Some(url)) => {
                            db_pull(&url, &project, file_path.as_deref())
                                .await
                                .map_err(|e| {
                                    RoutineFailure::new(
                                        Message::new("DB Pull".to_string(), "failed".to_string()),
                                        e,
                                    )
                                })?;
                        }
                        Ok(None) => {
                            // Try [dev.remote_clickhouse] config with keychain credentials
                            match resolve_remote_clickhouse(&project) {
                                Ok(Some(remote)) => {
                                    db_pull_from_remote(&remote, &project, file_path.as_deref())
                                        .await?;
                                }
                                Ok(None) => {
                                    return Err(RoutineFailure::error(Message {
                                        action: "DB Pull".to_string(),
                                        details: format!(
                                            "No ClickHouse connection found. Options:\n\
                                            1. Pass --clickhouse-url\n\
                                            2. Set {} environment variable\n\
                                            3. Configure [dev.remote_clickhouse] in moose.config.toml\n\
                                            4. Run `moose init --from-remote` to save credentials",
                                            ENV_CLICKHOUSE_URL
                                        ),
                                    }));
                                }
                                Err(e) => return Err(e),
                            }
                        }
                        Err(e) => {
                            return Err(RoutineFailure::error(Message {
                                action: "DB Pull".to_string(),
                                details: format!(
                                    "Failed to read saved ClickHouse URL from keychain: {e:?}"
                                ),
                            }));
                        }
                    }
                }
            };

            wait_for_usage_capture(capture_handle).await;
            Ok(RoutineSuccess::success(Message::new(
                "DB Pull".to_string(),
                "External models refreshed".to_string(),
            )))
        }
        Commands::Refresh { url, token } => {
            info!("Running refresh command");

            let project = load_project(commands)?;

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
            let project = load_project(commands)?;

            seed_data::handle_seed_command(seed_args, &project).await
        }
        Commands::Truncate { tables, all, rows } => {
            let project = load_project(commands)?;
            routines::truncate_table::truncate_tables(&project, tables.clone(), *all, *rows).await
        }
        Commands::Mcp { host, port } => {
            // Resolve host/port: CLI args > project config > defaults
            let (resolved_host, resolved_port) = {
                let default_host = "localhost".to_string();
                let default_port: u16 = 4000;

                match (host.clone(), *port) {
                    (Some(h), Some(p)) => (h, p),
                    (h, p) => {
                        // Try loading project config for unset values
                        let (proj_host, proj_port) = load_project(commands)
                            .map(|proj| {
                                (
                                    proj.http_server_config.host.clone(),
                                    proj.http_server_config.port,
                                )
                            })
                            .unwrap_or((default_host.clone(), default_port));
                        (h.unwrap_or(proj_host), p.unwrap_or(proj_port))
                    }
                }
            };

            let dev_server_url = format!("http://{}:{}/mcp", resolved_host, resolved_port);
            eprintln!(
                "Moose MCP proxy connecting to dev server at {}",
                dev_server_url
            );

            let handler = crate::mcp::ProxyMcpHandler::new(dev_server_url);

            let service = handler
                .serve(rmcp::transport::io::stdio())
                .await
                .map_err(|e| {
                    RoutineFailure::error(Message::new(
                        "MCP".to_string(),
                        format!("Failed to start MCP proxy: {e}"),
                    ))
                })?;

            service.waiting().await.map_err(|e| {
                RoutineFailure::error(Message::new(
                    "MCP".to_string(),
                    format!("MCP proxy error: {e}"),
                ))
            })?;

            // Return an empty message so nothing is written to stdout,
            // which is reserved for MCP protocol frames.
            Ok(RoutineSuccess::success(Message::new(
                String::new(),
                String::new(),
            )))
        }
        Commands::Kafka(KafkaArgs { command }) => match command {
            KafkaCommands::Pull {
                bootstrap,
                path,
                include,
                exclude,
                schema_registry,
            } => {
                let project = load_project(commands)?;

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
        Commands::Feedback {
            message,
            bug,
            community,
            email,
        } => {
            if *community {
                routines::feedback::join_community(&settings, machine_id).await
            } else if *bug {
                routines::feedback::report_bug(message.as_deref(), &settings, machine_id).await
            } else if let Some(msg) = message {
                routines::feedback::send_feedback(msg, email.as_deref(), &settings, machine_id)
                    .await
            } else {
                routines::feedback::show_help()
            }
        }
        Commands::Query {
            query: sql,
            file,
            limit,
            format_query,
            prettify,
        } => {
            info!("Running query command");

            let project = load_project(commands)?;
            let project_arc = Arc::new(project);

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::QueryCommand,
                Some(project_arc.name()),
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            let result = query(
                project_arc,
                sql.clone(),
                file.clone(),
                *limit,
                format_query.clone(),
                *prettify,
            )
            .await;

            wait_for_usage_capture(capture_handle).await;

            result
        }
        Commands::Add { component } => {
            info!("Running add command");

            let component_name = match &component {
                AddComponent::McpServer(_) => "mcp-server",
                AddComponent::Chat(_) => "chat",
                AddComponent::Benchmark(_) => "benchmark",
            };

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::AddCommand,
                None,
                &settings,
                machine_id.clone(),
                HashMap::from([("component".to_string(), component_name.to_string())]),
            );

            let result = routines::components::add_component(component).await;

            wait_for_usage_capture(capture_handle).await;

            result
        }
        Commands::Docs(docs_args) => {
            info!("Running docs command");

            let capture_handle = crate::utilities::capture::capture_usage(
                ActivityType::DocsCommand,
                None,
                &settings,
                machine_id.clone(),
                HashMap::new(),
            );

            let lang = routines::docs::resolve_language(docs_args.lang.as_deref(), &settings)?;

            let result = match &docs_args.command {
                Some(DocsCommands::Browse {}) => {
                    routines::docs::browse_docs(lang, docs_args.raw, docs_args.web).await
                }
                Some(DocsCommands::Search { query, expand }) => {
                    routines::docs::search_toc(query, docs_args.raw, lang, *expand).await
                }
                None if docs_args.slug.is_none() => {
                    routines::docs::show_toc(docs_args.expand, docs_args.raw, lang).await
                }
                None => {
                    let slug = docs_args.slug.as_deref().unwrap_or_default().to_string();
                    // Split on # to separate slug from section anchor
                    let (page_slug, section) = match slug.split_once('#') {
                        Some((s, anchor)) => (s.to_string(), Some(anchor.to_string())),
                        None => (slug, None),
                    };
                    if docs_args.web {
                        // For --web, pass the full slug including any #anchor
                        let web_slug = match &section {
                            Some(anchor) => format!("{}#{}", page_slug, anchor),
                            None => page_slug,
                        };
                        routines::docs::open_in_browser(&web_slug)
                    } else {
                        routines::docs::fetch_page(
                            &page_slug,
                            lang,
                            docs_args.raw,
                            section.as_deref(),
                        )
                        .await
                    }
                }
            };

            wait_for_usage_capture(capture_handle).await;

            result
        }
    }
}

/// Validate migration files without executing them.
///
/// Loads all migration files from ./migrations/, verifies the delta sequence
/// is consistent (fold succeeds from empty map), and reports any issues.
fn validate_migrations(project: &Project) -> Result<RoutineSuccess, RoutineFailure> {
    use crate::framework::core::migration_file::MigrationHistory;
    use std::path::Path;

    let migrations_dir = Path::new("./migrations");
    if !migrations_dir.exists() {
        return Ok(RoutineSuccess::success(Message::new(
            "Validate".to_string(),
            "No migrations directory found".to_string(),
        )));
    }

    let history = MigrationHistory::load_from_dir(migrations_dir).map_err(|e| {
        RoutineFailure::error(Message::new(
            "Validate".to_string(),
            format!("Failed to load migration files: {}", e),
        ))
    })?;

    if history.is_empty() {
        return Ok(RoutineSuccess::success(Message::new(
            "Validate".to_string(),
            "No migration files found in ./migrations/".to_string(),
        )));
    }

    println!("Validating {} migration file(s)...\n", history.files.len());

    // Display each migration
    for file in &history.files {
        println!("  {} ({} delta(s))", file.id, file.deltas.len());
        for delta in &file.deltas {
            println!("    - {}", delta.summary());
        }
    }
    println!();

    // Test fold: reconstruct map from empty
    let default_database = &project.clickhouse_config.db_name;
    let mut fold_ok = true;
    match history.reconstruct_olap_map(default_database) {
        Ok(map) => {
            println!(
                "✓ Fold succeeded: {} table(s), {} view(s), {} MV(s)",
                map.tables.len(),
                map.views.len(),
                map.materialized_views.len()
            );
        }
        Err(e) => {
            println!("✗ Fold failed: {}", e);
            fold_ok = false;
        }
    }

    // Check for conflicts between migrations that share a parent hash
    // Group migrations by parent_state_hash
    let mut by_parent: std::collections::HashMap<
        &str,
        Vec<&crate::framework::core::migration_file::MigrationFile>,
    > = std::collections::HashMap::new();
    for file in &history.files {
        by_parent
            .entry(&file.parent_state_hash)
            .or_default()
            .push(file);
    }

    let mut conflict_count = 0;
    for (hash, files) in &by_parent {
        if files.len() > 1 {
            // Multiple migrations from the same parent — check for conflicts
            // Compare each pair
            for i in 0..files.len() {
                for j in (i + 1)..files.len() {
                    let conflicts = MigrationHistory::detect_conflicts(
                        &[files[i].clone()],
                        &[files[j].clone()],
                        default_database,
                    );
                    for conflict in &conflicts {
                        conflict_count += 1;
                        match conflict {
                            crate::framework::core::migration_file::MigrationConflict::SameTableModified {
                                table_id,
                                branch_a_migration,
                                branch_b_migration,
                            } => {
                                println!(
                                    "⚠ Conflict: table '{}' modified by both '{}' and '{}' (parent: {}..)",
                                    table_id,
                                    branch_a_migration,
                                    branch_b_migration,
                                    &hash[..12.min(hash.len())]
                                );
                            }
                            crate::framework::core::migration_file::MigrationConflict::TableDroppedAndModified {
                                table_id,
                                dropper,
                                modifier,
                            } => {
                                println!(
                                    "⚠ Conflict: table '{}' dropped by '{}' but modified by '{}' (parent: {}..)",
                                    table_id,
                                    dropper,
                                    modifier,
                                    &hash[..12.min(hash.len())]
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    if conflict_count > 0 || !fold_ok {
        let mut issues = Vec::new();
        if !fold_ok {
            issues.push("fold failed".to_string());
        }
        if conflict_count > 0 {
            issues.push(format!("{} conflict(s)", conflict_count));
        }
        println!("\n✗ Validation failed: {}", issues.join(", "));
        return Err(RoutineFailure::error(Message::new(
            "Validate".to_string(),
            issues.join(", "),
        )));
    }

    println!("\n✓ All migrations valid, no conflicts detected");

    Ok(RoutineSuccess::success(Message::new(
        "Validate".to_string(),
        format!(
            "{} migration file(s) validated successfully",
            history.files.len()
        ),
    )))
}

/// Runs confirmation gates (rename + destructive), builds the final migration
/// plan with optional backfill SQL, and saves or prints the result.
///
/// Extracted from the `generate migration` handler so that early-returns
/// (rename cancellation, destructive rejection) do not bypass the caller's
/// `wait_for_usage_capture` call.
#[allow(clippy::too_many_arguments)]
async fn confirm_and_save_migration(
    project: &Project,
    result: &mut MigrationPlanWithBeforeAfter,
    yes_all: bool,
    yes_destructive: bool,
    yes_rename: bool,
    no_auto_backfill_sql: bool,
    save: bool,
    agent: bool,
    bridge: Option<&PromptBridge>,
) -> Result<RoutineSuccess, RoutineFailure> {
    // If delta migrations are not enabled, use the legacy plan.yaml path
    if !project.features.migrate_with_deltas {
        return confirm_and_save_migration_legacy(
            project,
            result,
            yes_all,
            yes_destructive,
            yes_rename,
            no_auto_backfill_sql,
            save,
            agent,
            bridge,
        )
        .await;
    }

    let accept_all = yes_all || env_bool("MOOSE_ACCEPT_ALL");
    let migration_policy = ConfirmationPolicy {
        accept_all,
        accept_destructive: accept_all || yes_destructive || env_bool("MOOSE_ACCEPT_DESTRUCTIVE"),
        accept_rename: accept_all || yes_rename || env_bool("MOOSE_ACCEPT_RENAME"),
        is_dev: false,
        agent,
    };

    // Step 1: Rename gate on raw InfraChanges (mutates changes in place).
    // This must happen before delta generation since renames affect the structural diff.
    use crate::framework::core::plan_risk::rename_confirmation_gate;
    let approved_drops =
        match rename_confirmation_gate(&mut result.changes, &migration_policy, bridge).await? {
            Some(drops) => drops,
            None => {
                return Ok(RoutineSuccess::success(Message::new(
                    "Migration".to_string(),
                    "generation cancelled during rename confirmation".to_string(),
                )));
            }
        };

    // Step 2: Version bump detection and prompting.
    let (mut version_bumps, remaining_changes) =
        version_bump::extract_version_bumps(&result.changes.olap_changes);
    let backfill_only =
        version_bump::find_backfill_only_bumps(&remaining_changes, &result.remote_state);
    version_bumps.extend(backfill_only);

    let mut version_bump_decisions = if !version_bumps.is_empty() {
        match version_bump::version_bump_gate(
            version_bumps,
            &result.default_database,
            accept_all,
            bridge,
        )
        .await?
        {
            Some(decisions) => decisions,
            None => {
                return Ok(RoutineSuccess::success(Message::new(
                    "Migration".to_string(),
                    "generation cancelled during version bump confirmation".to_string(),
                )));
            }
        }
    } else {
        vec![]
    };

    if no_auto_backfill_sql {
        for d in &mut version_bump_decisions {
            d.backfill_sql = None;
        }
    }

    // Step 3: Generate deltas from the remaining (non-version-bump) changes.
    let mut infra_deltas = crate::framework::core::infra_delta::olap_changes_to_deltas(
        &remaining_changes,
        &result.default_database,
    );

    // Prepend version bump deltas (create → backfill → drop) before other deltas
    // so the new table exists before anything that might reference it.
    let bump_deltas = version_bump::version_bump_decisions_to_deltas(&version_bump_decisions);
    if !bump_deltas.is_empty() {
        // Strip duplicate CreateTable for NewAlongside tables (already in bump_deltas).
        let alongside = version_bump::alongside_new_table_names(&version_bump_decisions);
        if !alongside.is_empty() {
            infra_deltas.retain(|d| {
                !matches!(d, crate::framework::core::infra_delta::InfraDelta::CreateTable { table } if alongside.contains(&table.name))
            });
        }
        let mut combined = bump_deltas;
        combined.append(&mut infra_deltas);
        infra_deltas = combined;
    }

    // Step 4: Classify risk from deltas, excluding drops already approved during rename.
    // Version bumps are already excluded from the remaining changes, and their DropTable
    // deltas (if any) have pre-filled policies from the version bump gate.
    let mut risk = classify_risk_from_deltas(&infra_deltas);
    risk.exclude_approved_drops(&approved_drops);

    version_bump::exclude_bump_drops_from_risk(&version_bump_decisions, &mut risk);

    // Step 5: Destructive gate — prompt for production confirmation.
    match migration_destructive_gate(&risk, &migration_policy, bridge).await? {
        MigrationGateOutcome::Rejected { tables } => {
            print_migration_rejected_guidance(&tables, &project.language);
            return Ok(RoutineSuccess::success(Message::new(
                "Migration".to_string(),
                "generation aborted".to_string(),
            )));
        }
        MigrationGateOutcome::Accepted | MigrationGateOutcome::NoDestructiveChanges => {}
    }

    // Step 6: Fill policies from the risk classification.
    crate::framework::core::infra_delta::fill_policies_from_risk(&mut infra_deltas, &risk);

    if save {
        // Generate EXTERNALLY_MANAGED files for retained old tables so Moose keeps tracking them.
        if version_bump_decisions
            .iter()
            .any(|d| d.old_table_disposition == version_bump::OldTableDisposition::Retain)
        {
            let source_dir = project.project_location.join(&project.source_dir);
            version_bump::write_retained_table_files(
                &version_bump_decisions,
                &source_dir,
                &project.language,
            )
            .map_err(|e| {
                RoutineFailure::new(
                    Message::new(
                        "Migration".to_string(),
                        "failed to write retained table files".to_string(),
                    ),
                    e,
                )
            })?;
            display::show_message_wrapper(
                MessageType::Success,
                Message {
                    action: "Generated".to_string(),
                    details: "EXTERNALLY_MANAGED table definition file(s) for retained tables"
                        .to_string(),
                },
            );
        }

        if infra_deltas.is_empty() {
            return Ok(RoutineSuccess::success(Message::new(
                "Migration".to_string(),
                "no changes to write".to_string(),
            )));
        }

        std::fs::create_dir_all("./migrations").map_err(|e| {
            RoutineFailure::new(
                Message::new("Migration".to_string(), "plan writing failed.".to_string()),
                e,
            )
        })?;

        let parent_hash = result.remote_state.olap_hash();
        let migration_file = crate::framework::core::migration_file::MigrationFile::new(
            "migration".to_string(),
            parent_hash,
            infra_deltas,
        );
        let migration_yaml = migration_file.to_yaml().map_err(|e| {
            RoutineFailure::new(
                Message::new("Migration".to_string(), "Failed to serialize".to_string()),
                e,
            )
        })?;
        let migration_path = format!("./migrations/{}.yaml", migration_file.id);
        std::fs::write(&migration_path, &migration_yaml).map_err(|e| {
            RoutineFailure::new(
                Message::new("Migration".to_string(), "plan writing failed.".to_string()),
                e,
            )
        })?;

        display::show_message_wrapper(
            MessageType::Success,
            Message {
                action: "Migration".to_string(),
                details: format!(
                    "Written to {} ({} delta(s))",
                    migration_path,
                    migration_file.deltas.len()
                ),
            },
        );
    } else if infra_deltas.is_empty() {
        println!("No changes detected.");
        return Ok(RoutineSuccess::success(Message::new(
            "Migration".to_string(),
            "no changes detected".to_string(),
        )));
    } else {
        println!("Changes ({} delta(s)):\n", infra_deltas.len());
        for (i, delta) in infra_deltas.iter().enumerate() {
            println!("  {}. {}", i + 1, delta.summary());
        }
        version_bump::show_retained_table_note(&version_bump_decisions);
    }

    Ok(RoutineSuccess::success(Message::new(
        "Migration".to_string(),
        "generated".to_string(),
    )))
}

/// Legacy migration generation path (plan.yaml + state snapshots).
/// Used when `features.migrate_with_deltas` is false.
#[allow(clippy::too_many_arguments)]
async fn confirm_and_save_migration_legacy(
    project: &Project,
    result: &mut MigrationPlanWithBeforeAfter,
    yes_all: bool,
    yes_destructive: bool,
    yes_rename: bool,
    no_auto_backfill_sql: bool,
    save: bool,
    agent: bool,
    bridge: Option<&PromptBridge>,
) -> Result<RoutineSuccess, RoutineFailure> {
    use crate::framework::core::migration_plan::MIGRATION_SCHEMA;
    use crate::framework::core::plan_risk::confirm_renames_and_classify;
    use crate::utilities::constants::{
        MIGRATION_AFTER_STATE_FILE, MIGRATION_BEFORE_STATE_FILE, MIGRATION_FILE,
    };
    use tracing::warn;

    let accept_all = yes_all || env_bool("MOOSE_ACCEPT_ALL");
    let migration_policy = ConfirmationPolicy {
        accept_all,
        accept_destructive: accept_all || yes_destructive || env_bool("MOOSE_ACCEPT_DESTRUCTIVE"),
        accept_rename: accept_all || yes_rename || env_bool("MOOSE_ACCEPT_RENAME"),
        is_dev: false,
        agent,
    };

    let risk =
        match confirm_renames_and_classify(&mut result.changes, &migration_policy, bridge).await? {
            Some(risk) => risk,
            None => {
                return Ok(RoutineSuccess::success(Message::new(
                    "Migration".to_string(),
                    "generation cancelled during rename confirmation".to_string(),
                )));
            }
        };

    // Version bump detection, prompting, and risk exclusion (legacy path).
    let mut filtered_risk = risk;
    let mut version_bump_decisions = match version_bump::detect_prompt_and_exclude(
        &result.changes.olap_changes,
        &result.remote_state,
        &result.default_database,
        accept_all,
        &mut filtered_risk,
        bridge,
    )
    .await?
    {
        Some(d) => d,
        None => {
            return Ok(RoutineSuccess::success(Message::new(
                "Migration".to_string(),
                "generation cancelled during version bump confirmation".to_string(),
            )));
        }
    };

    if no_auto_backfill_sql {
        for d in &mut version_bump_decisions {
            d.backfill_sql = None;
        }
    }

    match migration_destructive_gate(&filtered_risk, &migration_policy, bridge).await? {
        MigrationGateOutcome::Rejected { tables } => {
            print_migration_rejected_guidance(&tables, &project.language);
            return Ok(RoutineSuccess::success(Message::new(
                "Migration".to_string(),
                "generation aborted".to_string(),
            )));
        }
        MigrationGateOutcome::Accepted | MigrationGateOutcome::NoDestructiveChanges => {}
    }

    let db_migration = MigrationPlan::from_infra_plan_with_version_bumps(
        &result.changes,
        &result.default_database,
        &version_bump_decisions,
    )
    .map_err(|e| {
        RoutineFailure::new(
            Message {
                action: "Plan".to_string(),
                details: "Failed to order migration operations".to_string(),
            },
            e,
        )
    })?;

    // Backfill-only bumps (new table with older version in remote) are now
    // handled by version_bump_gate above — no separate detect_backfill_candidates needed.

    let plan_yaml = db_migration.to_yaml().map_err(|e| {
        RoutineFailure::new(
            Message {
                action: "Plan".to_string(),
                details: "Failed to serialize".to_string(),
            },
            e,
        )
    })?;

    if save {
        // Generate EXTERNALLY_MANAGED files for retained old tables so Moose keeps tracking them.
        if version_bump_decisions
            .iter()
            .any(|d| d.old_table_disposition == version_bump::OldTableDisposition::Retain)
        {
            let source_dir = project.project_location.join(&project.source_dir);
            version_bump::write_retained_table_files(
                &version_bump_decisions,
                &source_dir,
                &project.language,
            )
            .map_err(|e| {
                RoutineFailure::new(
                    Message::new(
                        "Migration".to_string(),
                        "failed to write retained table files".to_string(),
                    ),
                    e,
                )
            })?;
            display::show_message_wrapper(
                MessageType::Success,
                Message {
                    action: "Generated".to_string(),
                    details: "EXTERNALLY_MANAGED table definition file(s) for retained tables"
                        .to_string(),
                },
            );
        }

        std::fs::create_dir_all("./migrations").map_err(|e| {
            RoutineFailure::new(
                Message::new("Migration".to_string(), "plan writing failed.".to_string()),
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

        let plan_yaml_with_header = format!(
            "# yaml-language-server: $schema=../.moose/migration_schema.json\n\n{}",
            plan_yaml
        );
        std::fs::write(MIGRATION_FILE, plan_yaml_with_header.as_str()).map_err(|e| {
            RoutineFailure::new(
                Message::new("Migration".to_string(), "plan writing failed.".to_string()),
                e,
            )
        })?;
        std::fs::write(
            MIGRATION_BEFORE_STATE_FILE,
            serde_json::to_string_pretty(&result.remote_state).map_err(|e| {
                RoutineFailure::new(
                    Message::new("Error".to_string(), "serializing remote state.".to_string()),
                    e,
                )
            })?,
        )
        .map_err(|e| {
            RoutineFailure::new(
                Message::new("Migration".to_string(), "plan writing failed.".to_string()),
                e,
            )
        })?;
        std::fs::write(
            MIGRATION_AFTER_STATE_FILE,
            serde_json::to_string_pretty(&result.local_infra_map).map_err(|e| {
                RoutineFailure::new(
                    Message::new("Error".to_string(), "serializing local state.".to_string()),
                    e,
                )
            })?,
        )
        .map_err(|e| {
            RoutineFailure::new(
                Message::new("Migration".to_string(), "plan writing failed.".to_string()),
                e,
            )
        })?;
    } else {
        println!("Changes: \n\n{}", plan_yaml);
        version_bump::show_retained_table_note(&version_bump_decisions);
    }

    Ok(RoutineSuccess::success(Message::new(
        "Migration".to_string(),
        "generated".to_string(),
    )))
}

#[cfg(test)]
mod tests {
    use crate::{cli::settings::read_settings, utilities::machine_id::get_or_create_machine_id};

    use super::*;

    fn assert_does_not_suggest_dockerless(details: &str, expected_start: &str) {
        assert!(!details.contains("moose dev --dockerless"));
        assert!(
            details.starts_with(expected_start),
            "expected details to start with {expected_start:?}, got {details:?}"
        );
    }

    #[test]
    fn dev_infrastructure_error_suggests_dockerless_when_docker_binary_is_missing() {
        let error = anyhow::anyhow!("Failed: No such file or directory: docker (os error 2)");

        let details = format_local_infrastructure_error(&error, true);

        assert!(details.contains("moose dev --dockerless"));
        assert!(details.contains("Failed: No such file or directory: docker (os error 2)"));
    }

    #[test]
    fn dev_infrastructure_error_suggests_dockerless_when_wrapped_docker_check_fails() {
        let error = anyhow::anyhow!(
            "Failed: to ensure docker is running\nCaused by:\n    No such file or directory (os error 2)"
        );

        let details = format_local_infrastructure_error(&error, true);

        assert!(details.contains("moose dev --dockerless"));
        assert!(details.contains("to ensure docker is running"));
    }

    #[test]
    fn dev_infrastructure_error_suggests_dockerless_when_docker_daemon_is_unreachable() {
        let error = anyhow::anyhow!(
            "Failed: Cannot connect to the Docker daemon at unix:///var/run/docker.sock"
        );

        let details = format_local_infrastructure_error(&error, true);

        assert!(details.contains("moose dev --dockerless"));
        assert!(details.contains("Cannot connect to the Docker daemon"));
    }

    #[test]
    fn dev_infrastructure_error_suggests_dockerless_when_finch_binary_is_missing() {
        let error = anyhow::anyhow!("Failed: No such file or directory: finch (os error 2)");

        let details = format_local_infrastructure_error(&error, true);

        assert!(details.contains("moose dev --dockerless"));
        assert!(details.contains("Failed: No such file or directory: finch (os error 2)"));
    }

    #[test]
    fn dev_infrastructure_error_suggests_dockerless_when_wrapped_finch_check_fails() {
        let error = anyhow::anyhow!(
            "Failed: to ensure docker is running\nCaused by:\n    No such file or directory: finch (os error 2)"
        );

        let details = format_local_infrastructure_error(&error, true);

        assert!(details.contains("moose dev --dockerless"));
        assert!(details.contains("No such file or directory: finch"));
    }

    #[test]
    fn dev_infrastructure_error_suggests_dockerless_when_finch_daemon_is_unreachable() {
        let error = anyhow::anyhow!("Failed: Cannot connect to the Finch VM. Is Finch running?");

        let details = format_local_infrastructure_error(&error, true);

        assert!(details.contains("moose dev --dockerless"));
        assert!(details.contains("Cannot connect to the Finch VM"));
    }

    #[test]
    fn local_infrastructure_error_does_not_suggest_dockerless_for_non_dev_paths() {
        let error = anyhow::anyhow!("Failed: Cannot connect to the Docker daemon");

        let details = format_local_infrastructure_error(&error, false);

        assert_does_not_suggest_dockerless(
            &details,
            "Failed to run local infrastructure: Failed: Cannot connect to the Docker daemon",
        );
    }

    #[test]
    fn local_infrastructure_error_does_not_suggest_dockerless_for_finch_non_dev_paths() {
        let error = anyhow::anyhow!("Failed: Finch is not running");

        let details = format_local_infrastructure_error(&error, false);

        assert_does_not_suggest_dockerless(
            &details,
            "Failed to run local infrastructure: Failed: Finch is not running",
        );
    }

    #[test]
    fn dev_infrastructure_error_does_not_suggest_dockerless_for_non_runtime_errors() {
        let error = anyhow::anyhow!("Failed: ClickHouse container did not become healthy");

        let details = format_local_infrastructure_error(&error, true);

        assert_does_not_suggest_dockerless(
            &details,
            "Failed to run local infrastructure: Failed: ClickHouse container did not become healthy"
        );
    }

    #[test]
    fn dev_infrastructure_error_does_not_suggest_dockerless_for_generic_docker_text() {
        let error = anyhow::anyhow!(
            "Failed: timed out waiting for service. Check logs and verify is docker running locally."
        );

        let details = format_local_infrastructure_error(&error, true);

        assert_does_not_suggest_dockerless(
            &details,
            "Failed to run local infrastructure: Failed: timed out waiting for service. Check logs and verify is docker running locally."
        );
    }

    #[test]
    fn dev_infrastructure_timeout_does_not_suggest_dockerless() {
        let error = anyhow::anyhow!(
            "Infrastructure startup and validation timed out after 60 seconds.\n\n\
                Troubleshooting steps:\n\
                • Check if Docker is running: `docker info`\n\
                • Stop existing containers: `docker stop $(docker ps -aq)`\n\
                • Restart Docker Desktop (if using Desktop)\n\
                • On Linux, restart Docker daemon: `sudo systemctl restart docker`\n\
                • Check for port conflicts: `lsof -i :4000-4002`\n\
                • Dockerless mode: check logs in .moose/native_infra/\n\
                • Docker mode: check if Docker is running with `docker info`\n\
                • Docker mode: stop existing containers with `docker stop $(docker ps -aq)`\n\
                • If the issue persists, you can increase the timeout in your Moose configuration:\n\
                  [dev]\n\
                  infrastructure_timeout_seconds = 120\n\n\
                For more help, visit: https://docs.moosejs.com/help/troubleshooting"
        );

        let details = format_local_infrastructure_error(&error, true);

        assert_does_not_suggest_dockerless(
            &details,
            "Failed to run local infrastructure: Infrastructure startup and validation timed out after 60 seconds."
        );
    }

    #[test]
    fn dev_infrastructure_error_does_not_suggest_dockerless_for_unrelated_finch_missing_files() {
        let error = anyhow::anyhow!(
            "Failed: unable to read finch-config.yaml: No such file or directory (os error 2)"
        );

        let details = format_local_infrastructure_error(&error, true);

        assert_does_not_suggest_dockerless(
            &details,
            "Failed to run local infrastructure: Failed: unable to read finch-config.yaml: No such file or directory (os error 2)"
        );
    }

    #[test]
    fn dev_infrastructure_error_does_not_suggest_dockerless_for_unrelated_missing_files() {
        let error = anyhow::anyhow!(
            "Failed: unable to read config.yaml: No such file or directory (os error 2)"
        );

        let details = format_local_infrastructure_error(&error, true);

        assert_does_not_suggest_dockerless(
            &details,
            "Failed to run local infrastructure: Failed: unable to read config.yaml: No such file or directory (os error 2)"
        );
    }

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

        let project =
            Project::load_from_current_dir(crate::utilities::dotenv::MooseEnvironment::Development)
                .unwrap();

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
        crate::test_utils::ensure_test_environment();

        let cli = Cli::parse_from(["moose", "template", "list"]);

        let config = read_settings().unwrap();
        let machine_id = get_or_create_machine_id();

        let result = top_command_handler(config, &cli.command, machine_id).await;

        assert!(
            result.is_ok(),
            "Failed to list templates: {:?}",
            result.err()
        );
        let success_message = result.unwrap().message.details;

        // Basic check to see if the output contains expected template info structure
        assert!(success_message.contains("Available templates for version"));
        assert!(success_message.contains("- typescript (typescript)"));
        assert!(success_message.contains("- python (python)"));
    }
}
