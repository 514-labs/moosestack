use std::path::PathBuf;

/// Errors that can occur when managing native infrastructure binaries.
#[derive(Debug, thiserror::Error)]
pub enum NativeInfraError {
    #[error(
        "unsupported platform: {os}/{arch} — native binaries are only available for macOS arm64"
    )]
    UnsupportedPlatform {
        os: &'static str,
        arch: &'static str,
    },

    #[error("failed to download binary from {url}")]
    Download {
        url: String,
        #[source]
        source: reqwest::Error,
    },

    #[error("HTTP {status} when downloading binary from {url}")]
    DownloadStatus { url: String, status: u16 },

    #[error("failed to extract archive to {dest}")]
    Extract {
        dest: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to read file {path}")]
    ReadFile {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to write file {path}")]
    WriteFile {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to remove path {path}")]
    RemovePath {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("binary not found at expected path {path}")]
    BinaryNotFound { path: PathBuf },

    #[error(
        "checksum verification failed for {name} v{version} from {url}: expected {expected_sha256}, got {actual_sha256}"
    )]
    ChecksumMismatch {
        name: String,
        version: String,
        url: String,
        expected_sha256: String,
        actual_sha256: String,
    },

    #[error("failed to set executable permissions on {path}")]
    Chmod {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to create directory {path}")]
    CreateDir {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to write config file {path}")]
    WriteConfig {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("native process '{name}' failed to start")]
    ProcessStart {
        name: String,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to write PID file {path}")]
    WritePidFile {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("health check failed for {service}: {reason}")]
    HealthCheck { service: String, reason: String },

    #[error("{0}")]
    PortConflict(#[from] super::preflight::PortConflictError),

    #[error(transparent)]
    InvalidPort(#[from] super::preflight::InvalidPortError),
}
