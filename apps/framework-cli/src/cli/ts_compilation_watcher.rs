/// # TypeScript Compilation Watcher Module
///
/// This module provides functionality for watching TypeScript compilation via `tspc --watch`
/// and triggering infrastructure updates based on compilation events. It replaces file watching
/// for TypeScript projects to enable incremental compilation.
///
/// The watcher spawns `moose-tspc --watch` as a long-running process and parses its
/// JSON output to detect compilation events.
///
/// ## JSON Event Protocol:
/// - `{"event": "compile_start"}` - Compilation cycle starting
/// - `{"event": "compile_complete", "errors": 0, "warnings": 2}` - Successful compilation
/// - `{"event": "compile_error", "errors": 3, "diagnostics": [...]}` - Compilation failed
///
/// ## Usage Pattern:
/// 1. Call `spawn_and_await_initial_compile()` to start tspc and wait for initial compilation
/// 2. After initial compilation succeeds, call `plan_changes()` in the main flow
/// 3. Call `start()` to begin background watching for subsequent changes
///
/// This pattern ensures only ONE `plan_changes` call for initial startup (avoiding the bug
/// where a redundant plan_changes in the watcher could drop tables created by other processes).
///
/// ## Main Components:
/// - `TsCompilationWatcher`: The main struct that initializes and starts the compilation watching process
/// - `CompileEvent`: JSON structure for parsing compilation events
/// - `InitialCompileHandle`: Handle returned by initial compilation, passed to start()
use crate::framework;
use crate::framework::core::infrastructure_map::{ApiChange, InfrastructureMap};
use display::with_timing_async;
use serde::Deserialize;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use super::display::{self, with_spinner_completion_async, Message, MessageType};
use super::processing_coordinator::ProcessingCoordinator;
use super::settings::Settings;

use crate::cli::routines::openapi::openapi;
use crate::framework::core::state_storage::StateStorage;
use crate::infrastructure::processes::process_registry::ProcessRegistries;
use crate::metrics::Metrics;
use crate::project::Project;

/// Errors that can occur during TypeScript compilation watching
#[derive(Debug, thiserror::Error)]
pub enum TsCompilationWatcherError {
    #[error("Failed to spawn tspc process: {0}")]
    SpawnError(std::io::Error),
    #[error("Initial compilation failed: {0}")]
    InitialCompilationFailed(String),
    #[error("Failed to read from tspc process: {0}")]
    ReadError(String),
}

/// Handle returned by `spawn_and_await_initial_compile()`.
/// Contains the running tspc process and event channel for continued watching.
pub struct InitialCompileHandle {
    /// The running moose-tspc --watch child process
    pub child: Child,
    /// Channel receiver for tspc stdout lines (for background watching)
    pub line_rx: tokio::sync::mpsc::Receiver<String>,
}

/// JSON event structure from moose-tspc --watch
#[derive(Debug, Clone, Deserialize)]
pub struct CompileEvent {
    pub event: String,
    #[serde(default)]
    pub errors: u32,
    #[serde(default)]
    pub warnings: u32,
    #[serde(default)]
    pub diagnostics: Vec<String>,
}

impl CompileEvent {
    pub fn is_compile_start(&self) -> bool {
        self.event == "compile_start"
    }

    pub fn is_compile_complete(&self) -> bool {
        self.event == "compile_complete"
    }

    pub fn is_compile_error(&self) -> bool {
        self.event == "compile_error"
    }
}

/// Spawns the tspc --watch process
/// Respects user's tsconfig.json outDir if specified, otherwise uses .moose/compiled
fn spawn_tspc_watch(project: &Project) -> Result<Child, TsCompilationWatcherError> {
    // Add node_modules/.bin to PATH first so we can call moose-tspc directly
    let path = std::env::var("PATH").unwrap_or_else(|_| "/usr/local/bin".to_string());
    let bin_path = format!(
        "{}/node_modules/.bin:{}",
        project.project_location.display(),
        path
    );

    // Call moose-tspc directly (bin from @514labs/moose-lib) instead of npx
    // since npx would try to find a standalone package named "moose-tspc"
    let mut command = Command::new("moose-tspc");
    // Don't pass outDir - let moose-tspc read from tsconfig or use default
    command
        .arg("--watch")
        .current_dir(&project.project_location)
        .env("MOOSE_SOURCE_DIR", &project.source_dir)
        .env("PATH", bin_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    command
        .spawn()
        .map_err(TsCompilationWatcherError::SpawnError)
}

/// Spawns `moose-tspc --watch` and waits for the initial compilation to complete.
///
/// This async function waits until the first `compile_complete` event is received,
/// then returns a handle that can be passed to `TsCompilationWatcher::start()`
/// for continued background watching.
///
/// The caller should call `plan_changes()` after this returns successfully,
/// then call `start()` to begin background watching.
pub async fn spawn_and_await_initial_compile(
    project: &Project,
) -> Result<InitialCompileHandle, TsCompilationWatcherError> {
    debug!(
        "Spawning moose-tspc --watch for initial compilation: {:?}",
        project.app_dir().display()
    );

    show_message!(MessageType::Info, {
        Message {
            action: "Compiling".to_string(),
            details: "TypeScript...".to_string(),
        }
    });

    // Spawn tspc --watch process
    let mut child = spawn_tspc_watch(project)?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| TsCompilationWatcherError::ReadError("Failed to capture stdout".into()))?;

    // Read stderr in a separate thread to avoid blocking
    let stderr = child.stderr.take();
    if let Some(stderr) = stderr {
        let stderr_reader = BufReader::new(stderr);
        std::thread::spawn(move || {
            for line in stderr_reader.lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    debug!("[tspc stderr] {}", line);
                }
            }
        });
    }

    // Create a channel for stdout lines
    let (line_tx, mut line_rx) = tokio::sync::mpsc::channel::<String>(100);

    // Spawn a thread to read stdout lines and send them through the channel
    // (we need a thread because BufReader is blocking)
    let reader = BufReader::new(stdout);
    std::thread::spawn(move || {
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if line_tx.blocking_send(line).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    error!("Error reading from tspc stdout: {}", e);
                    break;
                }
            }
        }
    });

    // Wait for initial compile_complete event (async)
    loop {
        match line_rx.recv().await {
            Some(line) => {
                if line.trim().is_empty() {
                    continue;
                }

                debug!("[tspc initial] {}", line);

                match serde_json::from_str::<CompileEvent>(&line) {
                    Ok(event) => {
                        if event.is_compile_start() {
                            // Initial compilation starting, continue waiting
                            continue;
                        } else if event.is_compile_error() {
                            display_compilation_errors(&event);
                            // Kill the child process to avoid resource leak
                            let _ = child.kill();
                            let _ = child.wait();
                            return Err(TsCompilationWatcherError::InitialCompilationFailed(
                                format!("{} error(s)", event.errors),
                            ));
                        } else if event.is_compile_complete() {
                            display_compilation_success(&event);
                            // Initial compilation done! Return handle for continued watching.
                            return Ok(InitialCompileHandle { child, line_rx });
                        }
                    }
                    Err(_) => {
                        // Not JSON, might be diagnostic output
                        debug!("[tspc] non-JSON output: {}", line);
                    }
                }
            }
            None => {
                // Kill the child process to avoid resource leak
                let _ = child.kill();
                let _ = child.wait();
                return Err(TsCompilationWatcherError::ReadError(
                    "tspc process closed stdout before initial compilation completed".into(),
                ));
            }
        }
    }
}

/// Display compilation errors to the user
fn display_compilation_errors(event: &CompileEvent) {
    show_message!(MessageType::Error, {
        Message {
            action: "TypeScript".to_string(),
            details: format!("compilation failed ({} error(s))", event.errors),
        }
    });

    // Display each diagnostic
    for diagnostic in &event.diagnostics {
        // Indent each diagnostic line for better readability
        eprintln!("    {}", diagnostic);
    }
}

/// Display compilation success with optional warnings
fn display_compilation_success(event: &CompileEvent) {
    if event.warnings > 0 {
        show_message!(MessageType::Success, {
            Message {
                action: "Compiled".to_string(),
                details: format!("TypeScript successfully ({} warning(s))", event.warnings),
            }
        });
    } else {
        show_message!(MessageType::Success, {
            Message {
                action: "Compiled".to_string(),
                details: "TypeScript successfully".to_string(),
            }
        });
    }
}

/// Main watching function that monitors tspc --watch output and triggers infrastructure updates.
///
/// This function runs in a loop, parsing JSON events from tspc and triggering
/// infrastructure planning when compilation completes successfully.
///
/// If `initial_handle` is provided, uses the existing tspc process from
/// `spawn_and_await_initial_compile()` and skips initial compilation handling.
/// Otherwise, spawns a new tspc process and handles initial compilation.
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
    initial_handle: Option<InitialCompileHandle>,
) -> Result<(), anyhow::Error> {
    debug!(
        "Starting TypeScript compilation watcher for project: {:?}",
        project.app_dir().display()
    );

    // If we received an initial_handle, initial compilation was already done
    // by spawn_and_await_initial_compile(), so we start watching for changes only.
    let initial_compilation_done = initial_handle.is_some();

    // Either use the provided handle from spawn_and_await_initial_compile,
    // or spawn a new tspc process
    // We keep the child handle to properly clean it up on shutdown
    let (child_process, mut line_rx) = if let Some(handle) = initial_handle {
        // Initial compilation already done, use the existing channel
        let InitialCompileHandle { child, line_rx } = handle;
        (Some(child), line_rx)
    } else {
        // Spawn tspc --watch process fresh
        let mut child = spawn_tspc_watch(&project)?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("Failed to capture stdout from tspc"))?;

        // We'll read stderr in a separate thread to avoid blocking
        let stderr = child.stderr.take();
        if let Some(stderr) = stderr {
            let stderr_reader = BufReader::new(stderr);
            std::thread::spawn(move || {
                for line in stderr_reader.lines().map_while(Result::ok) {
                    if !line.trim().is_empty() {
                        debug!("[tspc stderr] {}", line);
                    }
                }
            });
        }

        // Create a channel for stdout lines
        let (line_tx, line_rx) = tokio::sync::mpsc::channel::<String>(100);

        // Spawn a thread to read stdout lines and send them through the channel
        let reader = BufReader::new(stdout);
        std::thread::spawn(move || {
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        if line_tx.blocking_send(line).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        error!("Error reading from tspc stdout: {}", e);
                        break;
                    }
                }
            }
        });

        (Some(child), line_rx)
    };

    show_message!(MessageType::Info, {
        Message {
            action: "Watching".to_string(),
            details: format!(
                "TypeScript compilation at {:?}",
                project.app_dir().display()
            ),
        }
    });

    // Track if we've seen the first compilation in this watcher session.
    // If initial_compilation_done is true, we start as "already seen first".
    let mut seen_first_compile = initial_compilation_done;

    loop {
        tokio::select! {
            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() {
                    info!("TypeScript compilation watcher received shutdown signal");
                    break;
                }
            }
            line_opt = line_rx.recv() => {
                match line_opt {
                    Some(line) => {
                        if line.trim().is_empty() {
                            continue;
                        }

                        debug!("[tspc] {}", line);

                        // Try to parse as JSON event
                        match serde_json::from_str::<CompileEvent>(&line) {
                            Ok(event) => {
                                if event.is_compile_start() {
                                    // Always show "Compiling" for incremental builds
                                    // (we skip it during initial startup which is handled separately)
                                    if seen_first_compile {
                                        show_message!(MessageType::Info, {
                                            Message {
                                                action: "Compiling".to_string(),
                                                details: "TypeScript (incremental)...".to_string(),
                                            }
                                        });
                                    }
                                } else if event.is_compile_error() {
                                    display_compilation_errors(&event);
                                    // Mark that we've seen the first compile event
                                    seen_first_compile = true;
                                } else if event.is_compile_complete() {
                                    // Skip processing for the very first compile_complete if we spawned
                                    // tspc fresh (initial_compilation_done was false). In that case,
                                    // start_development_mode already called plan_changes() after the
                                    // initial compilation, so we don't want to trigger a duplicate.
                                    //
                                    // If initial_compilation_done was true (handle passed in),
                                    // spawn_and_await_initial_compile() consumed the initial event,
                                    // so ALL events here are incremental and should trigger plan_changes.
                                    if !seen_first_compile {
                                        // This is the first compile_complete in legacy mode.
                                        // Display success but DON'T trigger plan_changes.
                                        display_compilation_success(&event);
                                        seen_first_compile = true;
                                        continue;
                                    }

                                    // Show success message for incremental builds
                                    display_compilation_success(&event);

                                    // Trigger infrastructure planning for incremental changes
                                    let _processing_guard =
                                        processing_coordinator.begin_processing().await;

                                    let project_clone = project.clone();
                                    let result: anyhow::Result<()> = with_spinner_completion_async(
                                        "Processing infrastructure changes",
                                        "Infrastructure changes processed successfully",
                                        async {
                                            let plan_result = with_timing_async("Planning", async {
                                                // IS_DEV_MODE is set, so ensure_typescript_compiled is a no-op
                                                // (moose-tspc --watch already compiled)
                                                framework::core::plan::plan_changes(
                                                    &**state_storage,
                                                    &project_clone,
                                                )
                                                .await
                                            })
                                            .await;

                                            match plan_result {
                                                Ok((_, plan_result)) => {
                                                    with_timing_async("Validation", async {
                                                        framework::core::plan_validator::validate(
                                                            &project_clone,
                                                            &plan_result,
                                                        )
                                                    })
                                                    .await?;

                                                    display::show_changes(&plan_result);
                                                    let mut project_registries =
                                                        project_registries.write().await;

                                                    let execution_result =
                                                        with_timing_async("Execution", async {
                                                            framework::core::execute::execute_online_change(
                                                                &project_clone,
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
                                                                    .store_infrastructure_map(
                                                                        &plan_result.target_infra_map,
                                                                    )
                                                                    .await
                                                            })
                                                            .await?;

                                                            with_timing_async("OpenAPI Gen", async {
                                                                openapi(
                                                                    &project_clone,
                                                                    &plan_result.target_infra_map,
                                                                )
                                                                .await
                                                            })
                                                            .await?;

                                                            let mut infra_ptr =
                                                                infrastructure_map.write().await;
                                                            *infra_ptr = plan_result.target_infra_map;
                                                        }
                                                        Err(e) => {
                                                            return Err(e.into());
                                                        }
                                                    }
                                                }
                                                Err(e) => {
                                                    return Err(e.into());
                                                }
                                            }
                                            Ok(())
                                        },
                                        {
                                            use crate::utilities::constants::SHOW_TIMING;
                                            use std::sync::atomic::Ordering;
                                            !project.is_production
                                                && !SHOW_TIMING.load(Ordering::Relaxed)
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
                                                    details: format!(
                                                        "Processing infrastructure changes failed:\n{e:?}"
                                                    ),
                                                }
                                            });
                                        }
                                    }
                                }
                            }
                            Err(_) => {
                                // Not a JSON line, might be diagnostic output or other info
                                // Log it for debugging but don't fail
                                debug!("[tspc non-json] {}", line);
                            }
                        }
                    }
                    None => {
                        // Channel closed - tspc process ended
                        warn!("tspc process ended unexpectedly");
                        break;
                    }
                }
            }
        }
    }

    // Clean up the child process on shutdown
    if let Some(mut child) = child_process {
        debug!("Killing moose-tspc process on watcher shutdown");
        let _ = child.kill();
        let _ = child.wait();
    }

    Ok(())
}

/// TypeScript compilation watcher that monitors tspc --watch and triggers infrastructure updates.
///
/// This struct provides the main interface for starting the TypeScript compilation watching process.
/// It should be used instead of FileWatcher for TypeScript projects to enable incremental compilation.
///
/// ## Recommended Usage Pattern
///
/// For best results, use the two-phase initialization:
/// 1. Call `spawn_and_await_initial_compile()` early to start tspc and wait for initial compilation
/// 2. After initial compilation succeeds, call `plan_changes()` in the main flow
/// 3. Call `start()` with the returned handle to begin background watching
///
/// This ensures only ONE `plan_changes` call for initial startup.
pub struct TsCompilationWatcher;

impl TsCompilationWatcher {
    /// Creates a new TsCompilationWatcher instance
    pub fn new() -> Self {
        Self {}
    }

    /// Starts the TypeScript compilation watching process.
    ///
    /// This method monitors tspc output for compilation events and triggers
    /// infrastructure planning and execution when compilation completes.
    ///
    /// # Arguments
    /// * `project` - The project configuration
    /// * `route_update_channel` - Channel for sending API route updates
    /// * `webapp_update_channel` - Channel for sending WebApp updates
    /// * `infrastructure_map` - The current infrastructure map
    /// * `project_registries` - Registry for all processes
    /// * `metrics` - Metrics collection
    /// * `state_storage` - State storage for managing infrastructure state
    /// * `settings` - CLI settings configuration
    /// * `processing_coordinator` - Coordinator for synchronizing with MCP tools
    /// * `shutdown_rx` - Receiver to listen for shutdown signal
    /// * `initial_handle` - Optional handle from `spawn_and_await_initial_compile()`.
    ///   If provided, continues watching the already-running tspc process.
    ///   If None, spawns a new tspc process (legacy behavior).
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
        initial_handle: Option<InitialCompileHandle>,
    ) -> Result<(), std::io::Error> {
        // Move everything into the spawned task
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
                initial_handle,
            )
            .await
        };

        tokio::spawn(watch_task);

        Ok(())
    }
}

impl Default for TsCompilationWatcher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_compile_start_event() {
        let json = r#"{"event": "compile_start"}"#;
        let event: CompileEvent = serde_json::from_str(json).unwrap();
        assert!(event.is_compile_start());
        assert!(!event.is_compile_complete());
        assert!(!event.is_compile_error());
    }

    #[test]
    fn test_parse_compile_complete_event() {
        let json = r#"{"event": "compile_complete", "errors": 0, "warnings": 2}"#;
        let event: CompileEvent = serde_json::from_str(json).unwrap();
        assert!(event.is_compile_complete());
        assert_eq!(event.errors, 0);
        assert_eq!(event.warnings, 2);
    }

    #[test]
    fn test_parse_compile_error_event() {
        let json = r#"{"event": "compile_error", "errors": 3, "warnings": 0, "diagnostics": ["error 1", "error 2"]}"#;
        let event: CompileEvent = serde_json::from_str(json).unwrap();
        assert!(event.is_compile_error());
        assert_eq!(event.errors, 3);
        assert_eq!(event.diagnostics.len(), 2);
    }

    #[test]
    fn test_parse_event_with_missing_fields() {
        let json = r#"{"event": "compile_complete"}"#;
        let event: CompileEvent = serde_json::from_str(json).unwrap();
        assert!(event.is_compile_complete());
        assert_eq!(event.errors, 0);
        assert_eq!(event.warnings, 0);
        assert!(event.diagnostics.is_empty());
    }
}
