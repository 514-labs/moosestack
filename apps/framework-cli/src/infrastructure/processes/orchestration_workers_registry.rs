use log::info;
use std::collections::HashMap;
use tokio::process::Child;

use crate::{
    cli::settings::Settings,
    framework::{
        core::infrastructure::orchestration_worker::OrchestrationWorker,
        languages::SupportedLanguages, python, typescript,
    },
    project::Project,
    utilities::system::{kill_child, KillProcessError},
};

/// Error types that can occur when managing orchestration workers
#[derive(Debug, thiserror::Error)]
pub enum OrchestrationWorkersRegistryError {
    /// Error that occurs when killing a worker process fails
    #[error("Kill process Error")]
    KillProcessError(#[from] KillProcessError),

    /// Error that occurs when starting a python worker process fails
    #[error("Failed to start the python orchestration worker")]
    PythonWorkerProcessError(#[from] python::scripts_worker::WorkerProcessError),

    /// Error that occurs when starting a typescript worker process fails
    #[error("Failed to start the typescript orchestration worker")]
    TypescriptWorkerProcessError(#[from] typescript::scripts_worker::WorkerProcessError),
}

/// Registry that manages orchestration worker processes
pub struct OrchestrationWorkersRegistry {
    /// Map of worker IDs to their running process handles
    workers: HashMap<String, Child>,
    /// Directory containing worker scripts
    project: Project,
    /// Settings
    scripts_enabled: bool,
}

impl OrchestrationWorkersRegistry {
    /// Creates a new OrchestrationWorkersRegistry
    ///
    /// # Arguments
    /// * `project` - Project containing the worker scripts
    pub fn new(project: &Project, settings: &Settings) -> Self {
        Self {
            workers: HashMap::new(),
            project: project.clone(),
            scripts_enabled: settings.features.scripts || project.features.workflows,
        }
    }

    /// Starts a new orchestration worker process
    ///
    /// # Arguments
    /// * `orchestration_worker` - Worker configuration to start
    ///
    /// # Returns
    /// * `Result<(), OrchestrationWorkersRegistryError>` - Ok if worker started successfully, Error otherwise
    pub async fn start(
        &mut self,
        orchestration_worker: &OrchestrationWorker,
    ) -> Result<(), OrchestrationWorkersRegistryError> {
        if !self.scripts_enabled {
            return Ok(());
        }

        info!(
            "Starting orchestration worker: {:?}",
            orchestration_worker.id()
        );

        let language = orchestration_worker.supported_language;

        if language == SupportedLanguages::Python {
            let child = python::scripts_worker::start_worker(&self.project).await?;
            self.workers.insert(orchestration_worker.id(), child);
        } else {
            let child = typescript::scripts_worker::start_worker(&self.project).await?;
            self.workers.insert(orchestration_worker.id(), child);
        }
        Ok(())
    }

    /// Stops a running orchestration worker process
    ///
    /// # Arguments
    /// * `orchestration_worker` - Worker configuration to stop
    ///
    /// # Returns
    /// * `Result<(), OrchestrationWorkersRegistryError>` - Ok if worker stopped successfully, Error otherwise
    pub async fn stop(
        &mut self,
        orchestration_worker: &OrchestrationWorker,
    ) -> Result<(), OrchestrationWorkersRegistryError> {
        if !self.scripts_enabled {
            return Ok(());
        }

        info!(
            "Stopping orchestration worker: {:?}",
            orchestration_worker.id()
        );

        if let Some(child) = self.workers.get(&orchestration_worker.id()) {
            kill_child(child).await?;
        }
        Ok(())
    }

    /// Stops all running orchestration worker processes
    ///
    /// # Returns
    /// * `Result<(), OrchestrationWorkersRegistryError>` - Ok if all workers stopped successfully, Error otherwise
    pub async fn stop_all(&mut self) -> Result<(), OrchestrationWorkersRegistryError> {
        for (id, running_function_process) in self.workers.iter_mut() {
            info!("Stopping orchestration worker {:?}...", id);
            kill_child(running_function_process).await?;
        }
        Ok(())
    }
}
