use tracing::{error, info};
use std::path::Path;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

use super::executor;
use crate::framework::blocks::model::BlocksError;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::project::Project;

pub fn run(
    project: &Project,
    project_location: &Path,
    clickhouse_config: ClickHouseConfig,
    blocks_path: &Path,
) -> Result<Child, BlocksError> {
    let args = vec![
        blocks_path.to_str().unwrap().to_string(),
        clickhouse_config.db_name,
        clickhouse_config.host,
        clickhouse_config.host_port.to_string(),
        clickhouse_config.user,
        clickhouse_config.password,
        clickhouse_config.use_ssl.to_string(),
    ];

    let mut blocks_process = executor::run_python_program(
        project,
        project_location,
        executor::PythonProgram::BlocksRunner { args },
    )?;

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
