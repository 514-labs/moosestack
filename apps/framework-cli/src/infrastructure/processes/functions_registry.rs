use crate::utilities::system::{RestartingProcess, StartChildFn};
use crate::{
    framework::core::{
        infrastructure::function_process::FunctionProcess, infrastructure_map::InfrastructureMap,
    },
    framework::{python, typescript},
    infrastructure::stream::{kafka::models::KafkaStreamConfig, StreamConfig},
    project::Project,
    utilities::system::KillProcessError,
};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{error, info};

#[derive(Debug, thiserror::Error)]
pub enum FunctionRegistryError {
    #[error("Failed to load function_process files")]
    IO(#[from] std::io::Error),

    #[error("Could not kill the process.")]
    KillProcess(#[from] KillProcessError),

    #[error("Cannot run function_process {file_name}. Unsupported function_process type")]
    UnsupportedFunctionLanguage { file_name: String },

    #[error("Topic {topic_id} not found in the infrastructure map")]
    TopicNotFound { topic_id: String },
}

pub struct FunctionProcessRegistry {
    registry: HashMap<String, RestartingProcess>,
    project: Arc<Project>,
}

impl FunctionProcessRegistry {
    pub fn new(project: Project) -> Self {
        Self {
            registry: HashMap::new(),
            project: Arc::new(project),
        }
    }

    pub fn start(
        &mut self,
        infra_map: &InfrastructureMap,
        function_process: &FunctionProcess,
    ) -> Result<(), FunctionRegistryError> {
        let project_location = self.project.project_location.clone();
        let redpanda_config = self.project.redpanda_config.clone();
        let executable = function_process.executable.clone();
        let parallel_process_count = function_process.parallel_process_count;
        let data_model_v2 = self.project.features.data_model_v2;

        match (
            infra_map.find_topic_by_id(&function_process.source_topic_id),
            function_process
                .target_topic_id
                .as_ref()
                .and_then(|id| infra_map.find_topic_by_id(id)),
        ) {
            (Some(source_topic), Some(target_topic)) => {
                // TODO This will need to be made generic
                let source_topic = StreamConfig::Redpanda(KafkaStreamConfig::from_topic(
                    &self.project.redpanda_config,
                    source_topic,
                ));
                let target_topic = StreamConfig::Redpanda(KafkaStreamConfig::from_topic(
                    &self.project.redpanda_config,
                    target_topic,
                ));

                let project = self.project.clone();

                let start_fn: StartChildFn<FunctionRegistryError> =
                    if function_process.is_py_function_process() {
                        Box::new(move || {
                            Ok(python::streaming::run(
                                &project,
                                &project_location,
                                &redpanda_config,
                                &source_topic,
                                Some(&target_topic),
                                &executable,
                                data_model_v2,
                            )?)
                        })
                    } else if function_process.is_ts_function_process() {
                        Box::new(move || {
                            Ok(typescript::streaming::run(
                                &redpanda_config,
                                &source_topic,
                                Some(&target_topic),
                                &executable,
                                &project,
                                &project_location,
                                parallel_process_count,
                                data_model_v2,
                            )?)
                        })
                    } else {
                        return Err(FunctionRegistryError::UnsupportedFunctionLanguage {
                            file_name: executable
                                .file_name()
                                .unwrap()
                                .to_string_lossy()
                                .to_string(),
                        });
                    };

                let restarting_process =
                    RestartingProcess::create(function_process.id(), start_fn)?;
                self.registry
                    .insert(function_process.id(), restarting_process);

                Ok(())
            }
            (Some(_), None) => {
                let source_topic = StreamConfig::Redpanda(KafkaStreamConfig::from_topic(
                    &self.project.redpanda_config,
                    infra_map
                        .find_topic_by_id(&function_process.source_topic_id)
                        .unwrap(),
                ));
                let project = self.project.clone();

                let start_fn: StartChildFn<FunctionRegistryError> =
                    if function_process.is_py_function_process() {
                        Box::new(move || {
                            Ok(python::streaming::run(
                                &project,
                                &project_location,
                                &redpanda_config,
                                &source_topic,
                                None,
                                &executable,
                                data_model_v2,
                            )?)
                        })
                    } else if function_process.is_ts_function_process() {
                        Box::new(move || {
                            Ok(typescript::streaming::run(
                                &redpanda_config,
                                &source_topic,
                                None,
                                &executable,
                                &project,
                                &project_location,
                                parallel_process_count,
                                data_model_v2,
                            )?)
                        })
                    } else {
                        return Err(FunctionRegistryError::UnsupportedFunctionLanguage {
                            file_name: executable
                                .file_name()
                                .unwrap()
                                .to_string_lossy()
                                .to_string(),
                        });
                    };

                let restarting_process =
                    RestartingProcess::create(function_process.id(), start_fn)?;
                self.registry
                    .insert(function_process.id(), restarting_process);

                Ok(())
            }
            _ => Err(FunctionRegistryError::TopicNotFound {
                topic_id: function_process.source_topic_id.clone(),
            }),
        }
    }

    pub async fn stop(&mut self, function_process: &FunctionProcess) {
        info!("Stopping function process {:?}...", function_process.id());

        let id = &function_process.id();
        if let Some(restarting_process) = self.registry.remove(id) {
            restarting_process.stop().await;
        }
    }

    pub async fn stop_all(&mut self) {
        for (id, restarting_process) in self.registry.drain() {
            info!("Stopping function_process {:?}...", id);
            restarting_process.stop().await;
        }
    }
}
