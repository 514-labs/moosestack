/// # File Watcher Module
///
/// This module provides functionality for watching file changes in the project directory
/// and triggering infrastructure updates based on those changes. It monitors files in the
/// app directory and debounces updates to prevent excessive reloads while changes are being made.
///
/// The watcher uses the `notify` crate to detect file system events and processes them
/// to update the infrastructure map, which is then used to apply changes to the system.
///
/// ## Main Components:
/// - `FileWatcher`: The main struct that initializes and starts the file watching process
/// - `EventListener`: Handles file system events and forwards them to the processing pipeline
/// - `EventBuckets`: Tracks changes in the app directory with debouncing
///
/// ## Process Flow:
/// 1. The watcher monitors the project directory for file changes
/// 2. When changes are detected, they are tracked in EventBuckets
/// 3. After a short delay (debouncing), changes are processed to update the infrastructure
/// 4. The updated infrastructure is applied to the system
use crate::framework;
use log::info;
use notify::event::ModifyKind;
use notify::{Event, EventHandler, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use std::{io::Error, path::PathBuf};
use tokio::sync::RwLock;

use crate::framework::core::infrastructure_map::{ApiChange, InfrastructureMap};

use super::display::{self, with_spinner_completion_async, Message, MessageType};
use super::settings::Settings;

use crate::cli::routines::openapi::openapi;
use crate::infrastructure::processes::process_registry::ProcessRegistries;
use crate::infrastructure::redis::redis_client::RedisClient;
use crate::metrics::Metrics;
use crate::project::Project;
use crate::utilities::PathExt;

/// Event listener that receives file system events and forwards them to the event processing pipeline.
/// It uses a watch channel to communicate with the main processing loop.
struct EventListener {
    tx: tokio::sync::watch::Sender<EventBuckets>,
}

impl EventHandler for EventListener {
    fn handle_event(&mut self, event: notify::Result<Event>) {
        log::debug!("Received Watcher event: {:?}", event);
        match event {
            Ok(event) => {
                self.tx.send_if_modified(|events| {
                    events.insert(event);
                    !events.is_empty()
                });
            }
            Err(e) => {
                log::error!("Watcher Error: {:?}", e);
            }
        }
    }
}

/// Container for tracking file system events in the app directory.
/// Implements debouncing by tracking changes until they are processed.
#[derive(Default, Debug)]
struct EventBuckets {
    changes: HashSet<PathBuf>,
}

impl EventBuckets {
    /// Checks if there are no pending changes
    pub fn is_empty(&self) -> bool {
        self.changes.is_empty()
    }

    /// Processes a file system event and tracks it if it's relevant.
    /// Only processes events that are relevant (create, modify, remove) and
    /// ignores metadata changes and access events.
    pub fn insert(&mut self, event: Event) {
        match event.kind {
            EventKind::Access(_) | EventKind::Modify(ModifyKind::Metadata(_)) => return,
            EventKind::Any
            | EventKind::Create(_)
            | EventKind::Modify(_)
            | EventKind::Remove(_)
            | EventKind::Other => {}
        };

        for path in event.paths {
            if !path.ext_is_supported_lang() {
                continue;
            }
            self.changes.insert(path);
        }

        info!("App directory changes detected: {:?}", self.changes);
    }
}

/// Main watching function that monitors the project directory for changes and
/// processes them to update the infrastructure.
///
/// This function runs in a loop, waiting for file system events, then waits for a period
/// of inactivity (debouncing) before processing the changes to update the infrastructure
/// map and apply changes to the system.
///
/// # Arguments
/// * `project` - The project configuration
/// * `route_update_channel` - Channel for sending API route updates
/// * `infrastructure_map` - The current infrastructure map
/// * `project_registries` - Registry for all processes including syncing processes
/// * `metrics` - Metrics collection
/// * `redis_client` - Redis client for state management
/// * `settings` - CLI settings configuration
#[allow(clippy::too_many_arguments)]
async fn watch(
    project: Arc<Project>,
    route_update_channel: tokio::sync::mpsc::Sender<(InfrastructureMap, ApiChange)>,
    infrastructure_map: &'static RwLock<InfrastructureMap>,
    project_registries: Arc<RwLock<ProcessRegistries>>,
    metrics: Arc<Metrics>,
    redis_client: Arc<RedisClient>,
    settings: Settings,
) -> Result<(), anyhow::Error> {
    log::debug!(
        "Starting file watcher for project: {:?}",
        project.app_dir().display()
    );

    let (tx, mut rx) = tokio::sync::watch::channel(EventBuckets::default());
    let receiver_ack = tx.clone();

    let mut watcher = RecommendedWatcher::new(EventListener { tx }, notify::Config::default())
        .map_err(|e| Error::other(format!("Failed to create file watcher: {e}")))?;

    watcher
        .watch(project.app_dir().as_ref(), RecursiveMode::Recursive)
        .map_err(|e| Error::other(format!("Failed to watch file: {e}")))?;

    log::debug!("Watcher setup complete, entering main loop");

    loop {
        tokio::select! {
            Ok(()) = rx.changed() => {
                log::debug!("Received change notification, current changes: {:?}", rx.borrow());
            }
            _ = tokio::time::sleep(Duration::from_secs(1)) => {
                let should_process = {
                    let current_changes = rx.borrow();
                    !current_changes.is_empty()
                };

                if should_process {
                    log::debug!("Debounce period elapsed, processing changes");
                    receiver_ack.send_replace(EventBuckets::default());
                    rx.mark_unchanged();

                    let result: anyhow::Result<()> = with_spinner_completion_async(
                        "Processing Infrastructure changes from file watcher",
                        "Infrastructure changes processed successfully",
                        async {
                            let plan_result =
                                framework::core::plan::plan_changes(&redis_client, &project).await;

                            match plan_result {
                                Ok((_, plan_result)) => {

                                    framework::core::plan_validator::validate(&project, &plan_result)?;

                                    display::show_changes(&plan_result);
                                    let mut project_registries = project_registries.write().await;
                                    match framework::core::execute::execute_online_change(
                                        &project,
                                        &plan_result,
                                        route_update_channel.clone(),
                                        &mut project_registries,
                                        metrics.clone(),
                                        &settings,
                                    )
                                    .await
                                    {
                                        Ok(_) => {
                                            plan_result
                                                .target_infra_map
                                                .store_in_redis(&redis_client)
                                                .await?;

                                            let _openapi_file =
                                                openapi(&project, &plan_result.target_infra_map).await?;

                                            let mut infra_ptr = infrastructure_map.write().await;
                                            *infra_ptr = plan_result.target_infra_map
                                        }
                                        Err(e) => {
                                            let error: anyhow::Error = e.into();
                                            show_message!(MessageType::Error, {
                                                Message {
                                                    action: "\nFailed".to_string(),
                                                    details: format!(
                                                        "Executing changes to the infrastructure failed:\n{error:?}"
                                                    ),
                                                }
                                            });
                                        }
                                    }
                                }
                                Err(e) => {
                                    let error: anyhow::Error = e.into();
                                    show_message!(MessageType::Error, {
                                        Message {
                                            action: "\nFailed".to_string(),
                                            details: format!(
                                                "Planning changes to the infrastructure failed:\n{error:?}"
                                            ),
                                        }
                                    });
                                }
                            }
                            Ok(())
                        },
                        !project.is_production,
                    )
                    .await;
                    match result {
                        Ok(()) => {
                            project
                                .http_server_config
                                .run_after_dev_server_reload_script()
                                .await;
                        }
                        Err(e) => {
                            show_message!(MessageType::Error, {
                                Message {
                                    action: "Failed".to_string(),
                                    details: format!("Processing Infrastructure changes failed:\n{e:?}"),
                                }
                            });
                        }
                    }
                }
            }
        }
    }
}

/// File watcher that monitors project files for changes and triggers infrastructure updates.
///
/// This struct provides the main interface for starting the file watching process.
pub struct FileWatcher;

impl FileWatcher {
    /// Creates a new FileWatcher instance
    pub fn new() -> Self {
        Self {}
    }

    /// Starts the file watching process.
    ///
    /// This method initializes the watcher and spawns a background task to monitor
    /// file changes and process them.
    ///
    /// # Arguments
    /// * `project` - The project configuration
    /// * `route_update_channel` - Channel for sending API route updates
    /// * `infrastructure_map` - The current infrastructure map
    /// * `project_registries` - Registry for all processes including syncing processes
    /// * `metrics` - Metrics collection
    /// * `redis_client` - Redis client for state management
    /// * `settings` - CLI settings configuration
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        &self,
        project: Arc<Project>,
        route_update_channel: tokio::sync::mpsc::Sender<(InfrastructureMap, ApiChange)>,
        infrastructure_map: &'static RwLock<InfrastructureMap>,
        project_registries: Arc<RwLock<ProcessRegistries>>,
        metrics: Arc<Metrics>,
        redis_client: Arc<RedisClient>,
        settings: Settings,
    ) -> Result<(), Error> {
        show_message!(MessageType::Info, {
            Message {
                action: "Watching".to_string(),
                details: format!("{:?}", project.app_dir().display()),
            }
        });

        // Move everything into the spawned task to avoid Send issues
        let watch_task = async move {
            watch(
                project,
                route_update_channel,
                infrastructure_map,
                project_registries,
                metrics,
                redis_client,
                settings,
            )
            .await
        };

        tokio::spawn(watch_task);

        Ok(())
    }
}
