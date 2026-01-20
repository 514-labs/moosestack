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
/// - `WatcherConfig`: Configuration for ignore patterns to prevent infinite loops
///
/// ## Process Flow:
/// 1. The watcher monitors the project directory for file changes
/// 2. When changes are detected, they are tracked in EventBuckets
/// 3. Paths matching ignore patterns are filtered out
/// 4. After a short delay (debouncing), changes are processed to update the infrastructure
/// 5. The updated infrastructure is applied to the system
use crate::framework;
use crate::framework::core::infrastructure_map::{ApiChange, InfrastructureMap};
use display::with_timing_async;
use globset::{Glob, GlobSet, GlobSetBuilder};
use notify::event::ModifyKind;
use notify::{Event, EventHandler, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use std::{io::Error, path::PathBuf};
use tokio::sync::RwLock;
use tracing::info;

use super::display::{self, with_spinner_completion_async, Message, MessageType};
use super::processing_coordinator::ProcessingCoordinator;
use super::settings::Settings;

use crate::cli::routines::openapi::openapi;
use crate::framework::core::state_storage::StateStorage;
use crate::infrastructure::processes::process_registry::ProcessRegistries;
use crate::metrics::Metrics;
use crate::project::Project;
use crate::utilities::PathExt;

/// Configuration for the file watcher, including ignore patterns.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WatcherConfig {
    /// Glob patterns for paths to ignore (relative to app directory).
    /// Files matching these patterns will not trigger rebuilds.
    #[serde(default)]
    pub ignore_patterns: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum WatcherConfigError {
    #[error("Invalid glob pattern '{pattern}': {source}")]
    InvalidPattern {
        pattern: String,
        source: globset::Error,
    },
}

impl WatcherConfig {
    pub fn build_ignore_matcher(&self) -> Result<Option<GlobSet>, WatcherConfigError> {
        if self.ignore_patterns.is_empty() {
            return Ok(None);
        }

        let mut builder = GlobSetBuilder::new();
        for pattern in &self.ignore_patterns {
            let glob = Glob::new(pattern).map_err(|e| WatcherConfigError::InvalidPattern {
                pattern: pattern.clone(),
                source: e,
            })?;
            builder.add(glob);
        }

        let globset = builder.build().expect("all patterns already validated");

        Ok(Some(globset))
    }
}

/// Event listener that receives file system events and forwards them to the event processing pipeline.
/// It uses a watch channel to communicate with the main processing loop.
struct EventListener {
    tx: tokio::sync::watch::Sender<EventBuckets>,
}

impl EventHandler for EventListener {
    fn handle_event(&mut self, event: notify::Result<Event>) {
        tracing::debug!("Received Watcher event: {:?}", event);
        match event {
            Ok(event) => {
                self.tx.send_if_modified(|events| {
                    events.insert(event);
                    !events.is_empty()
                });
            }
            Err(e) => {
                tracing::error!("Watcher Error: {:?}", e);
            }
        }
    }
}

/// Container for tracking file system events in the app directory.
/// Implements debouncing by tracking changes until they are processed.
/// Supports ignore patterns to filter out paths that shouldn't trigger hot-reloads.
#[derive(Debug)]
struct EventBuckets {
    changes: HashSet<PathBuf>,
    ignore_matcher: Option<Arc<GlobSet>>,
    app_dir: PathBuf,
}

impl EventBuckets {
    pub fn new(ignore_matcher: Option<Arc<GlobSet>>, app_dir: PathBuf) -> Self {
        Self {
            changes: HashSet::new(),
            ignore_matcher,
            app_dir,
        }
    }

    /// Checks if there are no pending changes
    pub fn is_empty(&self) -> bool {
        self.changes.is_empty()
    }

    /// Checks if a path should be ignored based on configured patterns.
    /// Patterns are matched against the path relative to the app directory.
    fn is_ignored(&self, path: &Path) -> bool {
        if let Some(ref matcher) = self.ignore_matcher {
            if let Ok(relative) = path.strip_prefix(&self.app_dir) {
                let is_match = matcher.is_match(relative);
                if is_match {
                    tracing::debug!(
                        "Path {:?} (relative: {:?}) matches ignore pattern",
                        path,
                        relative
                    );
                }
                return is_match;
            }
        }
        false
    }

    /// Processes a file system event and tracks it if it's relevant.
    /// Only processes events that are relevant (create, modify, remove) and
    /// ignores metadata changes, access events, and paths matching ignore patterns.
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
            if self.is_ignored(&path) {
                continue;
            }
            self.changes.insert(path);
        }

        if !self.changes.is_empty() {
            info!("App directory changes detected: {:?}", self.changes);
        }
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
/// * `webapp_update_channel` - Channel for sending WebApp updates
/// * `infrastructure_map` - The current infrastructure map
/// * `project_registries` - Registry for all processes including syncing processes
/// * `metrics` - Metrics collection
/// * `state_storage` - State storage for managing infrastructure state
/// * `settings` - CLI settings configuration
/// * `processing_coordinator` - Coordinator for synchronizing with MCP tools
/// * `shutdown_rx` - Receiver to listen for shutdown signal
#[allow(clippy::too_many_arguments)]
async fn watch(
    project: Arc<Project>,
    route_update_channel: tokio::sync::mpsc::Sender<(InfrastructureMap, ApiChange)>,
    webapp_update_channel: tokio::sync::mpsc::Sender<
        crate::framework::core::infrastructure_map::WebAppChange,
    >,
    infrastructure_map: &'static RwLock<InfrastructureMap>,
    project_registries: Arc<RwLock<ProcessRegistries>>,
    metrics: Arc<Metrics>,
    state_storage: Arc<Box<dyn StateStorage>>,
    settings: Settings,
    processing_coordinator: ProcessingCoordinator,
    mut shutdown_rx: tokio::sync::watch::Receiver<bool>,
    ignore_matcher: Option<Arc<GlobSet>>,
    app_dir: PathBuf,
) -> Result<(), anyhow::Error> {
    tracing::debug!(
        "Starting file watcher for project: {:?}",
        project.app_dir().display()
    );

    if ignore_matcher.is_some() {
        info!(
            "File watcher configured with {} ignore pattern(s): {:?}",
            project.watcher_config.ignore_patterns.len(),
            project.watcher_config.ignore_patterns
        );
    }

    let (tx, mut rx) =
        tokio::sync::watch::channel(EventBuckets::new(ignore_matcher.clone(), app_dir.clone()));
    let receiver_ack = tx.clone();

    let mut watcher = RecommendedWatcher::new(EventListener { tx }, notify::Config::default())
        .map_err(|e| Error::other(format!("Failed to create file watcher: {e}")))?;

    watcher
        .watch(app_dir.as_ref(), RecursiveMode::Recursive)
        .map_err(|e| Error::other(format!("Failed to watch file: {e}")))?;

    tracing::debug!("Watcher setup complete, entering main loop");

    loop {
        tokio::select! {
            _ = shutdown_rx.changed() => {
                info!("Watcher received shutdown signal, stopping file monitoring");
                return Ok(());
            }
            Ok(()) = rx.changed() => {
                tracing::debug!("Received change notification, current changes: {:?}", rx.borrow().changes);
            }
            _ = tokio::time::sleep(Duration::from_secs(1)) => {
                let should_process = {
                    let current_changes = rx.borrow();
                    !current_changes.is_empty()
                };

                if should_process {
                    tracing::debug!("Debounce period elapsed, processing changes");
                    receiver_ack.send_replace(EventBuckets::new(ignore_matcher.clone(), app_dir.clone()));
                    rx.mark_unchanged();

                    // Begin processing - guard will mark complete on drop
                    let _processing_guard = processing_coordinator.begin_processing().await;

                    let result: anyhow::Result<()> = with_spinner_completion_async(
                        "Processing Infrastructure changes from file watcher",
                        "Infrastructure changes processed successfully",
                        async {
                            let plan_result = with_timing_async("Planning", async {
                                framework::core::plan::plan_changes(&**state_storage, &project).await
                            })
                            .await;

                            match plan_result {
                                Ok((_, plan_result)) => {
                                    with_timing_async("Validation", async {
                                        framework::core::plan_validator::validate(&project, &plan_result)
                                    })
                                    .await?;

                                    display::show_changes(&plan_result);
                                    let mut project_registries = project_registries.write().await;

                                    let execution_result = with_timing_async("Execution", async {
                                        framework::core::execute::execute_online_change(
                                            &project,
                                            &plan_result,
                                            route_update_channel.clone(),
                                            webapp_update_channel.clone(),
                                            &mut project_registries,
                                            metrics.clone(),
                                            &settings,
                                        )
                                        .await
                                    })
                                    .await;

                                    match execution_result {
                                        Ok(_) => {
                                            with_timing_async("Persist State", async {
                                                state_storage
                                                    .store_infrastructure_map(&plan_result.target_infra_map)
                                                    .await
                                            })
                                            .await?;

                                            with_timing_async("OpenAPI Gen", async {
                                                openapi(&project, &plan_result.target_infra_map).await
                                            })
                                            .await?;

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
                        {
                            use crate::cli::display::should_show_spinner;
                            should_show_spinner(project.is_production)
                        },
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
    /// * `webapp_update_channel` - Channel for sending WebApp updates
    /// * `infrastructure_map` - The current infrastructure map
    /// * `project_registries` - Registry for all processes including syncing processes
    /// * `metrics` - Metrics collection
    /// * `state_storage` - State storage for managing infrastructure state
    /// * `settings` - CLI settings configuration
    /// * `processing_coordinator` - Coordinator for synchronizing with MCP tools
    /// * `shutdown_rx` - Receiver to listen for shutdown signal
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        &self,
        project: Arc<Project>,
        route_update_channel: tokio::sync::mpsc::Sender<(InfrastructureMap, ApiChange)>,
        webapp_update_channel: tokio::sync::mpsc::Sender<
            crate::framework::core::infrastructure_map::WebAppChange,
        >,
        infrastructure_map: &'static RwLock<InfrastructureMap>,
        project_registries: Arc<RwLock<ProcessRegistries>>,
        metrics: Arc<Metrics>,
        state_storage: Arc<Box<dyn StateStorage>>,
        settings: Settings,
        processing_coordinator: ProcessingCoordinator,
        shutdown_rx: tokio::sync::watch::Receiver<bool>,
    ) -> Result<(), Error> {
        // Validate ignore patterns early so errors are shown to the user
        let ignore_matcher = project
            .watcher_config
            .build_ignore_matcher()
            .map_err(|e| Error::other(format!("Invalid watcher ignore pattern: {e}")))?
            .map(Arc::new);

        let app_dir = project.app_dir();

        show_message!(MessageType::Info, {
            Message {
                action: "Watching".to_string(),
                details: format!("{:?}", app_dir.display()),
            }
        });

        // Move everything into the spawned task to avoid Send issues
        let watch_task = async move {
            watch(
                project,
                route_update_channel,
                webapp_update_channel,
                infrastructure_map,
                project_registries,
                metrics,
                state_storage,
                settings,
                processing_coordinator,
                shutdown_rx,
                ignore_matcher,
                app_dir,
            )
            .await
        };

        tokio::spawn(watch_task);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_watcher_config_empty_patterns_returns_none() {
        let config = WatcherConfig {
            ignore_patterns: vec![],
        };
        assert!(config.build_ignore_matcher().unwrap().is_none());
    }

    #[test]
    fn test_watcher_config_invalid_patterns() {
        let config = WatcherConfig {
            ignore_patterns: vec!["[invalid".to_string()],
        };
        assert!(config.build_ignore_matcher().is_err());

        let config = WatcherConfig {
            ignore_patterns: vec!["{unclosed".to_string()],
        };
        assert!(config.build_ignore_matcher().is_err());

        let config = WatcherConfig {
            ignore_patterns: vec!["**[".to_string()],
        };
        assert!(config.build_ignore_matcher().is_err());
    }

    #[test]
    fn test_no_patterns_means_nothing_ignored() {
        let buckets = EventBuckets::new(None, PathBuf::from("/app"));
        assert!(!buckets.is_ignored(Path::new("/app/sdk/client.ts")));
    }

    #[test]
    fn test_event_buckets_single_char_wildcard() {
        let config = WatcherConfig {
            ignore_patterns: vec!["test?.ts".to_string()],
        };
        let matcher = config.build_ignore_matcher().unwrap().map(Arc::new);
        let app_dir = PathBuf::from("/project/app");
        let buckets = EventBuckets::new(matcher, app_dir);

        assert!(buckets.is_ignored(Path::new("/project/app/test1.ts")));
        assert!(buckets.is_ignored(Path::new("/project/app/testA.ts")));

        assert!(!buckets.is_ignored(Path::new("/project/app/test12.ts")));
        assert!(!buckets.is_ignored(Path::new("/project/app/test.ts")));
    }

    #[test]
    fn test_path_outside_app_dir_not_ignored() {
        let config = WatcherConfig {
            ignore_patterns: vec!["sdk/**".to_string()],
        };
        let matcher = config.build_ignore_matcher().unwrap().map(Arc::new);
        let app_dir = PathBuf::from("/project/app");
        let buckets = EventBuckets::new(matcher, app_dir);

        assert!(!buckets.is_ignored(Path::new("/other/path/sdk/client.ts")));
    }

    #[test]
    fn test_event_buckets_multiple_ignore_patterns() {
        let config = WatcherConfig {
            ignore_patterns: vec![
                "sdk/**".to_string(),
                "generated/**".to_string(),
                "**/*.gen.py".to_string(),
            ],
        };
        let matcher = config.build_ignore_matcher().unwrap().map(Arc::new);
        let app_dir = PathBuf::from("/project/app");
        let buckets = EventBuckets::new(matcher, app_dir);

        assert!(buckets.is_ignored(Path::new("/project/app/sdk/client.ts")));
        assert!(buckets.is_ignored(Path::new("/project/app/sdk/nested/file.ts")));
        assert!(buckets.is_ignored(Path::new("/project/app/generated/types.ts")));
        assert!(buckets.is_ignored(Path::new("/project/app/models/user.gen.py")));

        assert!(!buckets.is_ignored(Path::new("/project/app/datamodels/user.ts")));
    }
}
