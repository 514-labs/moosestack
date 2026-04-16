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
    let (url, expected_sha256) = temporal_download_metadata();
    manager.ensure_binary(
        "temporal",
        TEMPORAL_CLI_VERSION,
        &url,
        Some("temporal"),
        expected_sha256,
    )
}

/// Start the Temporal dev server as a child process.
///
/// Uses `temporal server start-dev` which bundles server + UI + SQLite storage,
/// replacing the Docker containers for temporal, postgresql, admin-tools, and ui.
pub fn start_command(
    binary: &Path,
    project: &Project,
) -> Result<tokio::process::Child, NativeInfraError> {
    let data_dir = native_data_dir(project);
    std::fs::create_dir_all(&data_dir).map_err(|e| NativeInfraError::CreateDir {
        path: data_dir.clone(),
        source: e,
    })?;

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
        .arg(&db_path)
        .arg("--namespace")
        .arg(&tc.namespace)
        .arg("--log-level")
        .arg("warn")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(false)
        .spawn()
        .map_err(|e| NativeInfraError::ProcessStart {
            name: "temporal".to_string(),
            source: e,
        })
}

/// Health check: try connecting to the gRPC port.
///
/// Uses a simple TCP connect instead of a full gRPC client since we just
/// need to verify the server is listening.
pub fn health_check(port: u16) -> Result<(), NativeInfraError> {
    use std::net::TcpStream;
    use std::time::Duration;

    let addr = format!("127.0.0.1:{port}");
    TcpStream::connect_timeout(
        &addr.parse().expect("valid socket addr"),
        Duration::from_secs(2),
    )
    .map_err(|_| NativeInfraError::HealthCheck {
        service: "Temporal".to_string(),
        reason: format!("connection refused on port {port}"),
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
        .join(super::NATIVE_INFRA_DIR)
        .join("temporal.pid")
}

/// Construct the platform-specific download URL and checksum for Temporal CLI.
fn temporal_download_metadata() -> (String, &'static str) {
    let (platform, arch, expected_sha256) = if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            (
                "darwin",
                "arm64",
                "7bb0a9badbe5e29284fbf3337ead34bde9d1ce44f07d07ebe3199c52ae1ecf9b",
            )
        } else {
            (
                "darwin",
                "amd64",
                "bf98e085504ed1e9dace3b65177885aff6ccc18576c8c45fd824e6da010718f4",
            )
        }
    } else if cfg!(target_arch = "aarch64") {
        (
            "linux",
            "arm64",
            "eaa8cf16c5ea5551cd1ee83dd7aa24ce6e9789bfed113a7a2a2dcd7be2a99767",
        )
    } else {
        (
            "linux",
            "amd64",
            "ca03976fb948b7084f4075dab55afb65915713498577ea68b483a14e3dfcd74e",
        )
    };

    (
        format!(
            "https://temporal.download/cli/archive/v{ver}?platform={platform}&arch={arch}",
            ver = TEMPORAL_CLI_VERSION,
        ),
        expected_sha256,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_temporal_download_metadata_uses_expected_checksum_shape() {
        let (url, checksum) = temporal_download_metadata();

        assert!(url.contains(TEMPORAL_CLI_VERSION));
        assert_eq!(checksum.len(), 64);
    }
}
