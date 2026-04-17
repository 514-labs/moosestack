//! System utilities
use std::fmt::Debug;
use std::time::Duration;
use std::{
    path::{Path, PathBuf},
    process::Command,
};
use tokio::process::Child;
use tokio::select;
use tokio::task::JoinHandle;
use tokio::time::{sleep, Instant};
use tracing::{debug, error, info, warn};

#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum KillProcessError {
    #[error("Failed to kill process")]
    Kill(#[from] std::io::Error),

    #[error("Child has no process ID")]
    ProcessNotFound,
}

pub fn copy_directory(source: &PathBuf, destination: &PathBuf) -> Result<(), std::io::Error> {
    //! Recursively copy a directory from source to destination.
    let mut command = Command::new("cp");
    command.arg("-r");
    command.arg(source);
    command.arg(destination);

    command.output()?;

    Ok(())
}

pub fn file_name_contains(path: &Path, arbitry_string: &str) -> bool {
    path.file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .contains(arbitry_string)
}

pub async fn kill_child(child: &mut Child) -> Result<(), KillProcessError> {
    let id = match child.id() {
        Some(id) => id,
        None => return Err(KillProcessError::ProcessNotFound),
    };

    // Send SIGTERM
    let mut kill = tokio::process::Command::new("kill")
        .args(["-s", "SIGTERM", &id.to_string()])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    let status = kill.wait().await?;

    if !status.success() {
        tracing::warn!("Failed to send SIGTERM to process {}", id);
    }

    // Wait for the child process to exit with a timeout (10 seconds)
    // This gives streaming functions time to gracefully close Kafka/Redis connections
    let wait_result = tokio::time::timeout(Duration::from_secs(10), child.wait()).await;

    match wait_result {
        Ok(Ok(_exit_status)) => {
            info!("Process {} exited gracefully after SIGTERM", id);
            Ok(())
        }
        Ok(Err(e)) => {
            error!("Error waiting for process {} to exit: {}", id, e);
            Err(KillProcessError::Kill(e))
        }
        Err(_) => {
            // Timeout occurred - force kill with SIGKILL
            warn!(
                "Process {} did not exit after 10 seconds, sending SIGKILL",
                id
            );

            let mut force_kill = tokio::process::Command::new("kill")
                .args(["-s", "SIGKILL", &id.to_string()])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()?;

            force_kill.wait().await?;

            // Wait one more second for SIGKILL to complete
            match tokio::time::timeout(Duration::from_secs(1), child.wait()).await {
                Ok(Ok(_)) => {
                    warn!("Process {} killed with SIGKILL", id);
                    Ok(())
                }
                _ => {
                    error!("Process {} could not be killed even with SIGKILL", id);
                    Err(KillProcessError::ProcessNotFound)
                }
            }
        }
    }
}

/// Policy for when to restart a child process
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RestartPolicy {
    /// Always restart the process, even if it exits with code 0
    Always,
    /// Only restart on non-zero exit codes (failures)
    #[default]
    OnFailure,
}

pub struct RestartingProcess {
    monitor_task: JoinHandle<()>,
    kill: tokio::sync::oneshot::Sender<()>,
}

pub type StartChildFn<E> = Box<dyn Fn() -> Result<Child, E> + Send + Sync>;

impl RestartingProcess {
    pub fn create<E: Debug + 'static>(
        process_id: String,
        start: StartChildFn<E>,
        restart_policy: RestartPolicy,
    ) -> Result<RestartingProcess, E> {
        let child = start()?;
        let (sender, mut receiver) = tokio::sync::oneshot::channel::<()>();

        Ok(RestartingProcess {
            monitor_task: tokio::task::spawn(async move {
                let mut child = child;
                const INITIAL_DELAY_MS: u64 = 1000;
                const MAX_DELAY_MS: u64 = 60_000;
                const MIN_RUNTIME_FOR_RESET: Duration = Duration::from_secs(10);
                // Circuit breaker: stop retrying once the child has failed this
                // many times in a row without running long enough. Prevents a
                // permanently-broken process (e.g. EADDRINUSE on a port held by
                // another moose dev) from flooding the log file with an
                // unbounded stream of identical stack traces.
                const MAX_CONSECUTIVE_RAPID_FAILURES: u32 = 5;
                let mut delay_ms: u64 = INITIAL_DELAY_MS;
                let mut process_start_time = Instant::now();
                let mut consecutive_rapid_failures: u32 = 0;

                'monitor: loop {
                    select! {
                        _ = &mut receiver => {
                            info!("Received kill signal, stopping process monitor for {}", process_id);
                            break 'monitor;
                        }
                        exit_status_result = child.wait() => {
                            let process_runtime = process_start_time.elapsed();
                            let should_restart = match exit_status_result {
                                Ok(exit_status) => {
                                    if exit_status.success() {
                                        info!("Process {} exited successfully after running for {:?}", process_id, process_runtime);
                                        match restart_policy {
                                            RestartPolicy::Always => {
                                                info!("Process {} exited cleanly but restart policy is Always, will restart", process_id);
                                                true
                                            }
                                            RestartPolicy::OnFailure => {
                                                info!("Process {} exited cleanly and restart policy is OnFailure, not restarting", process_id);
                                                false
                                            }
                                        }
                                    } else {
                                        warn!("Process {} exited with non-zero status: {:?} after running for {:?}", process_id, exit_status, process_runtime);
                                        true // Always restart on failure
                                    }
                                }
                                Err(e) => {
                                    error!("Error waiting for process {}: {:?} after running for {:?}", process_id, e, process_runtime);
                                    true // Treat errors as failures, restart
                                }
                            };

                            if !should_restart {
                                break 'monitor;
                            }

                            // Set initial delay based on whether the previous process ran long enough
                            if process_runtime >= MIN_RUNTIME_FOR_RESET {
                                debug!("Previous process ran for {:?}, resetting backoff delay", process_runtime);
                                delay_ms = INITIAL_DELAY_MS;
                                consecutive_rapid_failures = 0;
                            } else {
                                delay_ms = (delay_ms * 2).min(MAX_DELAY_MS);
                                consecutive_rapid_failures += 1;
                            }

                            if consecutive_rapid_failures >= MAX_CONSECUTIVE_RAPID_FAILURES {
                                error!(
                                    "Process {} failed {} times in a row without running for at least {:?}; giving up. Check the errors above for the underlying cause (e.g. a busy port).",
                                    process_id, consecutive_rapid_failures, MIN_RUNTIME_FOR_RESET,
                                );
                                break 'monitor;
                            }

                            'restart: loop {
                                debug!("Delaying {}ms before restarting {}", delay_ms, process_id);

                                // Wait for the delay or kill signal, whichever comes first
                                select! {
                                    _ = &mut receiver => {
                                        info!("Received kill signal during restart delay for {}", process_id);
                                        break 'monitor; // Exit both loops to avoid re-polling consumed receiver
                                    }
                                    _ = sleep(Duration::from_millis(delay_ms)) => {
                                        // Delay completed, proceed with restart attempt
                                    }
                                }

                                info!("Attempting to restart process {}...", process_id);
                                match start() {
                                    Ok(new_child) => {
                                        info!("Process {} restarted successfully", process_id);
                                        process_start_time = Instant::now();
                                        child = new_child;
                                        break 'restart;
                                    }
                                    Err(e) => {
                                        error!("Failed to restart process {}: {:?}", process_id, e);
                                        delay_ms = (delay_ms * 2).min(MAX_DELAY_MS);
                                        consecutive_rapid_failures += 1;
                                        if consecutive_rapid_failures >= MAX_CONSECUTIVE_RAPID_FAILURES {
                                            error!(
                                                "Process {} failed to spawn {} times in a row; giving up.",
                                                process_id, consecutive_rapid_failures,
                                            );
                                            break 'monitor;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                let _ = kill_child(&mut child).await;
            }),
            kill: sender,
        })
    }

    pub async fn stop(self) {
        // Signal the monitor task to stop
        let _ = self.kill.send(());

        // Wait for the monitor task to complete
        // The monitor task will call kill_child which now properly waits for the process to exit
        if let Err(e) = self.monitor_task.await {
            error!("Error waiting for monitor task to complete: {:?}", e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn restarting_process_gives_up_after_consecutive_spawn_failures() {
        // A StartChildFn that always fails. The monitor's inner restart loop
        // should trip the circuit breaker after a bounded number of attempts
        // instead of retrying forever.
        let calls = Arc::new(AtomicU32::new(0));
        let calls_for_start = calls.clone();

        // First call must succeed so RestartingProcess::create itself
        // returns Ok — we need the monitor task spawned. We fail every
        // subsequent call so the inner 'restart loop exercises the breaker.
        let start: StartChildFn<std::io::Error> = Box::new(move || {
            let n = calls_for_start.fetch_add(1, Ordering::SeqCst);
            if n == 0 {
                // Spawn a tiny child that exits immediately with failure.
                tokio::process::Command::new("sh")
                    .arg("-c")
                    .arg("exit 1")
                    .spawn()
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::AddrInUse,
                    "simulated EADDRINUSE",
                ))
            }
        });

        let proc = RestartingProcess::create(
            "test-circuit-breaker".to_string(),
            start,
            RestartPolicy::Always,
        )
        .expect("initial spawn should succeed");

        // Wait for the monitor to hit the breaker. The first child exits
        // ~immediately, then each restart attempt fails with increasing
        // backoff (1s, 2s, 4s, 8s, 16s) — well under 40s for 5 failures.
        let joined = tokio::time::timeout(Duration::from_secs(45), proc.monitor_task).await;
        assert!(
            joined.is_ok(),
            "monitor task should terminate after circuit-breaker trips, not retry forever",
        );

        // Bounded number of spawn attempts: 1 initial + up to 5 restarts.
        let total = calls.load(Ordering::SeqCst);
        assert!(
            total <= 6,
            "expected <= 6 spawn attempts, got {total} — circuit breaker did not engage",
        );
    }
}
