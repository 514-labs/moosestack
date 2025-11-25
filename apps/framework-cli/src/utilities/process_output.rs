use std::io::{BufRead, BufReader as StdBufReader};
use std::process::{Command, Stdio};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{ChildStderr, ChildStdout};
use tracing::{error, info, warn};

/// Utility for safely managing subprocess output while preventing terminal corruption.
///
/// This proxy captures subprocess stdout/stderr streams and forwards them to the logging
/// system with appropriate log levels. It handles I/O errors gracefully and ensures
/// that subprocess output doesn't interfere with terminal state.
pub struct ProcessOutputProxy {
    stdout_task: tokio::task::JoinHandle<()>,
    stderr_task: tokio::task::JoinHandle<()>,
}

impl ProcessOutputProxy {
    /// Create a new output proxy that forwards subprocess output to logs with error handling.
    ///
    /// This method spawns async tasks to read from the subprocess streams:
    /// - stdout lines are logged at INFO level
    /// - stderr lines are logged at WARN level  
    /// - I/O errors are logged at ERROR level
    ///
    /// # Arguments
    /// * `stdout` - The subprocess stdout stream
    /// * `stderr` - The subprocess stderr stream
    /// * `label` - A label to prefix all log messages for easy identification
    ///
    /// # Returns
    /// A ProcessOutputProxy that manages the async reading tasks
    pub fn new(stdout: ChildStdout, stderr: ChildStderr, label: &str) -> Self {
        let label_stdout = format!("[{label}]");
        let label_stderr = label_stdout.clone();

        let stdout_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            loop {
                match reader.next_line().await {
                    Ok(Some(line)) => {
                        info!("{} {}", label_stdout, line);
                    }
                    Ok(None) => {
                        // EOF reached, exit loop
                        break;
                    }
                    Err(e) => {
                        error!("{} Error reading stdout: {}", label_stdout, e);
                        break;
                    }
                }
            }
        });

        let stderr_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            loop {
                match reader.next_line().await {
                    Ok(Some(line)) => {
                        warn!("{} {}", label_stderr, line);
                    }
                    Ok(None) => {
                        // EOF reached, exit loop
                        break;
                    }
                    Err(e) => {
                        error!("{} Error reading stderr: {}", label_stderr, e);
                        break;
                    }
                }
            }
        });

        Self {
            stdout_task,
            stderr_task,
        }
    }

    /// Wait for all output processing tasks to complete.
    ///
    /// This method should be called after the subprocess has finished to ensure
    /// all output has been read and logged before proceeding.
    pub async fn wait_for_completion(self) {
        let (stdout_result, stderr_result) = tokio::join!(self.stdout_task, self.stderr_task);

        if let Err(e) = stdout_result {
            error!("Output proxy stdout task failed: {}", e);
        }
        if let Err(e) = stderr_result {
            error!("Output proxy stderr task failed: {}", e);
        }
    }
}

/// Run a command with safe stdio piping and output proxying.
///
/// This function configures the command with piped stdio, spawns it, and uses
/// ProcessOutputProxy to safely forward all output to the logging system.
/// It ensures that subprocess output doesn't corrupt terminal state while
/// providing full visibility into what the subprocess is doing.
///
/// # Arguments
/// * `command` - The tokio::process::Command to execute
/// * `label` - A label to identify this process in log messages
///
/// # Returns
/// The exit status of the subprocess, or an error if spawning/waiting fails
pub async fn run_command_with_output_proxy(
    mut command: tokio::process::Command,
    label: &str,
) -> Result<std::process::ExitStatus, Box<dyn std::error::Error + Send + Sync>> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = child.stdout.take().expect("Failed to capture stdout");
    let stderr = child.stderr.take().expect("Failed to capture stderr");

    let proxy = ProcessOutputProxy::new(stdout, stderr, label);
    let status = child.wait().await?;
    proxy.wait_for_completion().await;

    Ok(status)
}

/// Synchronous version of command execution with output proxying.
///
/// This provides the same functionality as `run_command_with_output_proxy` but
/// uses std::thread instead of async tasks, making it suitable for use in
/// synchronous contexts such as tests or non-async code paths.
///
/// # Arguments
/// * `command` - The std::process::Command to execute
/// * `label` - A label to identify this process in log messages
///
/// # Returns
/// The exit status of the subprocess, or an error if spawning/waiting fails
pub fn run_command_with_output_proxy_sync(
    mut command: Command,
    label: &str,
) -> Result<std::process::ExitStatus, Box<dyn std::error::Error + Send + Sync>> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = child.stdout.take().expect("Failed to capture stdout");
    let stderr = child.stderr.take().expect("Failed to capture stderr");

    let label_stdout = format!("[{label}]");
    let label_stderr = label_stdout.clone();

    // Spawn threads to handle output with error handling
    let stdout_handle = std::thread::spawn(move || {
        let reader = StdBufReader::new(stdout);
        for line_result in reader.lines() {
            match line_result {
                Ok(line) => info!("{label_stdout} {line}"),
                Err(e) => {
                    error!("{label_stdout} Error reading stdout: {e}");
                    break;
                }
            }
        }
    });

    let stderr_handle = std::thread::spawn(move || {
        let reader = StdBufReader::new(stderr);
        for line_result in reader.lines() {
            match line_result {
                Ok(line) => warn!("{label_stderr} {line}"),
                Err(e) => {
                    error!("{label_stderr} Error reading stderr: {e}");
                    break;
                }
            }
        }
    });

    let status = child.wait()?;

    // Wait for output threads to complete
    if let Err(e) = stdout_handle.join() {
        error!("Output proxy stdout thread panicked: {:?}", e);
    }
    if let Err(e) = stderr_handle.join() {
        error!("Output proxy stderr thread panicked: {:?}", e);
    }

    Ok(status)
}
