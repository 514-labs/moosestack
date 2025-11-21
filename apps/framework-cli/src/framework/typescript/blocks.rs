use tracing::{error, info};
use std::path::Path;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

use super::bin;
use crate::framework::blocks::model::BlocksError;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::project::Project;

const BLOCKS_RUNNER_BIN: &str = "blocks";

// TODO: Abstract away ClickhouseConfig to support other databases
// TODO: Bubble up compilation errors to the user
pub fn run(
    clickhouse_config: ClickHouseConfig,
    blocks_path: &Path,
    project: &Project,
    project_path: &Path,
) -> Result<Child, BlocksError> {
    let host_port = clickhouse_config.host_port.to_string();
    let mut args: Vec<String> = vec![
        blocks_path.to_str().unwrap().to_string(),
        clickhouse_config.db_name.clone(),
        clickhouse_config.host.clone(),
        host_port,
        clickhouse_config.user.clone(),
        clickhouse_config.password.clone(),
    ];

    if clickhouse_config.use_ssl {
        args.push("--clickhouse-use-ssl".to_string());
    }

    let args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let mut blocks_process = bin::run(BLOCKS_RUNNER_BIN, project_path, &args, project)?;

    let stdout = blocks_process
        .stdout
        .take()
        .expect("Blocks process did not have a handle to stdout");

    let stderr = blocks_process
        .stderr
        .take()
        .expect("Blocks process did not have a handle to stderr");

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();

    tokio::spawn(async move {
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            info!("{}", line);
        }
    });

    tokio::spawn(async move {
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            error!("{}", line);
        }
    });

    Ok(blocks_process)
}
