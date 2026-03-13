use super::binary_manager::BinaryManager;
use super::errors::NativeInfraError;
use crate::project::Project;
use crate::utilities::constants::TEMPORAL_CLI_VERSION;
use std::path::{Path, PathBuf};
use std::process::Stdio;

/// Data directory layout under `{project}/.moose/native_infra/temporal/`.
const NATIVE_TEMPORAL_DIR: &str = "native_infra/temporal";

/// Ensure the Temporal CLI binary is cached and return its path.
pub fn ensure_binary(manager: &BinaryManager) -> Result<PathBuf, NativeInfraError> {
    let url = temporal_download_url();
    manager.ensure_binary("temporal", TEMPORAL_CLI_VERSION, &url, Some("temporal"))
}

/// Start the Temporal dev server as a child process.
///
/// Uses `temporal server start-dev` which bundles server + UI + SQLite storage,
/// replacing the Docker containers for temporal, postgresql, admin-tools, and ui.
pub fn start_command(
    binary: &Path,
    project: &Project,
) -> Result<tokio::process::Child, std::io::Error> {
    let data_dir = native_data_dir(project);
    std::fs::create_dir_all(&data_dir)?;

    let db_path = data_dir.join("temporal.db");
    let tc = &project.temporal_config;

    tokio::process::Command::new(binary)
        .arg("server")
        .arg("start-dev")
        .arg("--port")
        .arg(tc.temporal_port.to_string())
        .arg("--ui-port")
        .arg(tc.ui_port.to_string())
        .arg("--db-filename")
        .arg(db_path.to_string_lossy().as_ref())
        .arg("--namespace")
        .arg(&tc.namespace)
        .arg("--log-level")
        .arg("warn")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(false)
        .spawn()
}

/// Health check: try connecting to the gRPC port.
///
/// Uses a simple TCP connect instead of a full gRPC client since we just
/// need to verify the server is listening.
pub fn health_check(port: u16) -> Result<(), NativeInfraError> {
    use std::net::TcpStream;
    use std::time::Duration;

    let addr = format!("127.0.0.1:{port}");
    TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_secs(2)).map_err(|_| {
        NativeInfraError::HealthCheck {
            service: "Temporal".to_string(),
            reason: format!("connection refused on port {port}"),
        }
    })?;

    Ok(())
}

/// Returns the native data directory for Temporal within a project.
pub fn native_data_dir(project: &Project) -> PathBuf {
    project
        .project_location
        .join(".moose")
        .join(NATIVE_TEMPORAL_DIR)
}

/// Returns the PID file path for the native Temporal process.
pub fn pid_file_path(project: &Project) -> PathBuf {
    project
        .project_location
        .join(".moose/native_infra/temporal.pid")
}

/// Construct the platform-specific download URL for Temporal CLI.
fn temporal_download_url() -> String {
    let (platform, arch) = if cfg!(target_os = "macos") {
        (
            "darwin",
            if cfg!(target_arch = "aarch64") {
                "arm64"
            } else {
                "amd64"
            },
        )
    } else {
        (
            "linux",
            if cfg!(target_arch = "aarch64") {
                "arm64"
            } else {
                "amd64"
            },
        )
    };

    format!(
        "https://temporal.download/cli/archive/v{ver}?platform={platform}&arch={arch}",
        ver = TEMPORAL_CLI_VERSION,
    )
}
