pub mod binary_manager;
pub mod clickhouse;
pub mod devkafka;
pub mod devredis;
pub mod errors;
pub mod preflight;
pub mod temporal;

use crate::cli::display::{with_spinner_completion, with_timing, Message};
use crate::cli::routines::{RoutineFailure, RoutineSuccess};
use crate::cli::settings::Settings;
use crate::project::Project;
use crate::utilities::constants::SHOW_TIMING;
use crate::utilities::infra_provider::InfraProvider;
use binary_manager::BinaryManager;
use errors::NativeInfraError;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::sleep;
use std::time::Duration;
use tokio::runtime::Handle;
use tracing::info;

/// Relative path from project root to the native infrastructure directory.
pub const NATIVE_INFRA_DIR: &str = ".moose/native_infra";

/// Holds handles to embedded devkafka and devredis servers.
struct EmbeddedHandles {
    devkafka: Option<devkafka::DevKafkaHandle>,
    devredis: Option<devredis::DevRedisHandle>,
}

/// Global storage for embedded server handles.
static EMBEDDED_HANDLES: OnceLock<Arc<Mutex<Option<EmbeddedHandles>>>> = OnceLock::new();

fn handles_lock() -> &'static Arc<Mutex<Option<EmbeddedHandles>>> {
    EMBEDDED_HANDLES.get_or_init(|| Arc::new(Mutex::new(None)))
}

/// Shut down all native infrastructure: embedded servers and native child processes.
///
/// Signals embedded devkafka/devredis to stop and kills ClickHouse/Temporal via PID files.
/// Safe to call even when native infra was never started — all operations are no-ops
/// when there is nothing to shut down.
pub fn stop_native_infra(project: &Project) {
    shutdown_embedded_servers();
    kill_native_processes(project);
}

/// Shut down any running embedded devkafka/devredis servers.
///
/// This is safe to call from both sync and async contexts — it signals shutdown
/// without awaiting. The embedded tasks will stop on their own.
fn shutdown_embedded_servers() {
    let lock = handles_lock();
    let mut guard = lock.lock().unwrap();

    if let Some(handles) = guard.as_mut() {
        if let Some(dk) = handles.devkafka.take() {
            info!("Signaling embedded devkafka to shut down");
            dk.signal_shutdown();
            // Handle is dropped here, releasing resources.
        }
        if let Some(dr) = handles.devredis.take() {
            info!("Signaling embedded devredis to shut down");
            dr.signal_shutdown();
            // Handle is dropped here, releasing the Arc<Listener>.
        }
    }
}

/// Fully native infrastructure provider: devredis + ClickHouse + Temporal as local processes.
///
/// No Docker dependency. devredis runs as an embedded tokio task.
/// ClickHouse and Temporal run as native child processes.
pub struct NativeInfraProvider {
    /// Binary manager for downloading/caching native binaries.
    binary_manager: BinaryManager,
    /// Handle to the tokio runtime for spawning embedded servers.
    rt_handle: Handle,
    /// Whether the CLI-level `scripts` feature flag is enabled.
    /// Mirrors the check in `dev.rs`: Temporal is needed when
    /// `settings.features.scripts || project.features.workflows`.
    scripts_enabled: bool,
}

impl NativeInfraProvider {
    pub fn new(settings: &Settings) -> Result<Self, NativeInfraError> {
        Ok(Self {
            binary_manager: BinaryManager::new()?,
            rt_handle: Handle::current(),
            scripts_enabled: settings.features.scripts,
        })
    }

    fn map_native_err(err: NativeInfraError) -> RoutineFailure {
        RoutineFailure::new(
            Message::new("Failed".to_string(), err.to_string()),
            anyhow::anyhow!("{}", err),
        )
    }
}

impl InfraProvider for NativeInfraProvider {
    fn setup(&self, project: &Project, _settings: &Settings) -> Result<(), RoutineFailure> {
        info!("Ensuring native ClickHouse binary is available...");
        let _ch_binary =
            clickhouse::ensure_binary(&self.binary_manager).map_err(Self::map_native_err)?;

        if self.scripts_enabled || project.features.workflows {
            info!("Ensuring native Temporal binary is available...");
            let _temporal_binary =
                temporal::ensure_binary(&self.binary_manager).map_err(Self::map_native_err)?;
        }

        // Generate ClickHouse config
        clickhouse::write_config(project).map_err(Self::map_native_err)?;

        RoutineSuccess::success(Message::new(
            "Setup".to_string(),
            "native infrastructure configured".to_string(),
        ))
        .show();

        Ok(())
    }

    fn start(&self, project: &Project) -> Result<(), RoutineFailure> {
        // Preflight: surface EADDRINUSE in a single actionable message before
        // anything starts. Prevents the Node consumption worker from entering
        // an unbounded restart loop when a prior `moose dev --dockerless` is
        // still holding ports 4001 / 6379 / 19092.
        let specs = preflight::port_specs_for(
            project,
            self.scripts_enabled,
            /* include_webserver = */ true,
        );
        preflight::check_ports(&specs, &preflight::native_dir_for(project))
            .map_err(NativeInfraError::from)
            .map_err(Self::map_native_err)?;

        // Start embedded devredis (Redis needed early for leadership/presence)
        let devredis_handle = with_timing("Start devredis", || {
            with_spinner_completion(
                "Starting native Redis (devredis)",
                "Native Redis (devredis) started",
                || {
                    let port = project.redis_config.port;
                    let handle = self
                        .rt_handle
                        .block_on(devredis::start_embedded(port))
                        .map_err(|e| anyhow::anyhow!("{}", e))?;
                    Ok::<_, anyhow::Error>(handle)
                },
                !project.is_production && !SHOW_TIMING.load(Ordering::Relaxed),
            )
        })
        .map_err(|e| {
            RoutineFailure::new(
                Message::new("Failed".to_string(), "to start devredis".to_string()),
                e,
            )
        })?;

        // Start embedded devkafka (only when streaming is enabled)
        let devkafka_handle = if project.features.streaming_engine {
            let handle = with_timing("Start devkafka", || {
                with_spinner_completion(
                    "Starting native Kafka (devkafka)",
                    "Native Kafka (devkafka) started",
                    || {
                        let port = devkafka::broker_port(&project.redpanda_config);
                        let handle = self
                            .rt_handle
                            .block_on(devkafka::start_embedded("127.0.0.1", port))
                            .map_err(|e| anyhow::anyhow!("{}", e))?;
                        Ok::<_, anyhow::Error>(handle)
                    },
                    !project.is_production && !SHOW_TIMING.load(Ordering::Relaxed),
                )
            })
            .map_err(|e| {
                RoutineFailure::new(
                    Message::new("Failed".to_string(), "to start devkafka".to_string()),
                    e,
                )
            })?;
            Some(handle)
        } else {
            info!("Skipping devkafka: streaming_engine feature is disabled");
            None
        };

        // Store embedded handles for later shutdown
        {
            let mut guard = handles_lock().lock().unwrap();
            *guard = Some(EmbeddedHandles {
                devkafka: devkafka_handle,
                devredis: Some(devredis_handle),
            });
        }

        // Start native ClickHouse
        let ch_binary =
            clickhouse::ensure_binary(&self.binary_manager).map_err(Self::map_native_err)?;
        let ch_config = clickhouse::native_data_dir(project).join("config.xml");

        with_timing("Start ClickHouse", || {
            with_spinner_completion(
                "Starting native ClickHouse server",
                "Native ClickHouse started",
                || {
                    let mut child = clickhouse::start_command(&ch_binary, &ch_config)?;
                    let pid = child.id().ok_or_else(|| {
                        let _ = child.start_kill();
                        anyhow::anyhow!("ClickHouse process exited immediately after spawn")
                    })?;
                    if let Err(e) =
                        write_pid_file(&clickhouse::pid_file_path(project), pid, "clickhouse")
                    {
                        let _ = child.start_kill();
                        return Err(anyhow::anyhow!("{}", e));
                    }
                    Ok::<(), anyhow::Error>(())
                },
                !project.is_production && !SHOW_TIMING.load(Ordering::Relaxed),
            )
        })
        .map_err(|e| {
            // Roll back: shut down devredis since ClickHouse failed
            info!("ClickHouse startup failed, rolling back devredis");
            shutdown_embedded_servers();
            RoutineFailure::new(
                Message::new(
                    "Failed".to_string(),
                    "to start native ClickHouse".to_string(),
                ),
                e,
            )
        })?;

        // Start native Temporal (only when workflows or scripts are enabled)
        if self.scripts_enabled || project.features.workflows {
            let temporal_result = with_timing("Start Temporal", || {
                with_spinner_completion(
                    "Starting native Temporal dev server",
                    "Native Temporal started",
                    || {
                        let temporal_binary = temporal::ensure_binary(&self.binary_manager)
                            .map_err(|e| anyhow::anyhow!("{}", e))?;
                        let mut child = temporal::start_command(&temporal_binary, project)
                            .map_err(|e| anyhow::anyhow!("{}", e))?;
                        let pid = child.id().ok_or_else(|| {
                            let _ = child.start_kill();
                            anyhow::anyhow!("Temporal process exited immediately after spawn")
                        })?;
                        if let Err(e) =
                            write_pid_file(&temporal::pid_file_path(project), pid, "temporal")
                        {
                            let _ = child.start_kill();
                            return Err(anyhow::anyhow!("{}", e));
                        }
                        Ok::<(), anyhow::Error>(())
                    },
                    !project.is_production && !SHOW_TIMING.load(Ordering::Relaxed),
                )
            });

            if let Err(e) = temporal_result {
                // Roll back: kill ClickHouse and devredis since we failed to start Temporal
                info!("Temporal startup failed, rolling back ClickHouse and devredis");
                kill_pid_file(&clickhouse::pid_file_path(project));
                shutdown_embedded_servers();
                return Err(RoutineFailure::new(
                    Message::new("Failed".to_string(), "to start native Temporal".to_string()),
                    e,
                ));
            }
        } else {
            info!("Skipping Temporal: workflows feature is disabled");
        }

        Ok(())
    }

    fn stop(&self, project: &Project, _settings: &Settings) -> Result<(), RoutineFailure> {
        stop_native_infra(project);
        Ok(())
    }

    fn validate_clickhouse(&self, project: &Project) -> Result<RoutineSuccess, RoutineFailure> {
        let port = project.clickhouse_config.host_port;

        for _ in 0..30 {
            if clickhouse::health_check(port).is_ok() {
                // Native ClickHouse doesn't have Docker's CLICKHOUSE_DB entrypoint,
                // so we create the default database here after the server is up.
                clickhouse::ensure_database(project).map_err(|e| {
                    RoutineFailure::new(
                        Message::new(
                            "Failed".to_string(),
                            "to create default database".to_string(),
                        ),
                        anyhow::anyhow!("{}", e),
                    )
                })?;

                // Wait for the embedded Keeper to finish bootstrapping before
                // moose creates ReplicatedMergeTree tables.
                self.rt_handle
                    .block_on(clickhouse::wait_for_keeper(project))
                    .map_err(|e| {
                        RoutineFailure::new(
                            Message::new(
                                "Failed".to_string(),
                                "embedded Keeper not ready".to_string(),
                            ),
                            anyhow::anyhow!("{}", e),
                        )
                    })?;

                return Ok(RoutineSuccess::success(Message::new(
                    "Validated".to_string(),
                    "native ClickHouse server".to_string(),
                )));
            }
            sleep(Duration::from_secs(1));
        }

        Err(RoutineFailure::error(Message::new(
            "Failed".to_string(),
            format!("ClickHouse health check timed out on port {port} after 30s"),
        )))
    }

    fn validate_redpanda(&self, project: &Project) -> Result<RoutineSuccess, RoutineFailure> {
        if !project.features.streaming_engine {
            return Ok(RoutineSuccess::success(Message::new(
                "Skipped".to_string(),
                "native Kafka broker (devkafka) disabled because streaming_engine is off"
                    .to_string(),
            )));
        }

        let port = devkafka::broker_port(&project.redpanda_config);

        for _ in 0..30 {
            if devkafka::health_check(port).is_ok() {
                return Ok(RoutineSuccess::success(Message::new(
                    "Validated".to_string(),
                    "native Kafka broker (devkafka)".to_string(),
                )));
            }
            sleep(Duration::from_secs(1));
        }

        Err(RoutineFailure::error(Message::new(
            "Failed".to_string(),
            format!("devkafka health check timed out on port {port} after 30s"),
        )))
    }

    fn validate_redpanda_cluster(
        &self,
        _project_name: &str,
    ) -> Result<RoutineSuccess, RoutineFailure> {
        // Single-node devkafka doesn't have a cluster concept
        Ok(RoutineSuccess::success(Message::new(
            "Validated".to_string(),
            "devkafka (single-node, no cluster needed)".to_string(),
        )))
    }

    fn validate_temporal(&self, project: &Project) -> Result<RoutineSuccess, RoutineFailure> {
        if !(self.scripts_enabled || project.features.workflows) {
            return Ok(RoutineSuccess::success(Message::new(
                "Skipped".to_string(),
                "native Temporal dev server disabled because workflows and scripts are off"
                    .to_string(),
            )));
        }

        let port = project.temporal_config.temporal_port;

        for _ in 0..30 {
            if temporal::health_check(port).is_ok() {
                return Ok(RoutineSuccess::success(Message::new(
                    "Validated".to_string(),
                    "native Temporal dev server".to_string(),
                )));
            }
            sleep(Duration::from_secs(1));
        }

        Err(RoutineFailure::error(Message::new(
            "Failed".to_string(),
            format!("Temporal health check timed out on port {port} after 30s"),
        )))
    }
}

/// Write a process ID and expected process name to a PID file.
///
/// Format: `{pid}:{process_name}` — the process name is used to verify
/// identity before sending SIGTERM (guards against PID reuse).
pub(crate) fn write_pid_file(
    pid_path: &Path,
    pid: u32,
    process_name: &str,
) -> Result<(), NativeInfraError> {
    if let Some(parent) = pid_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| NativeInfraError::WritePidFile {
            path: pid_path.to_path_buf(),
            source: e,
        })?;
    }
    std::fs::write(pid_path, format!("{pid}:{process_name}")).map_err(|e| {
        NativeInfraError::WritePidFile {
            path: pid_path.to_path_buf(),
            source: e,
        }
    })?;
    info!("Wrote PID {pid} ({process_name}) to {}", pid_path.display());
    Ok(())
}

/// Check whether the process with the given PID matches the expected name.
///
/// Uses `ps -p {pid} -o comm=` which works on both macOS and Linux.
fn process_matches(pid: u32, expected_name: &str) -> bool {
    match std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
    {
        Ok(output) if output.status.success() => {
            let actual = String::from_utf8_lossy(&output.stdout);
            let actual = actual.trim();
            // The command name may be a full path or just the binary name
            actual.contains(expected_name)
        }
        _ => false, // Process doesn't exist or ps failed
    }
}

/// Read a PID from a file, verify the process identity, send SIGTERM, and remove the file.
///
/// PID files use the format `{pid}:{process_name}`. The process name is checked
/// against the running process to guard against PID reuse. If the process doesn't
/// match (or is already gone), the stale PID file is removed without sending a signal.
pub fn kill_pid_file(pid_path: &Path) {
    let contents = match std::fs::read_to_string(pid_path) {
        Ok(s) => s,
        Err(_) => return, // No PID file — nothing to kill
    };

    let contents = contents.trim();

    // Parse "pid:name" or legacy "pid" format
    let (pid, expected_name) = if let Some((pid_str, name)) = contents.split_once(':') {
        match pid_str.parse::<u32>() {
            Ok(p) => (p, Some(name)),
            Err(e) => {
                info!(
                    "Invalid PID in {}: {e}. Removing stale file.",
                    pid_path.display()
                );
                let _ = std::fs::remove_file(pid_path);
                return;
            }
        }
    } else {
        match contents.parse::<u32>() {
            Ok(p) => (p, None),
            Err(e) => {
                info!(
                    "Invalid PID in {}: {e}. Removing stale file.",
                    pid_path.display()
                );
                let _ = std::fs::remove_file(pid_path);
                return;
            }
        }
    };

    // Verify process identity before killing (guards against PID reuse)
    if let Some(name) = expected_name {
        if !process_matches(pid, name) {
            info!("PID {pid} no longer belongs to {name} (stale or reused). Removing PID file.",);
            let _ = std::fs::remove_file(pid_path);
            return;
        }
    }

    info!("Sending SIGTERM to PID {pid} (from {})", pid_path.display());

    match std::process::Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .output()
    {
        Ok(output) if output.status.success() => {
            info!("Sent SIGTERM to PID {pid}");
        }
        Ok(_) => {
            info!("PID {pid} already exited or could not be signaled");
        }
        Err(e) => {
            info!("Failed to run kill command for PID {pid}: {e}");
        }
    }

    let _ = std::fs::remove_file(pid_path);
}

/// Kill all native infrastructure processes for a project via their PID files.
///
/// Safe to call even when no native processes were started — missing PID files
/// are silently ignored.
fn kill_native_processes(project: &Project) {
    let native_dir = project.project_location.join(NATIVE_INFRA_DIR);
    if !native_dir.exists() {
        return;
    }
    info!("Killing native infrastructure processes via PID files");
    kill_pid_file(&clickhouse::pid_file_path(project));
    kill_pid_file(&temporal::pid_file_path(project));
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_write_pid_file_creates_file_with_pid() {
        let tmp = TempDir::new().unwrap();
        let pid_path = tmp.path().join("test.pid");

        write_pid_file(&pid_path, 12345, "test").unwrap();

        assert!(pid_path.exists());
        assert_eq!(std::fs::read_to_string(&pid_path).unwrap(), "12345:test");
    }

    #[test]
    fn test_write_pid_file_creates_parent_dirs() {
        let tmp = TempDir::new().unwrap();
        let pid_path = tmp.path().join("a").join("b").join("c").join("test.pid");

        write_pid_file(&pid_path, 42, "test").unwrap();

        assert!(pid_path.exists());
        assert_eq!(std::fs::read_to_string(&pid_path).unwrap(), "42:test");
    }

    #[test]
    fn test_kill_pid_file_removes_file_after_kill() {
        let tmp = TempDir::new().unwrap();
        let pid_path = tmp.path().join("test.pid");

        // Use a PID that almost certainly doesn't exist
        std::fs::write(&pid_path, "999999999:nonexistent").unwrap();

        kill_pid_file(&pid_path);

        assert!(!pid_path.exists(), "PID file should be removed after kill");
    }

    #[test]
    fn test_kill_pid_file_handles_missing_file() {
        let tmp = TempDir::new().unwrap();
        let pid_path = tmp.path().join("nonexistent.pid");

        // Should not panic — just a no-op
        kill_pid_file(&pid_path);
    }

    #[test]
    fn test_kill_pid_file_handles_invalid_pid_content() {
        let tmp = TempDir::new().unwrap();
        let pid_path = tmp.path().join("bad.pid");

        std::fs::write(&pid_path, "not_a_number").unwrap();

        kill_pid_file(&pid_path);

        assert!(
            !pid_path.exists(),
            "Stale PID file with invalid content should be removed"
        );
    }

    #[test]
    fn test_clickhouse_pid_file_path() {
        let tmp = TempDir::new().unwrap();
        let project = Project::new(
            tmp.path(),
            "test_project".to_string(),
            crate::framework::languages::SupportedLanguages::Typescript,
        );

        let path = clickhouse::pid_file_path(&project);

        assert!(
            path.ends_with(".moose/native_infra/clickhouse.pid"),
            "Expected path to end with .moose/native_infra/clickhouse.pid, got: {}",
            path.display()
        );
    }

    #[test]
    fn test_temporal_pid_file_path() {
        let tmp = TempDir::new().unwrap();
        let project = Project::new(
            tmp.path(),
            "test_project".to_string(),
            crate::framework::languages::SupportedLanguages::Typescript,
        );

        let path = temporal::pid_file_path(&project);

        assert!(
            path.ends_with(".moose/native_infra/temporal.pid"),
            "Expected path to end with .moose/native_infra/temporal.pid, got: {}",
            path.display()
        );
    }
}
