use super::errors::NativeInfraError;
use crate::infrastructure::stream::kafka::models::KafkaConfig;
use crate::project::Project;
use std::path::{Path, PathBuf};
use std::process::Stdio;

/// Environment variable to override the devkafka binary path.
const DEVKAFKA_BINARY_ENV: &str = "MOOSE_DEVKAFKA_BINARY";

/// Default binary path when no env var override is set.
///
/// When built as a workspace member, the devkafka binary is a sibling of
/// moose-cli in the same `target/debug/` directory.
fn default_binary_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sibling = dir.join("devkafka");
            if sibling.exists() {
                return sibling;
            }
        }
    }
    // Fallback: original hardcoded path for out-of-workspace builds
    home::home_dir()
        .expect("Could not determine home directory")
        .join("code/devkafka/target/debug/devkafka")
}

/// Returns the devkafka binary path, checking env var override first.
pub fn binary_path() -> Result<PathBuf, NativeInfraError> {
    let path = match std::env::var(DEVKAFKA_BINARY_ENV) {
        Ok(p) => PathBuf::from(p),
        Err(_) => default_binary_path(),
    };

    if path.exists() {
        Ok(path)
    } else {
        Err(NativeInfraError::BinaryNotFound { path })
    }
}

/// Extract the broker port from the KafkaConfig broker string (e.g. "localhost:19092" → 19092).
pub fn broker_port(config: &KafkaConfig) -> u16 {
    config
        .broker
        .rsplit(':')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(19092)
}

/// Start devkafka as a child process on the given port.
pub fn start_command(binary: &Path, port: u16) -> Result<tokio::process::Child, std::io::Error> {
    tokio::process::Command::new(binary)
        .arg("--host")
        .arg("0.0.0.0")
        .arg("--port")
        .arg(port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(false)
        .spawn()
}

/// TCP health check on the broker port.
pub fn health_check(port: u16) -> Result<(), NativeInfraError> {
    use std::net::TcpStream;
    use std::time::Duration;

    let addr = format!("127.0.0.1:{port}");
    TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_secs(2)).map_err(|_| {
        NativeInfraError::HealthCheck {
            service: "devkafka".to_string(),
            reason: format!("connection refused on port {port}"),
        }
    })?;

    Ok(())
}

/// Returns the PID file path for the devkafka process within a project.
pub fn pid_file_path(project: &Project) -> PathBuf {
    project
        .project_location
        .join(".moose/native_infra/devkafka.pid")
}
