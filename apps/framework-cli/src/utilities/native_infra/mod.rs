pub mod binary_manager;
pub mod clickhouse;
pub mod errors;
pub mod temporal;

use crate::cli::display::{with_spinner_completion, with_timing, Message};
use crate::cli::routines::util::ensure_docker_running;
use crate::cli::routines::{RoutineFailure, RoutineSuccess};
use crate::cli::settings::Settings;
use crate::project::Project;
use crate::utilities::constants::SHOW_TIMING;
use crate::utilities::docker_provider::DockerInfraProvider;
use crate::utilities::infra_provider::InfraProvider;
use binary_manager::BinaryManager;
use errors::NativeInfraError;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::thread::sleep;
use std::time::Duration;
use tracing::info;

/// Hybrid infrastructure provider: native ClickHouse + Temporal, Docker for Redis + Redpanda.
///
/// This provider starts ClickHouse and Temporal as native processes (no Docker needed for those)
/// while delegating Redis and Redpanda to the existing Docker infrastructure.
pub struct NativeInfraProvider {
    /// Binary manager for downloading/caching native binaries.
    binary_manager: BinaryManager,
    /// Docker provider for services that still need Docker (Redis, Redpanda).
    docker_provider: DockerInfraProvider,
}

impl NativeInfraProvider {
    pub fn new(settings: &Settings) -> Result<Self, NativeInfraError> {
        Ok(Self {
            binary_manager: BinaryManager::new()?,
            docker_provider: DockerInfraProvider::new(settings),
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
    fn setup(&self, project: &Project, settings: &Settings) -> Result<(), RoutineFailure> {
        // Still generate docker-compose for Redis + Redpanda
        self.docker_provider.setup(project, settings)?;

        // Ensure native binaries are downloaded
        info!("Ensuring native ClickHouse binary is available...");
        let _ch_binary =
            clickhouse::ensure_binary(&self.binary_manager).map_err(Self::map_native_err)?;

        info!("Ensuring native Temporal binary is available...");
        let _temporal_binary =
            temporal::ensure_binary(&self.binary_manager).map_err(Self::map_native_err)?;

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
        // Start Docker for Redis + Redpanda only
        // We still need Docker running for these services
        ensure_docker_running(self.docker_provider.docker_client()).map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Failed".to_string(),
                    "to ensure docker is running (needed for Redis/Redpanda)".to_string(),
                ),
                e,
            )
        })?;

        // Start docker containers (Redis + Redpanda will be in the compose file)
        with_timing("Start Docker Services", || {
            with_spinner_completion(
                "Starting Docker services (Redis, Redpanda)",
                "Docker services started",
                || {
                    self.docker_provider
                        .docker_client()
                        .start_containers(project)
                },
                !project.is_production && !SHOW_TIMING.load(Ordering::Relaxed),
            )
        })
        .map_err(|e| {
            RoutineFailure::new(
                Message::new("Failed".to_string(), "to start Docker services".to_string()),
                e,
            )
        })?;

        // Start native ClickHouse
        let ch_binary =
            clickhouse::ensure_binary(&self.binary_manager).map_err(Self::map_native_err)?;
        let ch_config = clickhouse::native_data_dir(project).join("config.xml");

        with_timing("Start ClickHouse", || {
            with_spinner_completion(
                "Starting native ClickHouse server",
                "Native ClickHouse started",
                || {
                    let child = clickhouse::start_command(&ch_binary, &ch_config)?;
                    if let Some(pid) = child.id() {
                        write_pid_file(&clickhouse::pid_file_path(project), pid)
                            .map_err(|e| anyhow::anyhow!("{}", e))?;
                    }
                    // Child handle drops here. kill_on_drop is false, so the
                    // process keeps running. Cleanup happens via PID file in stop().
                    Ok::<(), anyhow::Error>(())
                },
                !project.is_production && !SHOW_TIMING.load(Ordering::Relaxed),
            )
        })
        .map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Failed".to_string(),
                    "to start native ClickHouse".to_string(),
                ),
                e,
            )
        })?;

        // Start native Temporal
        with_timing("Start Temporal", || {
            with_spinner_completion(
                "Starting native Temporal dev server",
                "Native Temporal started",
                || {
                    let temporal_binary = temporal::ensure_binary(&self.binary_manager)
                        .map_err(|e| anyhow::anyhow!("{}", e))?;
                    let child = temporal::start_command(&temporal_binary, project)?;
                    if let Some(pid) = child.id() {
                        write_pid_file(&temporal::pid_file_path(project), pid)
                            .map_err(|e| anyhow::anyhow!("{}", e))?;
                    }
                    Ok::<(), anyhow::Error>(())
                },
                !project.is_production && !SHOW_TIMING.load(Ordering::Relaxed),
            )
        })
        .map_err(|e| {
            RoutineFailure::new(
                Message::new("Failed".to_string(), "to start native Temporal".to_string()),
                e,
            )
        })?;

        Ok(())
    }

    fn stop(&self, project: &Project, settings: &Settings) -> Result<(), RoutineFailure> {
        // Stop Docker services (Redis + Redpanda)
        self.docker_provider.stop(project, settings)?;

        // Kill native processes via their PID files
        kill_pid_file(&clickhouse::pid_file_path(project));
        kill_pid_file(&temporal::pid_file_path(project));

        Ok(())
    }

    fn validate_clickhouse(&self, project: &Project) -> Result<RoutineSuccess, RoutineFailure> {
        let port = project.clickhouse_config.host_port;

        for _ in 0..30 {
            if clickhouse::health_check(port).is_ok() {
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
        // Redpanda still runs in Docker
        self.docker_provider.validate_redpanda(project)
    }

    fn validate_redpanda_cluster(
        &self,
        project_name: &str,
    ) -> Result<RoutineSuccess, RoutineFailure> {
        // Redpanda still runs in Docker
        self.docker_provider.validate_redpanda_cluster(project_name)
    }

    fn validate_temporal(&self, project: &Project) -> Result<RoutineSuccess, RoutineFailure> {
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

/// Write a process ID to a PID file, creating parent directories as needed.
pub(crate) fn write_pid_file(pid_path: &Path, pid: u32) -> Result<(), NativeInfraError> {
    if let Some(parent) = pid_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| NativeInfraError::WritePidFile {
            path: pid_path.to_path_buf(),
            source: e,
        })?;
    }
    std::fs::write(pid_path, pid.to_string()).map_err(|e| NativeInfraError::WritePidFile {
        path: pid_path.to_path_buf(),
        source: e,
    })?;
    info!("Wrote PID {pid} to {}", pid_path.display());
    Ok(())
}

/// Read a PID from a file, send SIGTERM to the process, and remove the file.
///
/// This is a best-effort operation: if the file doesn't exist, the PID is invalid,
/// or the process is already gone, we log and move on.
pub fn kill_pid_file(pid_path: &Path) {
    let pid_str = match std::fs::read_to_string(pid_path) {
        Ok(s) => s,
        Err(_) => return, // No PID file — nothing to kill
    };

    let pid: u32 = match pid_str.trim().parse() {
        Ok(p) => p,
        Err(e) => {
            info!(
                "Invalid PID in {}: {e}. Removing stale file.",
                pid_path.display()
            );
            let _ = std::fs::remove_file(pid_path);
            return;
        }
    };

    info!("Sending SIGTERM to PID {pid} (from {})", pid_path.display());

    // Send SIGTERM via the `kill` command (available on all Unix systems).
    // Exit code 0 = signal sent, non-zero = process already gone or permission error.
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_write_pid_file_creates_file_with_pid() {
        let tmp = TempDir::new().unwrap();
        let pid_path = tmp.path().join("test.pid");

        write_pid_file(&pid_path, 12345).unwrap();

        assert!(pid_path.exists());
        assert_eq!(std::fs::read_to_string(&pid_path).unwrap(), "12345");
    }

    #[test]
    fn test_write_pid_file_creates_parent_dirs() {
        let tmp = TempDir::new().unwrap();
        let pid_path = tmp.path().join("a").join("b").join("c").join("test.pid");

        write_pid_file(&pid_path, 42).unwrap();

        assert!(pid_path.exists());
        assert_eq!(std::fs::read_to_string(&pid_path).unwrap(), "42");
    }

    #[test]
    fn test_kill_pid_file_removes_file_after_kill() {
        let tmp = TempDir::new().unwrap();
        let pid_path = tmp.path().join("test.pid");

        // Use a PID that almost certainly doesn't exist
        std::fs::write(&pid_path, "999999999").unwrap();

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
