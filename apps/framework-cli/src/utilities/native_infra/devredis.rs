use super::errors::NativeInfraError;
use crate::project::Project;
use std::path::{Path, PathBuf};
use std::process::Stdio;

/// Environment variable to override the devredis binary path.
const DEVREDIS_BINARY_ENV: &str = "MOOSE_DEVREDIS_BINARY";

/// Default binary path when no env var override is set.
///
/// When built as a workspace member, the devredis binary is a sibling of
/// moose-cli in the same `target/debug/` directory.
fn default_binary_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sibling = dir.join("devredis");
            if sibling.exists() {
                return sibling;
            }
        }
    }
    // Fallback: original hardcoded path for out-of-workspace builds
    home::home_dir()
        .expect("Could not determine home directory")
        .join("code/devredis/target/debug/devredis")
}

/// Returns the devredis binary path, checking env var override first.
pub fn binary_path() -> Result<PathBuf, NativeInfraError> {
    let path = match std::env::var(DEVREDIS_BINARY_ENV) {
        Ok(p) => PathBuf::from(p),
        Err(_) => default_binary_path(),
    };

    if path.exists() {
        Ok(path)
    } else {
        Err(NativeInfraError::BinaryNotFound { path })
    }
}

/// Start devredis as a child process on the given port.
///
/// The port is passed via the `DEVREDIS_PORT` environment variable.
pub fn start_command(binary: &Path, port: u16) -> Result<tokio::process::Child, std::io::Error> {
    tokio::process::Command::new(binary)
        .env("DEVREDIS_PORT", port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(false)
        .spawn()
}

/// TCP health check on the Redis port.
pub fn health_check(port: u16) -> Result<(), NativeInfraError> {
    use std::net::TcpStream;
    use std::time::Duration;

    let addr = format!("127.0.0.1:{port}");
    TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_secs(2)).map_err(|_| {
        NativeInfraError::HealthCheck {
            service: "devredis".to_string(),
            reason: format!("connection refused on port {port}"),
        }
    })?;

    Ok(())
}

/// Returns the PID file path for the devredis process within a project.
pub fn pid_file_path(project: &Project) -> PathBuf {
    project
        .project_location
        .join(".moose/native_infra/devredis.pid")
}
