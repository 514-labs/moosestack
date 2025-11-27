use std::collections::HashMap;
use tracing::info;

use crate::{
    cli::settings::Settings,
    framework::{
        core::infrastructure::orchestration_worker::OrchestrationWorker,
        languages::SupportedLanguages, python, typescript,
    },
    project::Project,
    utilities::system::KillProcessError,
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
    workers: HashMap<String, crate::utilities::system::RestartingProcess>,
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

        // Wrap workers with RestartingProcess (same as APIs/functions) so they are supervised
        let project = self.project.clone();
        let start_fn: crate::utilities::system::StartChildFn<OrchestrationWorkersRegistryError> =
            if language == SupportedLanguages::Python {
                Box::new(move || {
                    python::scripts_worker::start_worker(&project)
                        .map_err(OrchestrationWorkersRegistryError::from)
                })
            } else {
                Box::new(move || {
                    typescript::scripts_worker::start_worker(&project)
                        .map_err(OrchestrationWorkersRegistryError::from)
                })
            };

        let restarting = crate::utilities::system::RestartingProcess::create(
            orchestration_worker.id(),
            start_fn,
        )?;
        self.workers.insert(orchestration_worker.id(), restarting);
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

        if let Some(restarting) = self.workers.remove(&orchestration_worker.id()) {
            restarting.stop().await;
        }
        Ok(())
    }

    /// Stops all running orchestration worker processes
    ///
    /// # Returns
    /// * `Result<(), OrchestrationWorkersRegistryError>` - Ok if all workers stopped successfully, Error otherwise
    pub async fn stop_all(&mut self) -> Result<(), OrchestrationWorkersRegistryError> {
        for (id, restarting) in self.workers.drain() {
            info!("Stopping orchestration worker {:?}...", id);
            restarting.stop().await;
        }
        Ok(())
    }
}
