use std::path::Path;

use tokio::process::Child;

use crate::infrastructure::stream::{kafka::models::KafkaConfig, StreamConfig};
use tokio::io::AsyncBufReadExt;

use super::executor;
use crate::framework::python::executor::add_optional_arg;
use crate::project::Project;

pub fn run(
    project: &Project,
    project_location: &Path,
    kafka_config: &KafkaConfig,
    source_topic: &StreamConfig,
    target_topic: Option<&StreamConfig>,
    function_path: &Path,
    is_dmv2: bool,
) -> Result<Child, std::io::Error> {
    let dir = function_path
        .parent()
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();

    let module_name = function_path
        .with_extension("")
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();

    let mut args = vec![
        source_topic.as_json_string(),
        dir,
        module_name,
        kafka_config.broker.clone(),
    ];

    let target_topic_str = target_topic.map(|t| t.as_json_string());
    add_optional_arg(&mut args, "--target_topic_json", &target_topic_str);
    add_optional_arg(&mut args, "--sasl_username", &kafka_config.sasl_username);
    add_optional_arg(&mut args, "--sasl_password", &kafka_config.sasl_password);
    add_optional_arg(&mut args, "--sasl_mechanism", &kafka_config.sasl_mechanism);
    add_optional_arg(
        &mut args,
        "--security_protocol",
        &kafka_config.security_protocol,
    );
    if is_dmv2 {
        args.push("--dmv2".to_string());
    }

    let mut streaming_function_process = executor::run_python_command(
        project,
        project_location,
        executor::PythonCommand::StreamingFunctionRunner { args },
    )?;

    let stdout = streaming_function_process
        .stdout
        .take()
        .expect("Streaming process did not have a handle to stdout");

    let stderr = streaming_function_process
        .stderr
        .take()
        .expect("Streaming process did not have a handle to stderr");

    let mut stdout_reader = tokio::io::BufReader::new(stdout).lines();
    let mut stderr_reader = tokio::io::BufReader::new(stderr).lines();

    tokio::spawn(async move {
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            tracing::info!("{}", line);
        }
    });

    tokio::spawn(async move {
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            tracing::error!("{}", line);
        }
    });

    Ok(streaming_function_process)
}
