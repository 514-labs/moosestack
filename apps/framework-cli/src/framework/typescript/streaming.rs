use tracing::{error, info};
use std::path::Path;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

use super::bin;
use crate::infrastructure::stream::kafka::models::KafkaConfig;
use crate::infrastructure::stream::StreamConfig;
use crate::project::Project;

const FUNCTION_RUNNER_BIN: &str = "streaming-functions";

// TODO: we currently refer kafka configuration here. If we want to be able to
// abstract this to other type of streaming engine, we will need to be able to abstract this away.
#[allow(clippy::too_many_arguments)]
pub fn run(
    kafka_config: &KafkaConfig,
    source_topic: &StreamConfig,
    target_topic: Option<&StreamConfig>,
    streaming_function_file: &Path,
    project: &Project,
    project_path: &Path,
    max_subscriber_count: usize,
    is_dmv2: bool,
    // TODO Remove the anyhow type here
) -> Result<Child, std::io::Error> {
    let subscriber_count_str = max_subscriber_count.to_string();

    let source_topic_config_str = source_topic.as_json_string();
    let target_topic_config_str = target_topic.map(|t| t.as_json_string());

    let mut args: Vec<&str> = vec![
        source_topic_config_str.as_str(),
        streaming_function_file.to_str().unwrap(),
        &kafka_config.broker,
        &subscriber_count_str,
    ];

    if let Some(ref target_str) = target_topic_config_str {
        args.push("--target-topic");
        args.push(target_str.as_str());
    }

    info!(
        "Starting a streaming function with the following public arguments: {:#?}",
        args
    );

    if kafka_config.sasl_username.is_some() {
        args.push("--sasl-username");
        args.push(kafka_config.sasl_username.as_ref().unwrap());
    }

    if kafka_config.sasl_password.is_some() {
        args.push("--sasl-password");
        args.push(kafka_config.sasl_password.as_ref().unwrap());
    }

    if kafka_config.sasl_mechanism.is_some() {
        args.push("--sasl-mechanism");
        args.push(kafka_config.sasl_mechanism.as_ref().unwrap());
    }

    if kafka_config.security_protocol.is_some() {
        args.push("--security-protocol");
        args.push(kafka_config.security_protocol.as_ref().unwrap());
    }

    if is_dmv2 {
        args.push("--is-dmv2");
    }

    let mut streaming_function_process =
        bin::run(FUNCTION_RUNNER_BIN, project_path, &args, project)?;

    let stdout = streaming_function_process
        .stdout
        .take()
        .expect("Streaming process did not have a handle to stdout");

    let stderr = streaming_function_process
        .stderr
        .take()
        .expect("Streaming process did not have a handle to stderr");

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

    Ok(streaming_function_process)
}
