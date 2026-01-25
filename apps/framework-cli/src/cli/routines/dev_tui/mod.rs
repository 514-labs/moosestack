//! Dev TUI - Interactive Terminal User Interface for Moose development mode
//!
//! This module provides a rich terminal interface for monitoring and debugging
//! Moose applications during development. Inspired by k9s and lazygit.

use crate::cli::local_webserver::{RouteMeta, Webserver};
use crate::cli::processing_coordinator::ProcessingCoordinator;
use crate::cli::settings::Settings;
use crate::cli::watcher::FileWatcher;
use crate::framework::core::execute::{execute_initial_infra_change, ExecutionContext};
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::framework::core::plan::plan_changes;
use crate::framework::core::state_storage::StateStorageBuilder;
use crate::infrastructure::redis::redis_client::RedisClient;
use crate::metrics::{Metrics, TelemetryMetadata};
use crate::project::Project;
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use std::collections::{HashMap, HashSet};
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;

pub mod alert;
mod app;
mod event;
mod handler;
pub mod infra_status;
pub mod log_collector;
pub mod resource_panel;
#[cfg(test)]
mod testable_tui;
mod tui;
mod ui;

use alert::Alert;
use app::{DevTuiApp, LogEntry, LogLevel, LogSource};
use event::Event;
use handler::handle_key_events;
pub use infra_status::infra_status_channel;
pub use log_collector::LogCollector;

use resource_panel::{resource_update_channel, ResourceList, ResourceUpdateSender};

use super::dev::run_infrastructure_with_updates;
use super::openapi::openapi;
use super::setup_redis_client;
use infra_status::{InfraStatusUpdate, ServiceStatus};

/// Result type for Dev TUI operations
pub type DevTuiResult<T> = std::result::Result<T, Box<dyn std::error::Error>>;

/// Runs the development TUI with infrastructure boot happening inside the TUI
///
/// This is the new entry point that launches the TUI immediately and spawns
/// infrastructure startup as a background task. Status updates are shown
/// in real-time within the TUI.
///
/// # Arguments
/// * `project` - Arc wrapped Project instance containing configuration
/// * `settings` - Reference to application Settings
/// * `enable_mcp` - Whether MCP server is enabled
/// * `no_infra` - Whether to skip infrastructure startup
/// * `machine_id` - Machine identifier for telemetry
///
/// # Returns
/// * `anyhow::Result<()>` - Success or error result
pub async fn run_dev_tui_with_infra(
    project: Arc<Project>,
    settings: &Settings,
    _enable_mcp: bool,
    no_infra: bool,
    machine_id: String,
) -> anyhow::Result<()> {
    // Suppress all direct terminal output — the TUI owns stdout/stderr.
    // Messages still flow through tracing for log file capture.
    crate::utilities::constants::SUPPRESS_DISPLAY.store(true, std::sync::atomic::Ordering::Relaxed);

    // Create the application state
    let mut app = if no_infra {
        DevTuiApp::new_no_infra(project.clone())
    } else {
        DevTuiApp::new(project.clone())
    };

    // Add startup log
    app.logs.push(LogEntry::new(
        LogSource::System,
        LogLevel::Info,
        format!("Starting Moose development mode for '{}'", project.name()),
    ));

    // Create infrastructure status channel
    let (infra_tx, mut infra_rx) = infra_status_channel();

    // Create resource update channel for file watcher integration
    // resource_tx is cloned into each post-boot setup spawn; on retry we
    // replace the receiver so the new post-boot task's sends arrive here.
    let (mut resource_tx, mut resource_rx) = resource_update_channel();

    // Spawn infrastructure task if not skipped
    let infra_handle = if !no_infra {
        let project_clone = project.clone();
        let settings_clone = settings.clone();
        let tx = infra_tx.clone();

        Some(tokio::spawn(async move {
            run_infrastructure_with_updates(project_clone, settings_clone, tx).await
        }))
    } else {
        // Send immediate completion if infra is skipped
        let _ = infra_tx.send(InfraStatusUpdate::BootCompleted);
        None
    };

    // Initialize the terminal user interface
    let backend = CrosstermBackend::new(io::stderr());
    let terminal = Terminal::new(backend)?;
    let events = event::EventHandler::new(100); // 100ms tick rate
    let mut tui = tui::Tui::new(terminal, events);
    tui.init()
        .map_err(|e| anyhow::anyhow!("Failed to initialize TUI: {}", e))?;

    // Initial draw
    tui.draw(&mut app)
        .map_err(|e| anyhow::anyhow!("Failed to draw TUI: {}", e))?;

    // Track post-boot setup task handle
    let mut post_boot_handle: Option<JoinHandle<()>> = None;

    // Main event loop with tokio::select!
    while app.running {
        tokio::select! {
            // Handle terminal events
            event = tui.events.next() => {
                match event {
                    Ok(Event::Tick) => {
                        app.tick();
                    }
                    Ok(Event::Key(key_event)) => {
                        if let Err(e) = handle_key_events(key_event, &mut app) {
                            tracing::error!("Error handling key event: {}", e);
                        }
                    }
                    Ok(Event::MouseScroll(delta)) => {
                        if delta > 0 {
                            for _ in 0..delta {
                                app.scroll_down();
                            }
                        } else {
                            for _ in 0..(-delta) {
                                app.scroll_up();
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!("Error receiving event: {}", e);
                        break;
                    }
                }
            }

            // Handle infrastructure status updates
            Some(update) = infra_rx.recv() => {
                // Check if this is a boot failure that needs an alert
                let show_alert = matches!(&update, InfraStatusUpdate::BootFailed(_));
                let is_docker_failure = matches!(
                    &update,
                    InfraStatusUpdate::DockerStatus(ServiceStatus::Failed(_))
                );

                app.handle_infra_update(update);

                // Show alert for critical failures
                if show_alert {
                    if is_docker_failure {
                        app.show_alert(Alert::docker_not_running());
                    } else if let Some(ref error) = app.infra_status.error_message {
                        app.show_alert(Alert::infrastructure_failed(error));
                    }
                }
            }

            // Handle resource updates from file watcher
            Some(update) = resource_rx.recv() => {
                app.handle_resource_update(update);
            }
        }

        // Handle retry request from alert
        if app.retry_infra {
            app.retry_infra = false;

            // Abort post-boot setup if running
            if let Some(h) = post_boot_handle.take() {
                h.abort();
            }

            // Reset infrastructure status
            app.infra_status = infra_status::InfrastructureStatus::new(
                project.features.olap,
                project.features.streaming_engine,
                project.features.workflows,
            );
            app.infra_ready = false;
            app.web_server_started = false;

            // Spawn new infrastructure task
            let project_clone = project.clone();
            let settings_clone = settings.clone();
            let (new_tx, new_rx) = infra_status_channel();
            infra_rx = new_rx;

            // Create fresh resource channel so the new post-boot setup sends to a new receiver
            let (new_resource_tx, new_resource_rx) = resource_update_channel();
            resource_tx = new_resource_tx;
            resource_rx = new_resource_rx;

            tokio::spawn(async move {
                run_infrastructure_with_updates(project_clone, settings_clone, new_tx).await
            });

            app.logs.push(LogEntry::new(
                LogSource::System,
                LogLevel::Info,
                "Retrying infrastructure startup...".to_string(),
            ));
        }

        // Render the UI
        tui.draw(&mut app)
            .map_err(|e| anyhow::anyhow!("Failed to draw TUI: {}", e))?;

        // Start post-boot setup (web server, file watcher, etc.) when infrastructure is ready
        if app.infra_ready && !app.web_server_started {
            app.web_server_started = true;
            app.infra_status.web_server = ServiceStatus::Starting;
            app.logs.push(LogEntry::new(
                LogSource::System,
                LogLevel::Info,
                "Setting up development server...".to_string(),
            ));

            let setup_project = project.clone();
            let setup_settings = settings.clone();
            let setup_machine_id = machine_id.clone();
            let setup_infra_tx = infra_tx.clone();
            let setup_resource_tx = resource_tx.clone();

            post_boot_handle = Some(tokio::spawn(async move {
                run_post_boot_setup(
                    setup_project,
                    setup_settings,
                    setup_machine_id,
                    setup_infra_tx,
                    setup_resource_tx,
                )
                .await;
            }));
        }
    }

    // Exit the TUI cleanly
    tui.exit()
        .map_err(|e| anyhow::anyhow!("Failed to exit TUI: {}", e))?;

    // Re-enable display output so shutdown messages are visible
    crate::utilities::constants::SUPPRESS_DISPLAY
        .store(false, std::sync::atomic::Ordering::Relaxed);

    // Abort background tasks
    if let Some(handle) = post_boot_handle {
        handle.abort();
    }
    if let Some(handle) = infra_handle {
        handle.abort();
    }

    // Stop Docker containers if infrastructure was started
    if !no_infra && project.should_load_infra() && settings.should_shutdown_containers() {
        use crate::utilities::docker::DockerClient;
        let docker = DockerClient::new(settings);
        tracing::info!("Stopping Docker containers...");
        eprintln!("Stopping Docker containers...");
        if let Err(e) = docker.stop_containers(&project) {
            tracing::error!("Failed to stop containers: {}", e);
            eprintln!("Warning: Failed to stop containers: {}", e);
        } else {
            tracing::info!("Docker containers stopped");
            eprintln!("Docker containers stopped.");
        }
    }

    Ok(())
}

/// Performs the full development server setup after infrastructure boot completes.
///
/// This mirrors the logic in `start_development_mode()` but communicates status
/// back to the TUI via channels instead of printing to stdout.
///
/// Steps: Redis client -> Metrics -> State storage -> Plan changes -> Initial resources
/// -> Web server listeners -> Execute infra changes -> OpenAPI -> File watcher -> Web server
async fn run_post_boot_setup(
    project: Arc<Project>,
    settings: Settings,
    machine_id: String,
    infra_tx: infra_status::InfraStatusSender,
    resource_tx: ResourceUpdateSender,
) {
    if let Err(e) = run_post_boot_setup_inner(
        project,
        settings,
        machine_id,
        infra_tx.clone(),
        resource_tx.clone(),
    )
    .await
    {
        let error_msg = format!("{e:?}");
        tracing::error!("Post-boot setup failed: {}", error_msg);
        let _ = resource_tx.send(resource_panel::ResourceUpdate::ChangeFailed(
            error_msg.clone(),
        ));
        let _ = infra_tx.send(InfraStatusUpdate::BootFailed(error_msg));
    }
}

/// Inner implementation of post-boot setup that returns errors for centralized handling.
async fn run_post_boot_setup_inner(
    project: Arc<Project>,
    settings: Settings,
    machine_id: String,
    infra_tx: infra_status::InfraStatusSender,
    resource_tx: ResourceUpdateSender,
) -> anyhow::Result<()> {
    // 1. Create Redis client
    let redis_client = setup_redis_client(project.clone()).await?;

    // 2. Create Metrics instance
    let (metrics, rx_events) = Metrics::new(
        TelemetryMetadata {
            machine_id,
            metric_labels: settings.metric.labels.clone(),
            is_moose_developer: settings.telemetry.is_moose_developer,
            is_production: project.is_production,
            project_name: project.name().to_string(),
            export_metrics: settings.telemetry.export_metrics,
            metric_endpoints: settings.metric.endpoints.clone(),
        },
        if settings.features.metrics_v2 {
            Some(redis_client.clone())
        } else {
            None
        },
    );
    let metrics = Arc::new(metrics);
    metrics.start_listening_to_metrics(rx_events).await;

    // 3. Create state storage
    let state_storage = StateStorageBuilder::from_config(&project)
        .clickhouse_config(Some(project.clickhouse_config.clone()))
        .redis_client(Some(&redis_client))
        .build()
        .await?;

    // 4. Plan changes
    let (_current_state, plan) = plan_changes(&*state_storage, &project).await?;

    // 5. Send initial resource list to TUI
    let initial_resources = ResourceList::from_infrastructure_map(&plan.target_infra_map);
    let _ = resource_tx.send(resource_panel::ResourceUpdate::ChangesApplied {
        resource_list: initial_resources,
        changes: vec![],
    });

    // 6. Create web server and spawn route/webapp update listeners
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

    let route_table: &'static RwLock<HashMap<PathBuf, RouteMeta>> =
        Box::leak(Box::new(RwLock::new(HashMap::new())));

    let route_update_channel = web_server
        .spawn_api_update_listener(project.clone(), route_table, consumption_apis)
        .await;

    let webapp_update_channel = web_server.spawn_webapp_update_listener(web_apps).await;

    // 7. Execute initial infrastructure changes
    let api_changes_channel = web_server
        .spawn_api_update_listener(project.clone(), route_table, consumption_apis)
        .await;

    let webapp_changes_channel = web_server.spawn_webapp_update_listener(web_apps).await;

    let process_registry = execute_initial_infra_change(ExecutionContext {
        project: &project,
        settings: &settings,
        plan: &plan,
        skip_olap: false,
        api_changes_channel,
        webapp_changes_channel,
        metrics: metrics.clone(),
    })
    .await?;

    let process_registry = Arc::new(RwLock::new(process_registry));

    // 8. Generate OpenAPI spec and store infra map
    let openapi_file = openapi(&project, &plan.target_infra_map).await?;

    state_storage
        .store_infrastructure_map(&plan.target_infra_map)
        .await?;

    let infra_map: &'static RwLock<InfrastructureMap> =
        Box::leak(Box::new(RwLock::new(plan.target_infra_map)));

    // 9. Create processing coordinator and shutdown channel
    let processing_coordinator = ProcessingCoordinator::new();
    let (watcher_shutdown_tx, watcher_shutdown_rx) = tokio::sync::watch::channel(false);

    // 10. Start file watcher with resource updates
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
        Some(resource_tx),
    )?;

    // 11. Signal web server is healthy
    let _ = infra_tx.send(InfraStatusUpdate::WebServerStatus(ServiceStatus::Healthy));

    // 12. Start web server (blocks forever)
    web_server
        .start(
            &settings,
            route_table,
            consumption_apis,
            web_apps,
            infra_map,
            project,
            metrics,
            Some(openapi_file),
            process_registry,
            false, // MCP disabled in TUI mode for now
            processing_coordinator,
            Some(watcher_shutdown_tx),
        )
        .await;

    Ok(())
}

/// Runs the development TUI interface (legacy entry point)
///
/// # Arguments
/// * `project` - Arc wrapped Project instance containing configuration
/// * `metrics` - Arc wrapped Metrics instance for monitoring
/// * `redis_client` - Arc wrapped RedisClient for caching
/// * `settings` - Reference to application Settings
/// * `_enable_mcp` - Whether MCP server is enabled (for display purposes)
///
/// # Returns
/// * `anyhow::Result<()>` - Success or error result
pub async fn run_dev_tui(
    project: Arc<Project>,
    _metrics: Arc<Metrics>,
    _redis_client: Arc<RedisClient>,
    _settings: &Settings,
    _enable_mcp: bool,
) -> anyhow::Result<()> {
    // Create log collector for receiving logs from various sources
    let (log_collector, mut log_receiver) = LogCollector::new();

    // Create the application state
    let mut app = DevTuiApp::new(project.clone());

    // Add startup logs
    app.logs.push(LogEntry::new(
        LogSource::System,
        LogLevel::Info,
        format!("Starting Moose development mode for '{}'", project.name()),
    ));
    app.logs.push(LogEntry::new(
        LogSource::System,
        LogLevel::Info,
        format!(
            "Web server will start at http://{}:{}",
            project.http_server_config.host, project.http_server_config.port
        ),
    ));

    // Get system handle for logging TUI events
    let system_log = log_collector.system_handle();

    // Initialize the terminal user interface
    let backend = CrosstermBackend::new(io::stderr());
    let terminal = Terminal::new(backend)?;
    let events = event::EventHandler::new(100); // 100ms tick rate for responsive UI
    let mut tui = tui::Tui::new(terminal, events);
    tui.init()
        .map_err(|e| anyhow::anyhow!("Failed to initialize TUI: {}", e))?;

    system_log.info("TUI initialized. Press 'q' to quit.");

    // Initial draw before entering the event loop
    tui.draw(&mut app)
        .map_err(|e| anyhow::anyhow!("Failed to draw TUI: {}", e))?;

    // Main event loop
    while app.running {
        // Handle events (this blocks until an event is available)
        match tui.events.next().await {
            Ok(Event::Tick) => {
                // Process all pending log entries on each tick (non-blocking)
                while let Ok(log_entry) = log_receiver.try_recv() {
                    app.logs.push(log_entry);
                }
                app.tick();
            }
            Ok(Event::Key(key_event)) => {
                if let Err(e) = handle_key_events(key_event, &mut app) {
                    tracing::error!("Error handling key event: {}", e);
                }
            }
            Ok(Event::MouseScroll(delta)) => {
                if delta > 0 {
                    for _ in 0..delta {
                        app.scroll_down();
                    }
                } else {
                    for _ in 0..(-delta) {
                        app.scroll_up();
                    }
                }
            }
            Err(e) => {
                tracing::error!("Error receiving event: {}", e);
                break; // Exit on channel error
            }
        }

        // Render the UI after each event
        tui.draw(&mut app)
            .map_err(|e| anyhow::anyhow!("Failed to draw TUI: {}", e))?;
    }

    // Exit the TUI cleanly
    tui.exit()
        .map_err(|e| anyhow::anyhow!("Failed to exit TUI: {}", e))?;

    Ok(())
}

/// Test utilities for the dev_tui module
#[cfg(test)]
pub(crate) mod test_utils {
    use super::app::*;
    use crate::framework::languages::SupportedLanguages;
    use crate::project::Project;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use std::path::Path;
    use std::sync::Arc;

    /// Creates a mock Project for testing
    ///
    /// Uses the project's test directory which must exist for canonicalize to work.
    pub fn mock_project() -> Arc<Project> {
        // Create a temp directory that will live for the duration of the test
        let temp_dir = std::env::temp_dir();
        Arc::new(Project::new(
            Path::new(&temp_dir),
            "test-project".to_string(),
            SupportedLanguages::Typescript,
        ))
    }

    /// Creates a DevTuiApp with test defaults
    pub fn test_app() -> DevTuiApp {
        DevTuiApp::new(mock_project())
    }

    /// Creates app with pre-populated logs using fixed timestamps for deterministic tests
    pub fn test_app_with_logs(count: usize) -> DevTuiApp {
        use chrono::TimeZone;

        let mut app = test_app();
        // Use a fixed base timestamp for deterministic snapshots
        let base_time = chrono::Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        for i in 0..count {
            let timestamp = base_time + chrono::Duration::seconds(i as i64);
            app.logs.push(LogEntry {
                timestamp,
                source: LogSource::System,
                level: LogLevel::Info,
                message: format!("Test message {}", i),
            });
        }
        app
    }

    /// Helper to create KeyEvent with no modifiers
    pub fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::empty())
    }

    /// Helper to create KeyEvent with CONTROL modifier
    pub fn ctrl_key(c: char) -> KeyEvent {
        KeyEvent::new(KeyCode::Char(c), KeyModifiers::CONTROL)
    }
}
