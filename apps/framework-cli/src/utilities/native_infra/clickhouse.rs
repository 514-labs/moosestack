use super::binary_manager::BinaryManager;
use super::errors::NativeInfraError;
use crate::project::Project;
use crate::utilities::constants::CLICKHOUSE_BINARY_VERSION;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tracing::info;

/// Data directory layout under `{project}/.moose/native_infra/clickhouse/`.
const NATIVE_CH_DIR: &str = "native_infra/clickhouse";

/// Ensure the ClickHouse binary is cached and return its path.
pub fn ensure_binary(manager: &BinaryManager) -> Result<PathBuf, NativeInfraError> {
    let url = clickhouse_download_url();
    manager.ensure_binary("clickhouse", CLICKHOUSE_BINARY_VERSION, &url, None)
}

/// Generate the ClickHouse config.xml inside the project's native data dir.
///
/// Uses the embedded-keeper configuration so a single process replaces both
/// `clickhousedb` and `clickhouse-keeper` containers.
pub fn write_config(project: &Project) -> Result<PathBuf, NativeInfraError> {
    let data_dir = native_data_dir(project);
    std::fs::create_dir_all(data_dir.join("data")).map_err(|e| NativeInfraError::CreateDir {
        path: data_dir.join("data"),
        source: e,
    })?;
    std::fs::create_dir_all(data_dir.join("logs")).map_err(|e| NativeInfraError::CreateDir {
        path: data_dir.join("logs"),
        source: e,
    })?;

    let config_path = data_dir.join("config.xml");

    let ch = &project.clickhouse_config;
    let config_xml = format!(
        r#"<?xml version="1.0"?>
<clickhouse>
    <logger>
        <level>warning</level>
        <log>{log_dir}/clickhouse-server.log</log>
        <errorlog>{log_dir}/clickhouse-server.err.log</errorlog>
    </logger>

    <http_port>{http_port}</http_port>
    <tcp_port>{native_port}</tcp_port>
    <listen_host>127.0.0.1</listen_host>

    <path>{data_path}/</path>
    <tmp_path>{data_path}/tmp/</tmp_path>
    <user_files_path>{data_path}/user_files/</user_files_path>
    <format_schema_path>{data_path}/format_schemas/</format_schema_path>

    <users>
        <{user}>
            <password>{password}</password>
            <networks>
                <ip>::1</ip>
                <ip>127.0.0.1</ip>
            </networks>
            <profile>default</profile>
            <quota>default</quota>
            <access_management>1</access_management>
        </{user}>
    </users>

    <profiles>
        <default/>
    </profiles>

    <quotas>
        <default/>
    </quotas>

    <!-- Embedded Keeper (replaces separate clickhouse-keeper container) -->
    <keeper_server>
        <tcp_port>9181</tcp_port>
        <server_id>1</server_id>
        <log_storage_path>{data_path}/coordination/log</log_storage_path>
        <snapshot_storage_path>{data_path}/coordination/snapshots</snapshot_storage_path>
        <coordination_settings>
            <operation_timeout_ms>10000</operation_timeout_ms>
            <session_timeout_ms>30000</session_timeout_ms>
            <raft_logs_level>warning</raft_logs_level>
        </coordination_settings>
        <raft_configuration>
            <server>
                <id>1</id>
                <hostname>127.0.0.1</hostname>
                <port>9234</port>
            </server>
        </raft_configuration>
    </keeper_server>

    <zookeeper>
        <node>
            <host>127.0.0.1</host>
            <port>9181</port>
        </node>
    </zookeeper>
</clickhouse>
"#,
        http_port = ch.host_port,
        native_port = ch.native_port,
        user = ch.user,
        password = ch.password,
        data_path = data_dir.join("data").display(),
        log_dir = data_dir.join("logs").display(),
    );

    std::fs::write(&config_path, config_xml).map_err(|e| NativeInfraError::WriteConfig {
        path: config_path.clone(),
        source: e,
    })?;

    info!("Wrote ClickHouse config to {}", config_path.display());
    Ok(config_path)
}

/// Start ClickHouse server as a child process.
///
/// Returns a `tokio::process::Child` suitable for `RestartingProcess`.
pub fn start_command(
    binary: &Path,
    config_path: &Path,
) -> Result<tokio::process::Child, std::io::Error> {
    tokio::process::Command::new(binary)
        .arg("server")
        .arg(format!("--config-file={}", config_path.display()))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(false)
        .spawn()
}

/// HTTP health check: GET `http://127.0.0.1:{port}/ping` → "Ok.\n"
pub fn health_check(port: i32) -> Result<(), NativeInfraError> {
    let url = format!("http://127.0.0.1:{port}/ping");
    let resp = reqwest::blocking::get(&url).map_err(|_| NativeInfraError::HealthCheck {
        service: "ClickHouse".to_string(),
        reason: format!("connection refused on port {port}"),
    })?;

    if resp.status().is_success() {
        Ok(())
    } else {
        Err(NativeInfraError::HealthCheck {
            service: "ClickHouse".to_string(),
            reason: format!("HTTP {}", resp.status()),
        })
    }
}

/// Create the default database if it doesn't exist.
///
/// Docker's ClickHouse image auto-creates the database via the `CLICKHOUSE_DB`
/// env var in its entrypoint. Native mode has no such entrypoint, so we issue
/// the `CREATE DATABASE IF NOT EXISTS` query after the server is healthy.
pub fn ensure_database(project: &Project) -> Result<(), NativeInfraError> {
    let ch = &project.clickhouse_config;
    let url = format!(
        "http://127.0.0.1:{}/?user={}&password={}",
        ch.host_port, ch.user, ch.password
    );
    let query = format!("CREATE DATABASE IF NOT EXISTS `{}`", ch.db_name);

    let client = reqwest::blocking::Client::new();
    let resp = client.post(&url).body(query.clone()).send().map_err(|_| {
        NativeInfraError::HealthCheck {
            service: "ClickHouse".to_string(),
            reason: "failed to send CREATE DATABASE query".to_string(),
        }
    })?;

    if resp.status().is_success() {
        info!("Created database `{}`", ch.db_name);
        Ok(())
    } else {
        let body = resp.text().unwrap_or_default();
        Err(NativeInfraError::HealthCheck {
            service: "ClickHouse".to_string(),
            reason: format!("CREATE DATABASE failed: {body}"),
        })
    }
}

/// Returns the native data directory for ClickHouse within a project.
pub fn native_data_dir(project: &Project) -> PathBuf {
    project.project_location.join(".moose").join(NATIVE_CH_DIR)
}

/// Returns the PID file path for the native ClickHouse process.
pub fn pid_file_path(project: &Project) -> PathBuf {
    project
        .project_location
        .join(".moose/native_infra/clickhouse.pid")
}

/// Construct the platform-specific download URL for ClickHouse.
fn clickhouse_download_url() -> String {
    if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        format!(
            "https://github.com/ClickHouse/ClickHouse/releases/download/v{ver}/clickhouse-macos-aarch64",
            ver = CLICKHOUSE_BINARY_VERSION
        )
    } else if cfg!(target_os = "macos") && cfg!(target_arch = "x86_64") {
        format!(
            "https://github.com/ClickHouse/ClickHouse/releases/download/v{ver}/clickhouse-macos",
            ver = CLICKHOUSE_BINARY_VERSION
        )
    } else if cfg!(target_os = "linux") && cfg!(target_arch = "aarch64") {
        format!(
            "https://github.com/ClickHouse/ClickHouse/releases/download/v{ver}/clickhouse-linux-aarch64",
            ver = CLICKHOUSE_BINARY_VERSION
        )
    } else {
        format!(
            "https://github.com/ClickHouse/ClickHouse/releases/download/v{ver}/clickhouse-linux-amd64",
            ver = CLICKHOUSE_BINARY_VERSION
        )
    }
}
