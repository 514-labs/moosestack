use crate::cli::display::{show_message_wrapper, Message, MessageType};
use crate::project::{Project, ProjectFileError};

use tracing::{debug, error, info, warn};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

use super::bin;

#[derive(Debug, thiserror::Error)]
pub enum WorkerProcessError {
    #[error("Failed to start worker process")]
    IOError(#[from] std::io::Error),

    #[error("Failed to create library files")]
    ProjectFileError(#[from] ProjectFileError),
}

const SCRIPTS_BIN: &str = "scripts";

pub fn start_worker(project: &Project) -> Result<Child, WorkerProcessError> {
    let project_path = project.project_location.clone();
    let temporal_url = project.temporal_config.temporal_url();
    let temporal_namespace = project.temporal_config.get_temporal_namespace();
    let args: Vec<&str> = vec![
        "--temporal-url",
        temporal_url.as_str(),
        "--temporal-namespace",
        temporal_namespace.as_str(),
        "--client-cert",
        project.temporal_config.client_cert.as_str(),
        "--client-key",
        project.temporal_config.client_key.as_str(),
        "--api-key",
        project.temporal_config.api_key.as_str(),
    ];

    let mut scripts_process = bin::run(SCRIPTS_BIN, &project_path, &args, project)?;

    let stdout = scripts_process
        .stdout
        .take()
        .expect("Scripts process did not have a handle to stdout");

    let stderr = scripts_process
        .stderr
        .take()
        .expect("Scripts process did not have a handle to stderr");

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();

    tokio::spawn(async move {
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            let parts: Vec<&str> = line.split('|').collect();
            if parts.len() == 2 {
                let level = parts[0].trim();
                let message = parts[1].trim();
                match level {
                    // Logs from the worker
                    "INFO" => info!("{}", message),
                    "WARN" => warn!("{}", message),
                    "DEBUG" => debug!("{}", message),
                    "ERROR" => {
                        error!("{}", message);
                        show_message_wrapper(
                            MessageType::Error,
                            Message {
                                action: "Workflow".to_string(),
                                details: message.to_string(),
                            },
                        );
                    }
                    _ => info!("{}", message),
                }
            } else {
                // These can come from the user's code or other things that
                // get triggered as part of the workflow.
                if line.trim().is_empty() {
                    // Don't do anything for empty lines
                } else if line.contains("[CompilerPlugin]") {
                    // Only log, don't show UI message for compiler plugin logs
                    info!("{}", line);
                } else {
                    // For all other logs (likely user code), log & show UI message
                    info!("{}", line);
                    show_message_wrapper(
                        MessageType::Info,
                        Message {
                            action: "Workflow".to_string(),
                            details: line,
                        },
                    );
                }
            }
        }
    });

    tokio::spawn(async move {
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            error!("{}", line);
            show_message_wrapper(
                MessageType::Error,
                Message {
                    action: "Workflow".to_string(),
                    details: line.to_string(),
                },
            );
        }
    });

    Ok(scripts_process)
}
