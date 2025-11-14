//! # Routines [Deprecation warning]
//!
//! *****
//! Routines that get run by a CLI should simply be a function that returns a routine success or routine failure. Do not use
//! the Routine and Routine controller structs and traits
//! *****
//!
//!
//! This module is used to define routines that can be run by the CLI. Routines are a collection of operations that are run in
//! sequence. They can be run silently or explicitly. When run explicitly, they display messages to the user. When run silently,
//! they do not display any messages to the user.
//!
//! ## Example
//! ```
//! use crate::cli::routines::{Routine, RoutineSuccess, RoutineFailure, RunMode};
//! use crate::cli::display::{Message, MessageType};
//!
//! struct HelloWorldRoutine {}
//! impl HelloWorldRoutine {
//!    pub fn new() -> Self {
//!       Self {}
//!   }
//! }
//! impl Routine for HelloWorldRoutine {
//!   fn run_silent(&self) -> Result<RoutineSuccess, RoutineFailure> {
//!      Ok(RoutineSuccess::success(Message::new("Hello".to_string(), "world".to_string())))
//!  }
//! }
//!
//! let routine_controller = RoutineController::new();
//! routine_controller.add_routine(Box::new(HelloWorldRoutine::new()));
//! let results = routine_controller.run_silent_routines();
//!
//! assert_eq!(results.len(), 1);
//! assert!(results[0].is_ok());
//! assert_eq!(results[0].as_ref().unwrap().message_type, MessageType::Success);
//! assert_eq!(results[0].as_ref().unwrap().message.action, "Hello");
//! assert_eq!(results[0].as_ref().unwrap().message.details, "world");
//! ```
//!
//! ## Routine
//! The `Routine` trait defines the interface for a routine. It has three methods:
//! - `run` - This method runs the routine and returns a result. It takes a `RunMode` as an argument. The `RunMode` enum defines
//!   the different ways that a routine can be run. It can be run silently or explicitly. When run explicitly, it displays messages
//!   to the user. When run silently, it does not display any messages to the user.
//! - `run_silent` - This method runs the routine and returns a result without displaying any messages to the user.
//! - `run_explicit` - This method runs the routine and displays messages to the user.
//!
//! ## RoutineSuccess
//! The `RoutineSuccess` struct is used to return a successful result from a routine. It contains a `Message` and a `MessageType`.
//! The `Message` is the message that will be displayed to the user. The `MessageType` is the type of message that will be displayed
//! to the user. The `MessageType` enum defines the different types of messages that can be displayed to the user.
//!
//! ## RoutineFailure
//! The `RoutineFailure` struct is used to return a failure result from a routine. It contains a `Message`, a `MessageType`, and an
//! `Error`. The `Message` is the message that will be displayed to the user. The `MessageType` is the type of message that will be
//! displayed to the user. The `MessageType` enum defines the different types of messages that can be displayed to the user. The `Error`
//! is the error that caused the routine to fail.
//!
//! ## RunMode
//! The `RunMode` enum defines the different ways that a routine can be run. It can be run silently or explicitly. When run explicitly,
//! it displays messages to the user. When run silently, it does not display any messages to the user.
//!
//! ## RoutineController
//! The `RoutineController` struct is used to run a collection of routines. It contains a vector of `Box<dyn Routine>`. It has the
//! following methods:
//! - `new` - This method creates a new `RoutineController`.
//! - `add_routine` - This method adds a routine to the `RoutineController`.
//! - `run_routines` - This method runs all of the routines in the `RoutineController` and returns a vector of results. It takes a
//!   `RunMode` as an argument. The `RunMode` enum defines the different ways that a routine can be run. It can be run silently or
//!   explicitly. When run explicitly, it displays messages to the user. When run silently, it does not display any messages to the user.
//! - `run_silent_routines` - This method runs all of the routines in the `RoutineController` and returns a vector of results without
//!   displaying any messages to the user.
//! - `run_explicit_routines` - This method runs all of the routines in the `RoutineController` and returns a vector of results while
//!   displaying messages to the user.
//!
//! ## Start Development Mode
//! The `start_development_mode` function is used to start the file watcher and the webserver. It takes a `ClickhouseConfig` and a
//! `RedpandaConfig` as arguments. The `ClickhouseConfig` is used to configure the Clickhouse database. The `RedpandaConfig` is used
//! to configure the Redpanda stream processor. This is a special routine due to it's async nature.
//!
//! ## Suggested Improvements
//! - Explore using a RWLock instead of a Mutex to ensure concurrent reads without locks
//! - Simplify the API for the user when using RunMode::Explicit since it creates lifetime and ownership issues
//! - Enable creating nested routines and cascading down the RunMode to show messages to the user
//! - Organize routines better in the file hiearchy
//!

use crate::cli::local_webserver::{IntegrateChangesRequest, RouteMeta};
use crate::cli::routines::code_generation::prompt_user_for_remote_ch_http;
use crate::cli::routines::openapi::openapi;
use crate::framework::core::execute::{execute_initial_infra_change, ExecutionContext};
use crate::framework::core::infra_reality_checker::InfraDiscrepancies;
use crate::framework::core::infrastructure_map::{
    compute_table_columns_diff, InfrastructureMap, OlapChange, TableChange,
};
use crate::framework::core::migration_plan::{MigrationPlan, MigrationPlanWithBeforeAfter};
use crate::framework::core::plan_validator;
use crate::infrastructure::redis::redis_client::RedisClient;
use crate::project::Project;
use log::{debug, error, info, warn};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{interval, Duration};

use super::super::metrics::Metrics;
use super::local_webserver::{PlanRequest, PlanResponse, Webserver};
use super::settings::{set_suppress_dev_setup_prompt, Settings};
use super::watcher::FileWatcher;
use super::{display, prompt_user};
use super::{Message, MessageType};

use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::framework::core::plan::plan_changes;
use crate::framework::core::plan::InfraPlan;
use crate::framework::core::primitive_map::PrimitiveMap;
use crate::framework::core::state_storage::StateStorageBuilder;
use crate::infrastructure::olap::clickhouse::{check_ready, create_client};
use crate::infrastructure::olap::OlapOperations;
use crate::infrastructure::orchestration::temporal_client::{
    manager_from_project_if_enabled, probe_temporal,
};
use crate::infrastructure::stream::kafka::client::fetch_topics;
use crate::utilities::constants::{KEY_REMOTE_CLICKHOUSE_URL, MIGRATION_FILE, STORE_CRED_PROMPT};
use crate::utilities::keyring::{KeyringSecretRepository, SecretRepository};

async fn maybe_warmup_connections(project: &Project, redis_client: &Arc<RedisClient>) {
    if std::env::var("MOOSE_CONNECTION_POOL_WARMUP").is_ok() {
        // ClickHouse
        if project.features.olap {
            let client = create_client(project.clickhouse_config.clone());
            let _ = check_ready(&client).await;
        }

        // Redis
        {
            let mut cm = redis_client.connection_manager.clone();
            let _ = cm.ping().await;
        }

        // Kafka/Redpanda
        if project.features.streaming_engine {
            let _ = fetch_topics(&project.redpanda_config).await;
        }

        // Temporal (if workflows feature enabled)
        if let Some(manager) = manager_from_project_if_enabled(project) {
            let namespace = project.temporal_config.namespace.clone();
            let _ = probe_temporal(&manager, namespace, "warmup").await;
        }
    }
}

pub mod auth;
pub mod build;
pub mod clean;
pub mod code_generation;
pub mod dev;
pub mod docker_packager;
pub mod kafka_pull;
pub mod logs;
pub mod ls;
pub mod metrics_console;
pub mod migrate;
pub mod openapi;
pub mod peek;
pub mod ps;
pub mod scripts;
pub mod seed_data;
pub mod templates;
pub mod truncate_table;
mod util;
pub mod validate;

const LEADERSHIP_LOCK_RENEWAL_INTERVAL: u64 = 5; // 5 seconds

// Static flag to track if leadership tasks are running
static IS_RUNNING_LEADERSHIP_TASKS: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone)]
#[must_use = "The message should be displayed."]
pub struct RoutineSuccess {
    pub message: Message,
    pub message_type: MessageType,
}

impl From<RoutineFailure> for anyhow::Error {
    fn from(failure: RoutineFailure) -> Self {
        if let Some(err) = failure.error {
            err
        } else {
            anyhow::anyhow!("{}: {}", failure.message.action, failure.message.details)
        }
    }
}

// Implement success and info contructors and a new constructor that lets the user choose which type of message to display
impl RoutineSuccess {
    pub fn success(message: Message) -> Self {
        Self {
            message,
            message_type: MessageType::Success,
        }
    }

    pub fn highlight(message: Message) -> Self {
        Self {
            message,
            message_type: MessageType::Highlight,
        }
    }

    pub fn show(&self) {
        display::show_message_wrapper(self.message_type, self.message.clone());
    }
}

#[derive(Debug)]
pub struct RoutineFailure {
    pub message: Message,
    pub message_type: MessageType,
    pub error: Option<anyhow::Error>,
}
impl RoutineFailure {
    pub fn new<F: Into<anyhow::Error>>(message: Message, error: F) -> Self {
        Self {
            message,
            message_type: MessageType::Error,
            error: Some(error.into()),
        }
    }

    /// create a RoutineFailure error without an error
    pub fn error(message: Message) -> Self {
        Self {
            message,
            message_type: MessageType::Error,
            error: None,
        }
    }
}

pub async fn setup_redis_client(project: Arc<Project>) -> anyhow::Result<Arc<RedisClient>> {
    let redis_client = RedisClient::new(project.name(), project.redis_config.clone()).await?;
    let redis_client = Arc::new(redis_client);

    let (service_name, instance_id) = {
        (
            redis_client.get_service_name().to_string(),
            redis_client.get_instance_id().to_string(),
        )
    };

    display::show_message_wrapper(
        MessageType::Info,
        Message {
            action: "Node Id:".to_string(),
            details: format!("{service_name}::{instance_id}"),
        },
    );

    let redis_client_clone = redis_client.clone();
    let callback = Arc::new(move |message: String| {
        let redis_client = redis_client_clone.clone();
        tokio::spawn(async move {
            if let Err(e) = process_pubsub_message(message, redis_client).await {
                error!("<RedisClient> Error processing pubsub message: {}", e);
            }
        });
    });

    // Start the leadership lock management task (for DDL migrations and OLAP operations)
    start_leadership_lock_task(redis_client.clone());

    redis_client.register_message_handler(callback).await;
    redis_client.start_periodic_tasks();

    Ok(redis_client)
}

fn start_leadership_lock_task(redis_client: Arc<RedisClient>) {
    tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(LEADERSHIP_LOCK_RENEWAL_INTERVAL)); // Adjust the interval as needed

        loop {
            interval.tick().await;
            if let Err(e) = manage_leadership_lock(&redis_client).await {
                error!("<RedisClient> Error managing leadership lock: {:#}", e);
            }
        }
    });
}

async fn manage_leadership_lock(redis_client: &Arc<RedisClient>) -> Result<(), anyhow::Error> {
    let (has_lock, is_new_acquisition) = redis_client.check_and_renew_lock("leadership").await?;

    if has_lock && is_new_acquisition {
        info!("<RedisClient> Obtained leadership lock, performing leadership tasks");

        IS_RUNNING_LEADERSHIP_TASKS.store(true, Ordering::SeqCst);

        tokio::spawn(async move {
            IS_RUNNING_LEADERSHIP_TASKS.store(false, Ordering::SeqCst);
        });

        if let Err(e) = redis_client.broadcast_message("leader.new").await {
            error!("Failed to broadcast new leader message: {}", e);
        }
    } else if IS_RUNNING_LEADERSHIP_TASKS.load(Ordering::SeqCst) {
        // Then mark leadership tasks as not running
        IS_RUNNING_LEADERSHIP_TASKS.store(false, Ordering::SeqCst);
    }
    Ok(())
}

async fn process_pubsub_message(
    message: String,
    redis_client: Arc<RedisClient>,
) -> anyhow::Result<()> {
    let has_lock = redis_client.has_lock("leadership").await?;

    if has_lock {
        if message.contains("<migration_start>") {
            info!("<Routines> This instance is the leader so ignoring the Migration start message: {}", message);
        } else if message.contains("<migration_end>") {
            info!("<Routines> This instance is the leader so ignoring the Migration end message received: {}", message);
        } else {
            info!(
                "<Routines> This instance is the leader and received pubsub message: {}",
                message
            );
        }
    } else {
        // this assumes that the leader is not doing inserts during migration
        if message.contains("<migration_start>") {
            info!("Should be pausing write to CH from Kafka");
        } else if message.contains("<migration_end>") {
            info!("Should be resuming write to CH from Kafka");
        } else {
            info!(
                "<Routines> This instance is not the leader and received pubsub message: {}",
                message
            );
        }
    }
    Ok(())
}

/// Starts the application in development mode.
/// This mode is optimized for development workflows and includes additional debugging features.
///
/// # Arguments
/// * `project` - Arc wrapped Project instance containing configuration
/// * `metrics` - Arc wrapped Metrics instance for monitoring
/// * `redis_client` - Arc and Mutex wrapped RedisClient for caching
/// * `settings` - Reference to application Settings
///
/// # Returns
/// * `anyhow::Result<()>` - Success or error result
pub async fn start_development_mode(
    project: Arc<Project>,
    metrics: Arc<Metrics>,
    redis_client: Arc<RedisClient>,
    settings: &Settings,
    enable_mcp: bool,
) -> anyhow::Result<()> {
    display::show_message_wrapper(
        MessageType::Info,
        Message {
            action: "Starting".to_string(),
            details: "development mode".to_string(),
        },
    );

    let server_config = project.http_server_config.clone();
    let web_server = Webserver::new(
        server_config.host.clone(),
        server_config.port,
        server_config.management_port,
    );

    let consumption_apis: &'static RwLock<HashSet<String>> =
        Box::leak(Box::new(RwLock::new(HashSet::new())));

    let web_apps: &'static RwLock<HashSet<String>> =
        Box::leak(Box::new(RwLock::new(HashSet::new())));

    let route_table = HashMap::<PathBuf, RouteMeta>::new();
    let route_table: &'static RwLock<HashMap<PathBuf, RouteMeta>> =
        Box::leak(Box::new(RwLock::new(route_table)));

    let route_update_channel = web_server
        .spawn_api_update_listener(project.clone(), route_table, consumption_apis)
        .await;

    let webapp_update_channel = web_server.spawn_webapp_update_listener(web_apps).await;

    // Create state storage once based on project configuration
    let state_storage = StateStorageBuilder::from_config(&project)
        .clickhouse_config(Some(project.clickhouse_config.clone()))
        .redis_client(Some(&redis_client))
        .build()
        .await?;

    let (_, plan) = plan_changes(&*state_storage, &project).await?;

    let externally_managed: Vec<_> = plan
        .target_infra_map
        .tables
        .values()
        .filter(|t| t.life_cycle == LifeCycle::ExternallyManaged)
        .collect();
    if !externally_managed.is_empty() {
        show_message!(
            MessageType::Info,
            Message::new(
                "Secret".to_string(),
                "Fetching stored remote URL, you may see a pop up asking for your authorization."
                    .to_string()
            )
        );
        let repo = KeyringSecretRepository;
        let project_name = project.name();
        match repo.get(&project_name, KEY_REMOTE_CLICKHOUSE_URL) {
            Ok(stored) => {
                let remote_clickhouse_url = match stored {
                    Some(url) => Some(url),
                    None if settings.dev.suppress_dev_setup_prompt => None,
                    None => {
                        display::show_message_wrapper(
                            MessageType::Info,
                            Message::new("Info".to_string(), STORE_CRED_PROMPT.to_string()),
                        );
                        let setup_choice =
                            prompt_user("Do you want to set this up now (Y/n)?", Some("Y"), None)?;
                        if matches!(
                            setup_choice.trim().to_lowercase().as_str(),
                            "" | "y" | "yes"
                        ) {
                            let url = prompt_user_for_remote_ch_http()?;
                            match repo.store(&project_name, KEY_REMOTE_CLICKHOUSE_URL, &url) {
                                Ok(()) => display::show_message_wrapper(
                                    MessageType::Success,
                                    Message::new(
                                        "Keychain".to_string(),
                                        format!(
                                            "Saved ClickHouse connection string for project '{}'.",
                                            project_name
                                        ),
                                    ),
                                ),
                                Err(e) => {
                                    display::show_message_wrapper(
                                        MessageType::Error,
                                        Message::new(
                                            "Keychain".to_string(),
                                            format!("Failed to store connection string: {e:?}"),
                                        ),
                                    );
                                    warn!("Failed to store connection string: {e:?}")
                                }
                            }

                            Some(url)
                        } else {
                            let again_choice =prompt_user(
                                "Do you want me to ask you this again next time you run `moose dev` (Y/n)",
                                Some("Y"),
                                None,
                            )?;
                            if !matches!(
                                again_choice.trim().to_lowercase().as_str(),
                                "" | "y" | "yes"
                            ) {
                                if let Err(e) = set_suppress_dev_setup_prompt(true) {
                                    show_message!(
                                        MessageType::Error,
                                        Message {
                                            action: "Failed".to_string(),
                                            details: "to write suppression flag to config"
                                                .to_string(),
                                        }
                                    );
                                    log::warn!("Failed to write suppression flag to config: {e:?}");
                                }
                            }
                            None
                        }
                    }
                };
                if let Some(ref remote_url) = remote_clickhouse_url {
                    let (client, db) = code_generation::create_client_and_db(remote_url).await?;
                    let (tables, _unsupported) = client.list_tables(&db, &project).await?;
                    let tables: HashMap<_, _> =
                        tables.into_iter().map(|t| (t.name.clone(), t)).collect();

                    let changed = externally_managed.iter().any(|t| {
                        if let Some(remote_table) = tables.get(&t.name) {
                            !compute_table_columns_diff(t, remote_table).is_empty()
                                || !remote_table.order_by_equals(t)
                                || t.engine != remote_table.engine
                        } else {
                            true
                        }
                    });
                    if changed {
                        show_message!(
                            MessageType::Highlight,
                            Message {
                                action: "Remote".to_string(),
                                details: "change detected in externally managed tables. Run `moose db pull` to regenerate.".to_string(),
                            }
                        );
                    }
                }
            }
            Err(e) => {
                show_message!(
                    MessageType::Error,
                    Message {
                        action: "Secret".to_string(),
                        details: format!("failed to fetch stored remote URL. {e:?}")
                    }
                );
            }
        };
    }

    maybe_warmup_connections(&project, &redis_client).await;

    plan_validator::validate(&project, &plan)?;

    let api_changes_channel = web_server
        .spawn_api_update_listener(project.clone(), route_table, consumption_apis)
        .await;

    let webapp_changes_channel = web_server.spawn_webapp_update_listener(web_apps).await;

    let process_registry = execute_initial_infra_change(ExecutionContext {
        project: &project,
        settings,
        plan: &plan,
        skip_olap: false,
        api_changes_channel,
        webapp_changes_channel,
        metrics: metrics.clone(),
        redis_client: &redis_client,
    })
    .await?;

    let process_registry = Arc::new(RwLock::new(process_registry));

    let openapi_file = openapi(&project, &plan.target_infra_map).await?;

    state_storage
        .store_infrastructure_map(&plan.target_infra_map)
        .await?;

    let infra_map: &'static RwLock<InfrastructureMap> =
        Box::leak(Box::new(RwLock::new(plan.target_infra_map)));

    // Create processing coordinator to synchronize file watcher with MCP tools
    use crate::cli::processing_coordinator::ProcessingCoordinator;
    let processing_coordinator = ProcessingCoordinator::new();

    // Create shutdown channel for graceful watcher termination
    let (watcher_shutdown_tx, watcher_shutdown_rx) = tokio::sync::watch::channel(false);

    let file_watcher = FileWatcher::new();
    file_watcher.start(
        project.clone(),
        route_update_channel,
        webapp_update_channel,
        infra_map,
        process_registry.clone(),
        metrics.clone(),
        Arc::new(state_storage),
        settings.clone(),
        processing_coordinator.clone(),
        watcher_shutdown_rx,
    )?;

    // Log MCP server status
    if enable_mcp {
        display::show_message_wrapper(
            MessageType::Success,
            Message {
                action: "MCP".to_string(),
                details: format!(
                    "Model Context Protocol server available at http://{}:{}/mcp",
                    server_config.host, server_config.port
                ),
            },
        );
        info!("[MCP] MCP endpoint enabled at /mcp");
    } else {
        info!("[MCP] MCP server disabled via --mcp false flag");
    }

    info!("Starting web server...");
    web_server
        .start(
            settings,
            route_table,
            consumption_apis,
            web_apps,
            infra_map,
            project,
            metrics,
            Some(openapi_file),
            process_registry,
            enable_mcp,
            processing_coordinator,
            Some(watcher_shutdown_tx),
        )
        .await;

    Ok(())
}

/// Starts the application in production mode.
/// This mode is optimized for production use with appropriate security and performance settings.
///
/// # Arguments
/// * `settings` - Reference to application Settings
/// * `project` - Arc wrapped Project instance containing configuration
/// * `metrics` - Arc wrapped Metrics instance for monitoring
/// * `redis_client` - Arc and Mutex wrapped RedisClient for caching
///
/// # Returns
/// * `anyhow::Result<()>` - Success or error result
pub async fn start_production_mode(
    settings: &Settings,
    project: Arc<Project>,
    metrics: Arc<Metrics>,
    redis_client: Arc<RedisClient>,
) -> anyhow::Result<()> {
    display::show_message_wrapper(
        MessageType::Success,
        Message {
            action: "Starting".to_string(),
            details: "production mode".to_string(),
        },
    );

    if std::env::var("MOOSE_TEST__CRASH").is_ok() {
        panic!("Crashing for testing purposes");
    }

    let server_config = project.http_server_config.clone();
    info!("Server config: {:?}", server_config);
    let web_server = Webserver::new(
        server_config.host.clone(),
        server_config.port,
        server_config.management_port,
    );
    info!("Web server initialized");

    let consumption_apis: &'static RwLock<HashSet<String>> =
        Box::leak(Box::new(RwLock::new(HashSet::new())));
    info!("Analytics APIs initialized");

    let web_apps: &'static RwLock<HashSet<String>> =
        Box::leak(Box::new(RwLock::new(HashSet::new())));
    info!("Web apps initialized");

    let route_table = HashMap::<PathBuf, RouteMeta>::new();

    debug!("Route table: {:?}", route_table);
    let route_table: &'static RwLock<HashMap<PathBuf, RouteMeta>> =
        Box::leak(Box::new(RwLock::new(route_table)));

    // Create state storage once based on project configuration
    let state_storage = StateStorageBuilder::from_config(&project)
        .clickhouse_config(Some(project.clickhouse_config.clone()))
        .redis_client(Some(&redis_client))
        .build()
        .await?;

    let (current_state, plan) = plan_changes(&*state_storage, &project).await?;
    maybe_warmup_connections(&project, &redis_client).await;

    let execute_migration_yaml = project.features.ddl_plan && std::fs::exists(MIGRATION_FILE)?;

    if execute_migration_yaml {
        migrate::execute_migration_plan(
            &project,
            &project.clickhouse_config,
            &current_state.tables,
            &plan.target_infra_map,
            &*state_storage,
        )
        .await?;
    };

    plan_validator::validate(&project, &plan)?;

    let api_changes_channel = web_server
        .spawn_api_update_listener(project.clone(), route_table, consumption_apis)
        .await;

    let webapp_update_channel = web_server.spawn_webapp_update_listener(web_apps).await;

    let process_registry = execute_initial_infra_change(ExecutionContext {
        project: &project,
        settings,
        plan: &plan,
        skip_olap: execute_migration_yaml,
        api_changes_channel,
        webapp_changes_channel: webapp_update_channel,
        metrics: metrics.clone(),
        redis_client: &redis_client,
    })
    .await?;

    state_storage
        .store_infrastructure_map(&plan.target_infra_map)
        .await?;

    let infra_map: &'static InfrastructureMap = Box::leak(Box::new(plan.target_infra_map));

    // Create processing coordinator (unused in production but required for API consistency)
    use crate::cli::processing_coordinator::ProcessingCoordinator;
    let processing_coordinator = ProcessingCoordinator::new();

    web_server
        .start(
            settings,
            route_table,
            consumption_apis,
            web_apps,
            infra_map,
            project,
            metrics,
            None,
            Arc::new(RwLock::new(process_registry)),
            false, // MCP is disabled in production mode
            processing_coordinator,
            None, // No file watcher in production mode
        )
        .await;

    Ok(())
}

fn prepend_base_url(base_url: Option<&str>, path: &str) -> String {
    format!(
        "{}/{}",
        match base_url {
            Some(u) => u.trim_end_matches('/'),
            None => "http://localhost:4000",
        },
        path
    )
}

/// Custom error types for inframap retrieval operations
#[derive(thiserror::Error, Debug)]
pub enum InfraRetrievalError {
    #[error(
        "Inframap endpoint not found on server (404). Server may not support the new endpoint."
    )]
    EndpointNotFound,
    #[error("Authentication failed: {0}")]
    AuthenticationFailed(String),
    #[error("Network error: {0}")]
    NetworkError(String),
    #[error("Failed to parse response: {0}")]
    ParseError(String),
    #[error("Server error: {0}")]
    ServerError(String),
}

/// Retrieves the current infrastructure map from a remote Moose instance using the new admin/inframap endpoint
///
/// # Arguments
/// * `base_url` - Optional base URL of the remote instance (default: http://localhost:4000)
/// * `token` - API token for admin authentication
///
/// # Returns
/// * `Ok(InfrastructureMap)` - Successfully retrieved inframap
/// * `Err(InfraRetrievalError)` - Various error conditions including endpoint not found
pub(crate) async fn get_remote_inframap_protobuf(
    base_url: Option<&str>,
    token: &Option<String>,
) -> Result<InfrastructureMap, InfraRetrievalError> {
    let target_url = prepend_base_url(base_url, "admin/inframap");

    // Get authentication token
    let auth_token = token
        .clone()
        .or_else(|| std::env::var("MOOSE_ADMIN_TOKEN").ok())
        .ok_or_else(|| {
            InfraRetrievalError::AuthenticationFailed(
                "No authentication token provided".to_string(),
            )
        })?;

    // Create HTTP client and request
    let client = reqwest::Client::new();
    let response = client
        .get(&target_url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/protobuf")
        .header("Authorization", format!("Bearer {auth_token}"))
        .send()
        .await
        .map_err(|e| InfraRetrievalError::NetworkError(e.to_string()))?;

    // Handle different response status codes
    match response.status() {
        reqwest::StatusCode::OK => {
            let content_type = response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");

            if content_type.contains("application/protobuf") {
                // Parse protobuf response
                let bytes = response
                    .bytes()
                    .await
                    .map_err(|e| InfraRetrievalError::NetworkError(e.to_string()))?;

                InfrastructureMap::from_proto(bytes.to_vec()).map_err(|e| {
                    InfraRetrievalError::ParseError(format!("Failed to parse protobuf: {e}"))
                })
            } else {
                // Fallback to JSON response
                let json_response: super::local_webserver::InfraMapResponse =
                    response.json().await.map_err(|e| {
                        InfraRetrievalError::ParseError(format!("Failed to parse JSON: {e}"))
                    })?;
                Ok(json_response.infra_map)
            }
        }
        reqwest::StatusCode::NOT_FOUND => Err(InfraRetrievalError::EndpointNotFound),
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => {
            Err(InfraRetrievalError::AuthenticationFailed(
                "Invalid or missing authentication token".to_string(),
            ))
        }
        status => {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            Err(InfraRetrievalError::ServerError(format!(
                "HTTP {status}: {error_text}"
            )))
        }
    }
}

/// Normalizes an infrastructure map for backward compatibility
///
/// This function ensures consistent table IDs by recomputing them using the current
/// Table::id() logic. This is necessary because older CLI versions may have used
/// different ID computation strategies, causing tables to appear as "removed" and "added"
/// when they should be recognized as the same table.
///
/// # Arguments
/// * `infra_map` - The infrastructure map to normalize
///
/// # Returns
/// * `InfrastructureMap` - A new infrastructure map with normalized table IDs
fn normalize_inframap_engines(mut infra_map: InfrastructureMap) -> InfrastructureMap {
    // Rebuild the tables HashMap with correctly computed IDs
    // This ensures backward compatibility with older servers that may have used different ID logic
    let normalized_tables: std::collections::HashMap<
        String,
        crate::framework::core::infrastructure::table::Table,
    > = infra_map
        .tables
        .into_values()
        .map(|table| {
            let correct_id = table.id(&infra_map.default_database);
            (correct_id, table)
        })
        .collect();

    infra_map.tables = normalized_tables;
    infra_map
}

/// Calculates the diff between current and target infrastructure maps on the client side
///
/// # Arguments
/// * `current_map` - The current infrastructure map (from server)
/// * `target_map` - The target infrastructure map (from local project)
/// * `ignore_ops` - Operations to ignore during comparison (e.g., ModifyPartitionBy)
///
/// # Returns
/// * `InfraChanges` - The calculated changes needed to go from current to target
fn calculate_plan_diff_local(
    current_map: &InfrastructureMap,
    target_map: &InfrastructureMap,
    ignore_ops: &[crate::infrastructure::olap::clickhouse::IgnorableOperation],
) -> crate::framework::core::infrastructure_map::InfraChanges {
    use crate::infrastructure::olap::clickhouse::diff_strategy::ClickHouseTableDiffStrategy;

    let clickhouse_strategy = ClickHouseTableDiffStrategy;
    // planning about action on prod env, respect_life_cycle is true
    current_map.diff_with_table_strategy(target_map, &clickhouse_strategy, true, true, ignore_ops)
}

/// Legacy implementation of remote_plan using the existing /admin/plan endpoint
/// This is used as a fallback when the new /admin/inframap endpoint is not available
async fn legacy_remote_plan_logic(
    project: &Project,
    base_url: &Option<String>,
    token: &Option<String>,
) -> anyhow::Result<()> {
    // Build the inframap from the local project
    let local_infra_map = if project.features.data_model_v2 {
        debug!("Loading InfrastructureMap from user code (DMV2)");
        InfrastructureMap::load_from_user_code(project, true).await?
    } else {
        debug!("Loading InfrastructureMap from primitives");
        let primitive_map = PrimitiveMap::load(project).await?;
        InfrastructureMap::new(project, primitive_map)
    };

    // Use existing implementation
    let target_url = prepend_base_url(base_url.as_deref(), "admin/plan");

    display::show_message_wrapper(
        MessageType::Info,
        Message {
            action: "Remote Plan".to_string(),
            details: format!("Comparing local project code with remote instance at {target_url}"),
        },
    );

    let request_body = PlanRequest {
        infra_map: local_infra_map,
    };

    let auth_token = token
        .clone()
        .or_else(|| std::env::var("MOOSE_ADMIN_TOKEN").ok())
        .ok_or_else(|| anyhow::anyhow!("Authentication token required. Please provide token via --token parameter or MOOSE_ADMIN_TOKEN environment variable"))?;

    let client = reqwest::Client::new();
    let response = client
        .post(&target_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {auth_token}"))
        .json(&request_body)
        .send()
        .await?;

    if !response.status().is_success() {
        let error_text = response.text().await?;
        return Err(anyhow::anyhow!(
            "Failed to get plan from remote instance: {}",
            error_text
        ));
    }

    let plan_response: PlanResponse = response.json().await?;

    display::show_message_wrapper(
        MessageType::Success,
        Message {
            action: "Legacy Plan".to_string(),
            details: "Retrieved plan from remote instance using legacy endpoint".to_string(),
        },
    );

    if plan_response.changes.is_empty() {
        display::show_message_wrapper(
            MessageType::Info,
            Message {
                action: "No Changes".to_string(),
                details: "No changes detected".to_string(),
            },
        );
        return Ok(());
    }

    // Create a temporary InfraPlan to use with the show_changes function
    let temp_plan = InfraPlan {
        changes: plan_response.changes,
        target_infra_map: InfrastructureMap::new(project, PrimitiveMap::default()),
    };

    display::show_changes(&temp_plan);
    Ok(())
}

/// Authentication for remote plan requests:
///
/// When making requests to a remote Moose instance, authentication is required for admin operations.
/// The authentication token is sent as a Bearer token in the Authorization header.
///
/// The token is determined in the following order of precedence:
/// 1. Command line parameter: `--token <value>`
/// 2. Environment variable: `MOOSE_ADMIN_TOKEN`
/// 3. Project configuration: `authentication.admin_api_key` in moose.yaml
///
/// Note that the admin_api_key in the project configuration is typically stored in hashed form,
/// so options 1 or 2 are recommended for remote plan operations.
///
/// Simulates a plan command against a remote Moose instance
///
/// # Arguments
/// * `project` - Reference to the project
/// * `url` - Optional URL of the remote Moose instance (default: http://localhost:4000)
/// * `token` - Optional API token for authentication (overrides MOOSE_ADMIN_TOKEN env var)
///
/// # Returns
/// * Result indicating success or failure
pub async fn remote_plan(
    project: &Project,
    base_url: &Option<String>,
    token: &Option<String>,
    clickhouse_url: &Option<String>,
) -> anyhow::Result<()> {
    // Build the inframap from the local project
    let local_infra_map = if project.features.data_model_v2 {
        debug!("Loading InfrastructureMap from user code (DMV2)");
        InfrastructureMap::load_from_user_code(project, true).await?
    } else {
        debug!("Loading InfrastructureMap from primitives");
        let primitive_map = PrimitiveMap::load(project).await?;
        InfrastructureMap::new(project, primitive_map)
    };

    // Determine remote source based on provided arguments
    let remote_infra_map = if let Some(clickhouse_url) = clickhouse_url {
        // Serverless flow: connect directly to ClickHouse
        display::show_message_wrapper(
            MessageType::Info,
            Message {
                action: "Remote Plan".to_string(),
                details: "Comparing local project code with deployed infrastructure".to_string(),
            },
        );

        get_remote_inframap_serverless(project, clickhouse_url, None).await?
    } else {
        // Moose server flow
        display::show_message_wrapper(
            MessageType::Info,
            Message {
                action: "Remote Plan".to_string(),
                details: "Comparing local project code with remote Moose instance".to_string(),
            },
        );

        // Try new endpoint first, fallback to legacy if not available
        match get_remote_inframap_protobuf(base_url.as_deref(), token).await {
            Ok(infra_map) => {
                display::show_message_wrapper(
                    MessageType::Info,
                    Message {
                        action: "New Endpoint".to_string(),
                        details: "Successfully retrieved infrastructure map from /admin/inframap"
                            .to_string(),
                    },
                );
                infra_map
            }
            Err(InfraRetrievalError::EndpointNotFound) => {
                // Fallback to legacy logic
                display::show_message_wrapper(
                    MessageType::Info,
                    Message {
                        action: "Legacy Fallback".to_string(),
                        details: "New endpoint not available, using legacy /admin/plan endpoint"
                            .to_string(),
                    },
                );
                return legacy_remote_plan_logic(project, base_url, token).await;
            }
            Err(e) => {
                return Err(anyhow::anyhow!(
                    "Failed to retrieve infrastructure map: {}",
                    e
                ));
            }
        }
    };

    // Normalize both infra maps for older versions that didn't persist engine data
    // Default to MergeTree when engine is null (ClickHouse default)
    // Both remote and local need normalization for consistent comparison
    let remote_infra_map = normalize_inframap_engines(remote_infra_map);
    let local_infra_map = normalize_inframap_engines(local_infra_map);

    // Calculate and display changes
    let changes = calculate_plan_diff_local(
        &remote_infra_map,
        &local_infra_map,
        &project.migration_config.ignore_operations,
    );

    display::show_message_wrapper(
        MessageType::Success,
        Message {
            action: "Remote Plan".to_string(),
            details: "Calculated plan differences locally".to_string(),
        },
    );

    if changes.is_empty() {
        display::show_message_wrapper(
            MessageType::Info,
            Message {
                action: "No Changes".to_string(),
                details: "No changes detected".to_string(),
            },
        );
        return Ok(());
    }

    // Create a temporary InfraPlan to use with the show_changes function
    let temp_plan = InfraPlan {
        changes,
        target_infra_map: local_infra_map,
    };

    display::show_changes(&temp_plan);
    Ok(())
}

/// Remote source for migration generation
pub enum RemoteSource<'a> {
    /// Full Moose deployment with HTTP server
    Moose {
        url: &'a str,
        token: &'a Option<String>,
    },
    /// Serverless deployment (direct ClickHouse + optional Redis for state)
    Serverless {
        clickhouse_url: &'a str,
        redis_url: &'a Option<String>,
    },
}

pub async fn remote_gen_migration(
    project: &Project,
    remote: RemoteSource<'_>,
) -> anyhow::Result<MigrationPlanWithBeforeAfter> {
    use anyhow::Context;

    // Build the inframap from the local project
    // Resolve credentials for generating migration DDL with S3 tables
    let local_infra_map = if project.features.data_model_v2 {
        debug!("Loading InfrastructureMap from user code (DMV2)");
        InfrastructureMap::load_from_user_code(project, true).await?
    } else {
        debug!("Loading InfrastructureMap from primitives");
        let primitive_map = PrimitiveMap::load(project).await?;
        InfrastructureMap::new(project, primitive_map)
    };

    // Get remote infrastructure map based on source type
    let remote_infra_map = match remote {
        RemoteSource::Moose { url, token } => {
            display::show_message_wrapper(
                MessageType::Info,
                Message {
                    action: "Remote Plan".to_string(),
                    details: "Comparing local project code with remote Moose instance".to_string(),
                },
            );

            get_remote_inframap_protobuf(Some(url), token)
                .await
                .with_context(|| "Failed to retrieve infrastructure map".to_string())?
        }
        RemoteSource::Serverless {
            clickhouse_url,
            redis_url,
        } => {
            display::show_message_wrapper(
                MessageType::Info,
                Message {
                    action: "Remote Plan".to_string(),
                    details: "Comparing local project code with deployed infrastructure"
                        .to_string(),
                },
            );

            get_remote_inframap_serverless(project, clickhouse_url, redis_url.as_deref()).await?
        }
    };

    // Normalize both infra maps for older versions that didn't persist engine data
    // Default to MergeTree when engine is null (ClickHouse default)
    // Both remote and local need normalization for consistent comparison
    let remote_infra_map = normalize_inframap_engines(remote_infra_map);
    let local_infra_map = normalize_inframap_engines(local_infra_map);

    let changes = calculate_plan_diff_local(
        &remote_infra_map,
        &local_infra_map,
        &project.migration_config.ignore_operations,
    );

    display::show_message_wrapper(
        MessageType::Success,
        Message {
            action: "Remote Plan".to_string(),
            details: "Calculated plan differences locally".to_string(),
        },
    );

    let db_migration =
        MigrationPlan::from_infra_plan(&changes, &project.clickhouse_config.db_name)?;

    Ok(MigrationPlanWithBeforeAfter {
        remote_state: remote_infra_map,
        local_infra_map,
        db_migration,
    })
}

/// Get remote infrastructure map for serverless deployments
///
/// Loads state from Redis or ClickHouse (based on config), then reconciles with actual ClickHouse schema
async fn get_remote_inframap_serverless(
    project: &Project,
    clickhouse_url: &str,
    redis_url: Option<&str>,
) -> anyhow::Result<InfrastructureMap> {
    use crate::framework::core::plan::reconcile_with_reality;
    use crate::infrastructure::olap::clickhouse::config::parse_clickhouse_connection_string;
    use crate::infrastructure::olap::clickhouse::create_client;
    use std::collections::HashSet;

    let clickhouse_config = parse_clickhouse_connection_string(clickhouse_url)?;

    // Build state storage based on config
    let state_storage = StateStorageBuilder::from_config(project)
        .clickhouse_config(Some(clickhouse_config.clone()))
        .redis_url(redis_url.map(String::from))
        .build()
        .await?;

    let remote_infra_map = state_storage
        .load_infrastructure_map()
        .await?
        .unwrap_or_else(|| InfrastructureMap::empty_from_project(project));

    // Reconcile with actual database state to detect manual changes
    let reconciled_infra_map = if project.features.olap {
        let target_table_names: HashSet<String> = remote_infra_map.tables.keys().cloned().collect();

        // Create a separate client for reconciliation
        let reconcile_client = create_client(clickhouse_config.clone());

        reconcile_with_reality(
            project,
            &remote_infra_map,
            &target_table_names,
            reconcile_client,
        )
        .await?
    } else {
        remote_infra_map
    };

    Ok(reconciled_infra_map)
}

pub async fn remote_refresh(
    project: &Project,
    base_url: &Option<String>,
    token: &Option<String>,
) -> anyhow::Result<RoutineSuccess> {
    // Build the inframap from the local project
    let local_infra_map = if project.features.data_model_v2 {
        debug!("Loading InfrastructureMap from user code (DMV2)");
        InfrastructureMap::load_from_user_code(project, true).await?
    } else {
        debug!("Loading InfrastructureMap from primitives");
        let primitive_map = PrimitiveMap::load(project).await?;
        InfrastructureMap::new(project, primitive_map)
    };

    // Get authentication token - prioritize command line parameter, then env var, then project config
    let auth_token = token
        .clone()
        .or_else(|| std::env::var("MOOSE_ADMIN_TOKEN").ok())
        .ok_or_else(|| anyhow::anyhow!("Authentication token required. Please provide token via --token parameter or MOOSE_ADMIN_TOKEN environment variable"))?;

    let client = reqwest::Client::new();

    let reality_check_url = prepend_base_url(base_url.as_deref(), "admin/reality-check");
    display::show_message_wrapper(
        MessageType::Info,
        Message {
            action: "Remote State".to_string(),
            details: format!("Checking database state at {reality_check_url}"),
        },
    );

    let response = client
        .get(&reality_check_url)
        .header("Authorization", format!("Bearer {auth_token}"))
        .send()
        .await?;

    if !response.status().is_success() {
        let error_text = response.text().await?;
        return Err(anyhow::anyhow!(
            "Failed to get reality check from remote instance: {}",
            error_text
        ));
    }

    #[derive(Deserialize)]
    struct RealityCheckResponse {
        discrepancies: InfraDiscrepancies,
    }

    let reality_check: RealityCheckResponse = response.json().await?;
    debug!("Remote discrepancies: {:?}", reality_check.discrepancies);

    // Step 3: Find tables that exist both in local infra map and remote tables
    let mut tables_to_integrate = Vec::new();

    // mismatch between local and remote reality
    fn warn_about_mismatch(table_name: &str) {
        display::show_message_wrapper(
            MessageType::Highlight,
            Message {
                action: "Table".to_string(),
                details: format!(
                    "Table {table_name} in remote DB differs from local definition. It will not be integrated.",
                ),
            },
        );
    }

    for table in reality_check.discrepancies.unmapped_tables.iter().chain(
        // reality_check.discrepancies.mismatched_tables is about remote infra-map and remote reality
        // not to be confused with mismatch between local and remote reality in `warn_about_mismatch`
        reality_check
            .discrepancies
            .mismatched_tables
            .iter()
            .filter_map(|change| match change {
                OlapChange::Table(TableChange::Added(table)) => Some(table),
                OlapChange::Table(TableChange::Updated { after, .. }) => Some(after),
                _ => None,
            }),
    ) {
        if let Some(local_table) = local_infra_map
            .tables
            .values()
            .find(|t| t.name == table.name)
        {
            match InfrastructureMap::simple_table_diff(table, local_table) {
                None => {
                    debug!("Found matching table: {}", table.name);
                    tables_to_integrate.push(table.name.clone());
                }
                Some(_) => warn_about_mismatch(&table.name),
            }
        }
    }

    if tables_to_integrate.is_empty() {
        return Ok(RoutineSuccess::success(Message {
            action: "No Changes".to_string(),
            details: "No matching tables found to integrate".to_string(),
        }));
    }

    let integrate_url = prepend_base_url(base_url.as_deref(), "admin/integrate-changes");
    display::show_message_wrapper(
        MessageType::Info,
        Message {
            action: "Integrating".to_string(),
            details: format!(
                "Integrating {} table(s) into remote instance: {}",
                tables_to_integrate.len(),
                tables_to_integrate.join(", ")
            ),
        },
    );

    let response = client
        .post(&integrate_url)
        .header("Content-Type", "application/json")
        .json(&IntegrateChangesRequest {
            tables: tables_to_integrate,
        })
        .header("Authorization", format!("Bearer {auth_token}"))
        .send()
        .await?;

    if !response.status().is_success() {
        let error_text = response.text().await?;
        return Err(anyhow::anyhow!(
            "Failed to integrate changes: {}",
            error_text
        ));
    }

    Ok(RoutineSuccess::success(Message::new(
        "Changes".to_string(),
        "integrated.".to_string(),
    )))
}
