use std::path::Path;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tracing::info;

use super::bin;
use crate::infrastructure::stream::kafka::models::KafkaConfig;
use crate::infrastructure::stream::StreamConfig;
use crate::project::Project;

const FUNCTION_RUNNER_BIN: &str = "streaming-functions";

// TODO: we currently refer kafka configuration here. If we want to be able to
// abstract this to other type of streaming engine, we will need to be able to abstract this away.
pub fn run(
    kafka_config: &KafkaConfig,
    source_topic: &StreamConfig,
    target_topic: Option<&StreamConfig>,
    streaming_function_file: &Path,
    project: &Project,
    project_path: &Path,
    max_subscriber_count: usize,
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

    if let Some(username) = &kafka_config.sasl_username {
        args.push("--sasl-username");
        args.push(username);
    }

    if let Some(password) = &kafka_config.sasl_password {
        args.push("--sasl-password");
        args.push(password);
    }

    if let Some(mechanism) = &kafka_config.sasl_mechanism {
        args.push("--sasl-mechanism");
        args.push(mechanism);
    }

    if let Some(protocol) = &kafka_config.security_protocol {
        args.push("--security-protocol");
        args.push(protocol);
    }

    if project.log_payloads {
        args.push("--log-payloads");
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

    tokio::spawn(async move {
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            info!("{}", line);
        }
    });

    // Spawn structured logger for stderr
    crate::cli::logger::spawn_stderr_structured_logger(
        stderr,
        "function_name",
        crate::cli::logger::resource_type::TRANSFORM,
    );

    Ok(streaming_function_process)
}
