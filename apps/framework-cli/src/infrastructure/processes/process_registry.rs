//! Process Registry Module
//!
//! This module provides a centralized registry for managing various process types in the framework.
//! It coordinates the lifecycle of function processes, block processes, consumption processes,
//! and orchestration worker processes.

use crate::cli::settings::Settings;
use crate::project::Project;

use super::blocks_registry::BlocksProcessRegistry;
use super::functions_registry::{FunctionProcessRegistry, FunctionRegistryError};
use super::kafka_clickhouse_sync::SyncingProcessesRegistry;
use super::orchestration_workers_registry::{
    OrchestrationWorkersRegistry, OrchestrationWorkersRegistryError,
};

/// Central registry that manages all process types in the framework
///
/// This struct serves as a container for all the different process registries,
/// providing a unified interface for managing the lifecycle of various process types.
pub struct ProcessRegistries {
    /// Registry for function processes that handle stream processing
    pub functions: FunctionProcessRegistry,

    /// Registry for block processes that handle data processing blocks
    pub blocks: Option<BlocksProcessRegistry>,

    /// Registry for orchestration worker processes that handle workflow execution
    pub orchestration_workers: OrchestrationWorkersRegistry,

    /// Registry for syncing processes that handle Kafka to ClickHouse and topic-to-topic synchronization
    pub syncing: SyncingProcessesRegistry,
}

/// Errors that can occur when managing processes in the registry
#[derive(thiserror::Error, Debug)]
pub enum ProcessRegistryError {
    /// Error that occurs when stopping a function process fails
    #[error("Failed to stop the function process")]
    FunctionProcessError(#[from] FunctionRegistryError),

    /// Error that occurs when stopping orchestration worker processes fails
    #[error("Failed to stop the orchestration workers")]
    OrchestrationWorkersProcessError(#[from] OrchestrationWorkersRegistryError),
}

impl ProcessRegistries {
    /// Creates a new ProcessRegistries instance
    ///
    /// Initializes all the individual process registries with the appropriate configuration
    /// from the project and settings.
    ///
    /// # Arguments
    /// * `project` - Project configuration containing paths and settings for processes
    /// * `settings` - Global application settings
    /// * `syncing` - Syncing processes registry for Kafka to ClickHouse and topic-to-topic synchronization
    ///
    /// # Returns
    /// * `Self` - A new ProcessRegistries instance
    pub fn new(project: &Project, settings: &Settings, syncing: SyncingProcessesRegistry) -> Self {
        let functions = FunctionProcessRegistry::new(project.clone());

        let blocks = if project.features.data_model_v2 || !project.features.olap {
            None
        } else {
            Some(BlocksProcessRegistry::new(
                project.language,
                project.blocks_dir(),
                project.project_location.clone(),
                project.clickhouse_config.clone(),
                project,
            ))
        };

        let orchestration_workers = OrchestrationWorkersRegistry::new(project, settings);

        Self {
            functions,
            blocks,
            orchestration_workers,
            syncing,
        }
    }

    /// Stops all running processes
    ///
    /// This method gracefully terminates all processes managed by the registry,
    /// ensuring proper cleanup of resources.
    ///
    /// # Returns
    /// * `Result<(), ProcessRegistryError>` - Ok if all processes stopped successfully, Error otherwise
    pub async fn stop(&mut self) -> Result<(), ProcessRegistryError> {
        self.functions.stop_all().await;
        self.orchestration_workers.stop_all().await?;
        self.syncing.stop_all().await;
        Ok(())
    }
}
