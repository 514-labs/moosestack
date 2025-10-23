//! # Executes Python code in a subprocess.
//! This module provides a Python executor that can run Python code in a subprocess

use std::path::Path;
use std::process::Stdio;

use crate::utilities::constants::{CLI_PROJECT_INTERNAL_DIR, LIB_DIR};

use crate::project::Project;
use tokio::process::{Child, Command};

pub enum PythonSerializers {
    FrameworkObjectSerializer,
    ProjectObjectSerializer,
}

impl PythonSerializers {
    pub fn get_path(&self) -> &str {
        match self {
            PythonSerializers::FrameworkObjectSerializer => {
                "src/framework/python/scripts/framework_object_serializer.py"
            }
            PythonSerializers::ProjectObjectSerializer => {
                "src/framework/python/scripts/project_object_serializer.py"
            }
        }
    }
}

// TODO: move to PythonCommands
#[derive(Debug, Clone)]
pub enum PythonProgram {
    BlocksRunner { args: Vec<String> },
    ConsumptionRunner { args: Vec<String> },
    LoadApiParam { args: Vec<String> },
    OrchestrationWorker { args: Vec<String> },
}

/// executable files in the python moose-lib
pub enum PythonCommand {
    DmV2Serializer,
    StreamingFunctionRunner { args: Vec<String> },
}

pub static BLOCKS_RUNNER: &str = include_str!("wrappers/blocks_runner.py");
pub static CONSUMPTION_RUNNER: &str = include_str!("wrappers/consumption_runner.py");
pub static LOAD_API_PARAMS: &str = include_str!("wrappers/load_api_params.py");
pub static ORCHESTRATION_WORKER: &str = include_str!("wrappers/scripts/worker-main.py");
pub static STREAMING_RUNNER_WRAPPER: &str = include_str!("wrappers/streaming_runner_wrapper.py");

const PYTHON_PATH: &str = "PYTHONPATH";

/// Gets the Python path including the lib directory if it exists in the current project.
///
/// This function builds the PYTHONPATH environment variable by:
/// 1. Starting with the existing PYTHONPATH if any
/// 2. Adding the CLI project internal directory
/// 3. Adding the lib directory if it exists in the current working directory
///
/// # Returns
///
/// A String containing the complete PYTHONPATH with all necessary directories
fn python_path_with_lib(project_location: &Path) -> String {
    // Start with existing PYTHONPATH if any
    let mut paths = std::env::var(PYTHON_PATH).unwrap_or_else(|_| String::from(""));

    // Check if lib directory exists in current directory
    let lib_path = project_location.join(LIB_DIR);
    if lib_path.exists() && lib_path.is_dir() {
        paths.push(':');
        if let Some(lib_path_str) = lib_path.to_str() {
            paths.push_str(lib_path_str);
        }
    }

    // There's existing logic that write shared python modules into the project's
    // internal directory (e.g. temporal utils).
    // TODO: Move all python scripts to py-moose-lib
    paths.push(':');
    paths.push_str(CLI_PROJECT_INTERNAL_DIR);

    paths
}

/// Executes a Python program in a subprocess, code from in moose_lib
pub fn run_python_command(
    project: &Project,
    project_location: &Path,
    command: PythonCommand,
) -> Result<Child, std::io::Error> {
    let mut cmd = Command::new("python3");
    cmd.kill_on_drop(true);

    cmd.env(PYTHON_PATH, python_path_with_lib(project_location));
    cmd.env(
        "MOOSE_MANAGEMENT_PORT",
        project.http_server_config.management_port.to_string(),
    );
    cmd.env("MOOSE_SOURCE_DIR", &project.source_dir);

    match command {
        PythonCommand::DmV2Serializer => {
            cmd.arg("-m").arg("moose_lib.dmv2_serializer");
        }
        PythonCommand::StreamingFunctionRunner { args } => {
            cmd.arg("-u")
                .arg("-c")
                .arg(STREAMING_RUNNER_WRAPPER)
                .args(args);
        }
    };

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
}

/// Executes a Python program in a subprocess, code supplied in command arg
pub fn run_python_program(
    project: &Project,
    project_location: &Path,
    program: PythonProgram,
) -> Result<Child, std::io::Error> {
    let (get_args, program_string) = match program {
        PythonProgram::BlocksRunner { args } => (args, BLOCKS_RUNNER),
        PythonProgram::ConsumptionRunner { args } => (args, CONSUMPTION_RUNNER),
        PythonProgram::LoadApiParam { args } => (args, LOAD_API_PARAMS),
        PythonProgram::OrchestrationWorker { args } => (args, ORCHESTRATION_WORKER),
    };

    let mut command = Command::new("python3");
    command.kill_on_drop(true);

    command
        .env(PYTHON_PATH, python_path_with_lib(project_location))
        .env(
            "MOOSE_MANAGEMENT_PORT",
            project.http_server_config.management_port.to_string(),
        )
        .env("MOOSE_SOURCE_DIR", &project.source_dir)
        .arg("-u")
        .arg("-c")
        .arg(program_string)
        .args(get_args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
}

pub async fn run_python_file(
    project_location: &Path,
    path: &Path,
    env: &[(&str, &str)],
) -> Result<Child, std::io::Error> {
    let mut command = Command::new("python3");

    command.kill_on_drop(true);
    command.env(PYTHON_PATH, python_path_with_lib(project_location));
    for (key, val) in env {
        command.env(key, val);
    }

    command
        .arg("-u")
        .arg(path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
}

pub fn add_optional_arg(args: &mut Vec<String>, flag: &str, value: &Option<String>) {
    if let Some(val) = value {
        args.push(flag.to_string());
        args.push(val.to_string());
    }
}
