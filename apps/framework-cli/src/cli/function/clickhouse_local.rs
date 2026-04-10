use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tracing::info;

use super::errors::ClickHouseLocalError;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::olap::clickhouse::mapper::std_table_to_clickhouse_table;
use crate::infrastructure::olap::clickhouse::queries::{self, ClickhouseEngine};
use crate::utilities::native_infra::binary_manager::BinaryManager;

/// Directory under the project root for function-mode data.
const FUNCTION_DATA_DIR: &str = ".moose/function";

/// Ensure the ClickHouse binary is downloaded and cached, returning its path.
pub fn ensure_binary() -> Result<PathBuf, ClickHouseLocalError> {
    let manager = BinaryManager::new().map_err(ClickHouseLocalError::BinarySetup)?;
    crate::utilities::native_infra::clickhouse::ensure_binary(&manager)
        .map_err(ClickHouseLocalError::BinarySetup)
}

/// Write a minimal ClickHouse config for serverless mode.
///
/// No Keeper, no replication, no macros — just enough for S3/IcebergS3 table engines.
pub fn write_config(project_dir: &Path, port: u16) -> Result<PathBuf, ClickHouseLocalError> {
    let data_dir = project_dir.join(FUNCTION_DATA_DIR);
    std::fs::create_dir_all(&data_dir).map_err(|e| ClickHouseLocalError::WriteConfig {
        path: data_dir.clone(),
        source: e,
    })?;

    let config_path = data_dir.join("config.xml");
    let tmp_path = data_dir.join("tmp");
    std::fs::create_dir_all(&tmp_path).map_err(|e| ClickHouseLocalError::WriteConfig {
        path: tmp_path.clone(),
        source: e,
    })?;

    let config_xml = format!(
        r#"<?xml version="1.0"?>
<clickhouse>
    <logger>
        <level>warning</level>
        <console>1</console>
    </logger>

    <http_port>{port}</http_port>
    <listen_host>127.0.0.1</listen_host>

    <path>{data_path}/</path>
    <tmp_path>{tmp_path}/</tmp_path>

    <users>
        <default>
            <password></password>
            <networks>
                <ip>::1</ip>
                <ip>127.0.0.1</ip>
            </networks>
            <profile>default</profile>
            <quota>default</quota>
            <access_management>1</access_management>
        </default>
    </users>

    <profiles>
        <default/>
    </profiles>

    <quotas>
        <default/>
    </quotas>
</clickhouse>
"#,
        port = port,
        data_path = data_dir.join("data").display(),
        tmp_path = tmp_path.display(),
    );

    std::fs::create_dir_all(data_dir.join("data")).map_err(|e| {
        ClickHouseLocalError::WriteConfig {
            path: data_dir.join("data"),
            source: e,
        }
    })?;

    std::fs::write(&config_path, config_xml).map_err(|e| ClickHouseLocalError::WriteConfig {
        path: config_path.clone(),
        source: e,
    })?;

    info!("Wrote clickhouse-local config to {}", config_path.display());
    Ok(config_path)
}

/// Start clickhouse-local in server mode as a child process.
///
/// Returns a `tokio::process::Child`. The caller is responsible for keeping it alive.
pub fn start(
    binary: &Path,
    config_path: &Path,
) -> Result<tokio::process::Child, ClickHouseLocalError> {
    info!(
        "Starting clickhouse-local: {} server --config-file={}",
        binary.display(),
        config_path.display()
    );

    tokio::process::Command::new(binary)
        .arg("server")
        .arg(format!("--config-file={}", config_path.display()))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true) // Kill when the function process exits
        .spawn()
        .map_err(ClickHouseLocalError::ProcessStart)
}

/// Wait until clickhouse-local responds to HTTP `/ping`, or timeout.
pub async fn wait_healthy(port: u16, timeout: Duration) -> Result<(), ClickHouseLocalError> {
    let deadline = tokio::time::Instant::now() + timeout;
    let url = format!("http://127.0.0.1:{port}/ping");
    let client = reqwest::Client::new();

    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(ClickHouseLocalError::HealthCheckTimeout {
                port,
                timeout_secs: timeout.as_secs(),
            });
        }

        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                info!("clickhouse-local healthy on port {port}");
                return Ok(());
            }
        }

        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// Create the default database if it doesn't exist.
pub async fn ensure_database(port: u16, db_name: &str) -> Result<(), ClickHouseLocalError> {
    let url = format!("http://127.0.0.1:{port}/");
    let query = format!("CREATE DATABASE IF NOT EXISTS `{db_name}`");

    let client = reqwest::Client::new();
    let resp = client.post(&url).body(query).send().await.map_err(|e| {
        ClickHouseLocalError::CreateDatabase {
            db_name: db_name.to_string(),
            reason: e.to_string(),
        }
    })?;

    if resp.status().is_success() {
        info!("Created database `{db_name}`");
        Ok(())
    } else {
        let body = resp.text().await.unwrap_or_default();
        Err(ClickHouseLocalError::CreateDatabase {
            db_name: db_name.to_string(),
            reason: body,
        })
    }
}

/// Returns true if the table engine is supported in serverless mode.
pub fn is_serverless_compatible(engine: &ClickhouseEngine) -> bool {
    matches!(
        engine,
        ClickhouseEngine::S3 { .. } | ClickhouseEngine::IcebergS3 { .. }
    )
}

/// Engine name for error messages.
fn engine_display_name(engine: &ClickhouseEngine) -> &'static str {
    match engine {
        ClickhouseEngine::MergeTree => "MergeTree",
        ClickhouseEngine::ReplacingMergeTree { .. } => "ReplacingMergeTree",
        ClickhouseEngine::AggregatingMergeTree => "AggregatingMergeTree",
        ClickhouseEngine::SummingMergeTree { .. } => "SummingMergeTree",
        ClickhouseEngine::CollapsingMergeTree { .. } => "CollapsingMergeTree",
        ClickhouseEngine::VersionedCollapsingMergeTree { .. } => "VersionedCollapsingMergeTree",
        ClickhouseEngine::ReplicatedMergeTree { .. } => "ReplicatedMergeTree",
        ClickhouseEngine::ReplicatedReplacingMergeTree { .. } => "ReplicatedReplacingMergeTree",
        ClickhouseEngine::ReplicatedAggregatingMergeTree { .. } => "ReplicatedAggregatingMergeTree",
        ClickhouseEngine::ReplicatedSummingMergeTree { .. } => "ReplicatedSummingMergeTree",
        ClickhouseEngine::ReplicatedCollapsingMergeTree { .. } => "ReplicatedCollapsingMergeTree",
        ClickhouseEngine::ReplicatedVersionedCollapsingMergeTree { .. } => {
            "ReplicatedVersionedCollapsingMergeTree"
        }
        ClickhouseEngine::S3 { .. } => "S3",
        ClickhouseEngine::S3Queue { .. } => "S3Queue",
        ClickhouseEngine::IcebergS3 { .. } => "IcebergS3",
        ClickhouseEngine::Buffer(_) => "Buffer",
        ClickhouseEngine::Distributed { .. } => "Distributed",
        ClickhouseEngine::Kafka { .. } => "Kafka",
        ClickhouseEngine::Merge { .. } => "Merge",
    }
}

/// Create S3/IcebergS3 tables from the infrastructure map.
///
/// Filters to serverless-compatible engines only, warns about skipped tables,
/// and executes `CREATE TABLE IF NOT EXISTS` DDL against clickhouse-local.
pub async fn create_tables(
    infra_map: &InfrastructureMap,
    port: u16,
    db_name: &str,
) -> Result<usize, ClickHouseLocalError> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/");
    let mut created = 0;

    for (name, table) in &infra_map.tables {
        if !is_serverless_compatible(&table.engine) {
            info!(
                "Skipping table `{name}` (engine {} not supported in serverless mode)",
                engine_display_name(&table.engine)
            );
            continue;
        }

        let ch_table = std_table_to_clickhouse_table(table).map_err(|e| {
            ClickHouseLocalError::DdlGeneration {
                table: name.clone(),
                reason: e.to_string(),
            }
        })?;

        let ddl = queries::create_table_query(db_name, ch_table, false).map_err(|e| {
            ClickHouseLocalError::DdlGeneration {
                table: name.clone(),
                reason: e.to_string(),
            }
        })?;

        info!("Creating table `{name}`");

        let resp = client
            .post(&url)
            .body(ddl.clone())
            .send()
            .await
            .map_err(|e| ClickHouseLocalError::CreateTable {
                table: name.clone(),
                reason: e.to_string(),
            })?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ClickHouseLocalError::CreateTable {
                table: name.clone(),
                reason: body,
            });
        }

        created += 1;
    }

    info!("Created {created} serverless table(s)");
    Ok(created)
}

/// Validate that the infrastructure map has at least one serverless-compatible table.
///
/// Returns the names of tables that use unsupported engines (for warnings),
/// and errors if there are zero compatible tables.
pub fn validate_tables(infra_map: &InfrastructureMap) -> (Vec<String>, Vec<String>) {
    let mut compatible = Vec::new();
    let mut incompatible = Vec::new();

    for (name, table) in &infra_map.tables {
        if is_serverless_compatible(&table.engine) {
            compatible.push(name.clone());
        } else {
            incompatible.push(format!("{} ({})", name, engine_display_name(&table.engine)));
        }
    }

    (compatible, incompatible)
}
