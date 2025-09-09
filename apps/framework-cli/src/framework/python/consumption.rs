use crate::cli::display::message::{Message, MessageType};
use crate::framework::consumption::model::ConsumptionQueryParam;
use crate::framework::python::executor::{run_python_program, PythonProgram};
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::processes::consumption_registry::ConsumptionError;
use crate::project::{JwtConfig, Project};
use crate::utilities::constants::{CONSUMPTION_WRAPPER_PACKAGE_NAME, UTILS_WRAPPER_PACKAGE_NAME};
use log::{error, info};
use std::fs;
use std::path::Path;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

use super::executor;

pub fn run(
    project: &Project,
    clickhouse_config: &ClickHouseConfig,
    jwt_config: &Option<JwtConfig>,
    consumption_path: &Path,
    proxy_port: Option<u16>,
) -> Result<Child, ConsumptionError> {
    // Create the wrapper lib files inside the .moose directory
    let internal_dir = project.internal_dir()?;
    let consumption_runner_dir = internal_dir.join(CONSUMPTION_WRAPPER_PACKAGE_NAME);
    let utils_lib_dir = consumption_runner_dir.join(UTILS_WRAPPER_PACKAGE_NAME);

    // Create the directory if it doesn't exist
    if !consumption_runner_dir.exists() {
        fs::create_dir(&consumption_runner_dir)?;
    }
    if !utils_lib_dir.exists() {
        fs::create_dir(&utils_lib_dir)?;
    }

    // Overwrite the wrapper files
    fs::write(
        utils_lib_dir.join("__init__.py"),
        include_str!("./utils/__init__.py"),
    )?;
    fs::write(
        utils_lib_dir.join("temporal.py"),
        include_str!("./utils/temporal.py"),
    )?;

    let jwt_secret = jwt_config
        .as_ref()
        .map(|jwt| jwt.secret.clone())
        .unwrap_or("".to_string());

    let jwt_issuer = jwt_config
        .as_ref()
        .map(|jwt| jwt.issuer.clone())
        .unwrap_or("".to_string());

    let jwt_audience = jwt_config
        .as_ref()
        .map(|jwt| jwt.audience.clone())
        .unwrap_or("".to_string());

    let enforce_on_all_consumptions_apis = jwt_config
        .as_ref()
        .map(|jwt| jwt.enforce_on_all_consumptions_apis.to_string())
        .unwrap_or("false".to_string());

    let args = vec![
        consumption_path.to_str().unwrap().to_string(),
        clickhouse_config.db_name.clone(),
        clickhouse_config.host.clone(),
        clickhouse_config.host_port.to_string(),
        clickhouse_config.user.clone(),
        clickhouse_config.password.clone(),
        clickhouse_config.use_ssl.to_string(),
        jwt_secret,
        jwt_issuer,
        jwt_audience,
        enforce_on_all_consumptions_apis,
        project.temporal_config.temporal_url(),
        project.temporal_config.get_temporal_namespace(),
        project.temporal_config.client_cert.clone(),
        project.temporal_config.client_key.clone(),
        project.temporal_config.api_key.clone(),
        project.features.data_model_v2.to_string(),
        proxy_port.unwrap_or(4001).to_string(),
    ];

    let mut consumption_process = executor::run_python_program(
        project,
        &project.project_location,
        executor::PythonProgram::ConsumptionRunner { args },
    )?;

    let stdout = consumption_process
        .stdout
        .take()
        .expect("Analytics api process did not have a handle to stdout");

    let stderr = consumption_process
        .stderr
        .take()
        .expect("Analytics api process did not have a handle to stderr");

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();

    tokio::spawn(async move {
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            if let Some(stripped) = line.strip_prefix("[QueryClient] | ") {
                show_message!(
                    MessageType::Info,
                    Message {
                        action: "API".to_string(),
                        details: stripped.to_string(),
                    }
                );
            } else {
                info!("{}", line);
            }
        }
    });

    tokio::spawn(async move {
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            error!("{}", line);
        }
    });

    Ok(consumption_process)
}

pub async fn load_python_query_param(
    project: &Project,
    project_location: &Path,
    path: &Path,
) -> Result<Vec<ConsumptionQueryParam>, std::io::Error> {
    let args = vec![path.file_name().unwrap().to_str().unwrap().to_string()];
    let process = run_python_program(
        project,
        project_location,
        PythonProgram::LoadApiParam { args },
    )?;
    let output = process.wait_with_output().await?;

    if !output.status.success() {
        return Err(std::io::Error::other(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }
    let raw_string_stdout = String::from_utf8_lossy(&output.stdout);

    let config = serde_json::from_str::<crate::framework::consumption::loader::QueryParamOutput>(
        &raw_string_stdout,
    )
    .map_err(std::io::Error::other)?;
    Ok(config.params)
}
