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

    #[error("binary not found at expected path {path}")]
    BinaryNotFound { path: PathBuf },

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
}
