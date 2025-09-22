use anyhow::Result;
use log::{error, info, warn};
use std::fs;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

use crate::cli::display::{show_message_wrapper, Message, MessageType};
use crate::project::{Project, ProjectFileError};
use crate::utilities::constants::{PYTHON_WORKER_WRAPPER_PACKAGE_NAME, UTILS_WRAPPER_PACKAGE_NAME};

use super::executor::{run_python_program, PythonProgram};

#[derive(Debug, thiserror::Error)]
pub enum WorkerProcessError {
    #[error("Failed to start worker process")]
    IOError(#[from] std::io::Error),

    #[error("Failed to create library files")]
    ProjectFileError(#[from] ProjectFileError),
}

pub async fn start_worker(project: &Project) -> Result<Child, WorkerProcessError> {
    // Create the wrapper lib files inside the .moose directory
    let internal_dir = project.internal_dir()?;
    let python_worker_lib_dir = internal_dir.join(PYTHON_WORKER_WRAPPER_PACKAGE_NAME);
    let utils_lib_dir = python_worker_lib_dir.join(UTILS_WRAPPER_PACKAGE_NAME);

    // Create the directory if it doesn't exist
    if !python_worker_lib_dir.exists() {
        fs::create_dir(&python_worker_lib_dir)?;
    }
    if !utils_lib_dir.exists() {
        fs::create_dir(&utils_lib_dir)?;
    }

    // Overwrite the wrapper files
    fs::write(
        python_worker_lib_dir.join("__init__.py"),
        include_str!("./wrappers/scripts/python_worker_wrapper/__init__.py"),
    )?;
    fs::write(
        python_worker_lib_dir.join("activity.py"),
        include_str!("./wrappers/scripts/python_worker_wrapper/activity.py"),
    )?;
    fs::write(
        python_worker_lib_dir.join("worker.py"),
        include_str!("./wrappers/scripts/python_worker_wrapper/worker.py"),
    )?;
    fs::write(
        python_worker_lib_dir.join("workflow.py"),
        include_str!("./wrappers/scripts/python_worker_wrapper/workflow.py"),
    )?;
    fs::write(
        python_worker_lib_dir.join("logging.py"),
        include_str!("./wrappers/scripts/python_worker_wrapper/logging.py"),
    )?;
    fs::write(
        python_worker_lib_dir.join("types.py"),
        include_str!("./wrappers/scripts/python_worker_wrapper/types.py"),
    )?;
    fs::write(
        python_worker_lib_dir.join("serialization.py"),
        include_str!("./wrappers/scripts/python_worker_wrapper/serialization.py"),
    )?;
    fs::write(
        utils_lib_dir.join("__init__.py"),
        include_str!("./utils/__init__.py"),
    )?;
    fs::write(
        utils_lib_dir.join("temporal.py"),
        include_str!("./utils/temporal.py"),
    )?;

    let mut worker_process = run_python_program(
        project,
        &project.project_location,
        PythonProgram::OrchestrationWorker {
            args: vec![
                project.temporal_config.temporal_url(),
                project.temporal_config.get_temporal_namespace(),
                project.temporal_config.client_cert.clone(),
                project.temporal_config.client_key.clone(),
                project.temporal_config.api_key.clone(),
            ],
        },
    )?;

    let stdout = worker_process
        .stdout
        .take()
        .expect("Worker process did not have a handle to stdout");

    let stderr = worker_process
        .stderr
        .take()
        .expect("Worker process did not have a handle to stderr");

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();

    tokio::spawn(async move {
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            let parts: Vec<&str> = line.split('|').collect();
            if parts.len() >= 3 {
                let level = parts[0].trim();
                let message = parts[2].trim();
                match level {
                    "INFO" => info!("{}", message),
                    "WARNING" => warn!("{}", message),
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

    Ok(worker_process)
}
