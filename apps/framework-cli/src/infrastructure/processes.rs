use std::sync::Arc;

use consumption_registry::ConsumptionError;
use kafka_clickhouse_sync::SyncingProcessesRegistry;
use orchestration_workers_registry::OrchestrationWorkersRegistryError;
use process_registry::ProcessRegistries;

use super::{
    olap::clickhouse::{errors::ClickhouseError, mapper::std_columns_to_clickhouse_columns},
    stream::kafka::models::{KafkaConfig, KafkaStreamConfig},
};
use crate::{
    framework::{
        blocks::model::BlocksError,
        core::infrastructure_map::{Change, InfraMapError, InfrastructureMap, ProcessChange},
    },
    metrics::Metrics,
};

pub mod blocks_registry;
pub mod consumption_registry;
pub mod functions_registry;
pub mod kafka_clickhouse_sync;
pub mod orchestration_workers_registry;
pub mod process_registry;

#[derive(Debug, thiserror::Error)]
pub enum SyncProcessChangesError {
    #[error("Failed to map columns to Clickhouse columns")]
    ClickhouseMapping(#[from] ClickhouseError),

    #[error("Failed in the function registry")]
    FunctionRegistry(#[from] functions_registry::FunctionRegistryError),

    #[error("Failed in the blocks registry")]
    OlapProcess(#[from] BlocksError),

    #[error("Failed in the analytics api registry")]
    ConsumptionProcess(#[from] ConsumptionError),

    #[error("Failed in the orchestration workers registry")]
    OrchestrationWorkersRegistry(#[from] OrchestrationWorkersRegistryError),

    #[error("Failed to interact with the infrastructure map")]
    InfrastructureMap(#[from] InfraMapError),
}

/// This method dispatches the execution of the changes to the right streaming engine.
/// When we have multiple streams (Redpanda, RabbitMQ ...) this is where it goes.
/// This method executes changes that are allowed on any instance.
pub async fn execute_changes(
    kafka_config: &KafkaConfig,
    infra_map: &InfrastructureMap,
    syncing_registry: &mut SyncingProcessesRegistry,
    process_registry: &mut ProcessRegistries,
    changes: &[ProcessChange],
    metrics: Arc<Metrics>,
) -> Result<(), SyncProcessChangesError> {
    for change in changes.iter() {
        match change {
            ProcessChange::TopicToTableSyncProcess(Change::Added(sync)) => {
                log::info!("Starting sync process: {:?}", sync.id());
                let target_table_columns = std_columns_to_clickhouse_columns(&sync.columns)?;

                // Topic doesn't contain the namespace, so we need to build the full topic name
                let source_topic = infra_map.get_topic(&sync.source_topic_id)?;
                let source_kafka_topic = KafkaStreamConfig::from_topic(kafka_config, source_topic);

                let target_table = infra_map.get_table(&sync.target_table_id)?;

                syncing_registry.start_topic_to_table(
                    sync.id(),
                    source_kafka_topic.name.clone(),
                    source_topic.columns.clone(),
                    target_table.name.clone(),
                    target_table_columns,
                    metrics.clone(),
                );
            }
            ProcessChange::TopicToTableSyncProcess(Change::Removed(sync)) => {
                log::info!("Stopping sync process: {:?}", sync.id());
                syncing_registry.stop_topic_to_table(&sync.id())
            }
            ProcessChange::TopicToTableSyncProcess(Change::Updated { before, after }) => {
                log::info!("Replacing Sync process: {:?} by {:?}", before, after);

                // Topic doesn't contain the namespace, so we need to build the full topic name
                let after_source_topic = infra_map.get_topic(&after.source_topic_id)?;
                let after_kafka_source_topic =
                    KafkaStreamConfig::from_topic(kafka_config, after_source_topic);

                let after_target_table = infra_map.get_table(&after.target_table_id)?;

                // Order of operations is important here. We don't want to stop the process if the mapping fails.
                let target_table_columns = std_columns_to_clickhouse_columns(&after.columns)?;
                syncing_registry.stop_topic_to_table(&before.id());
                syncing_registry.start_topic_to_table(
                    after.id(),
                    after_kafka_source_topic.name.clone(),
                    after_source_topic.columns.clone(),
                    after_target_table.name.clone(),
                    target_table_columns,
                    metrics.clone(),
                );
            }
            ProcessChange::TopicToTopicSyncProcess(Change::Added(sync)) => {
                log::info!("Starting sync process: {:?}", sync.id());

                // Topic doesn't contain the namespace, so we need to build the full topic name
                let source_topic = infra_map.get_topic(&sync.source_topic_id)?;
                let source_kafka_topic = KafkaStreamConfig::from_topic(kafka_config, source_topic);

                let target_topic = infra_map.get_topic(&sync.target_topic_id)?;
                let target_kafka_topic = KafkaStreamConfig::from_topic(kafka_config, target_topic);

                syncing_registry.start_topic_to_topic(
                    source_kafka_topic.name.clone(),
                    target_kafka_topic.name.clone(),
                    metrics.clone(),
                );
            }
            ProcessChange::TopicToTopicSyncProcess(Change::Removed(sync)) => {
                log::info!("Stopping sync process: {:?}", sync.id());

                // Topic doesn't contain the namespace, so we need to build the full topic name
                let target_topic = infra_map.get_topic(&sync.target_topic_id)?;
                let target_kafka_topic = KafkaStreamConfig::from_topic(kafka_config, target_topic);

                syncing_registry.stop_topic_to_topic(&target_kafka_topic.name)
            }
            // TopicToTopicSyncProcess Updated seems impossible
            ProcessChange::TopicToTopicSyncProcess(Change::Updated { before, after }) => {
                log::info!("Replacing Sync process: {:?} by {:?}", before, after);

                // Topic doesn't contain the namespace, so we need to build the full topic name
                let before_target_topic = infra_map.get_topic(&before.target_topic_id)?;
                let before_kafka_target_topic =
                    KafkaStreamConfig::from_topic(kafka_config, before_target_topic);

                let after_source_topic = infra_map.get_topic(&after.source_topic_id)?;
                let after_kafka_source_topic =
                    KafkaStreamConfig::from_topic(kafka_config, after_source_topic);

                let after_target_topic = infra_map.get_topic(&after.target_topic_id)?;
                let after_kafka_target_topic =
                    KafkaStreamConfig::from_topic(kafka_config, after_target_topic);

                syncing_registry.stop_topic_to_topic(&before_kafka_target_topic.name);
                syncing_registry.start_topic_to_topic(
                    after_kafka_source_topic.name.clone(),
                    after_kafka_target_topic.name.clone(),
                    metrics.clone(),
                );
            }
            ProcessChange::FunctionProcess(Change::Added(function_process)) => {
                log::info!("Starting Function process: {:?}", function_process.id());
                process_registry
                    .functions
                    .start(infra_map, function_process)?;
            }
            ProcessChange::FunctionProcess(Change::Removed(function_process)) => {
                log::info!("Stopping Function process: {:?}", function_process.id());
                process_registry.functions.stop(function_process).await;
            }
            ProcessChange::FunctionProcess(Change::Updated { before, after }) => {
                log::info!("Updating Function process: {:?}", before.id());
                process_registry.functions.stop(before).await;
                process_registry.functions.start(infra_map, after)?;
            }
            // Olap process changes are conditional on the leader instance
            ProcessChange::OlapProcess(Change::Added(_)) => {}
            ProcessChange::OlapProcess(Change::Removed(_)) => {}
            ProcessChange::OlapProcess(Change::Updated {
                before: _,
                after: _,
            }) => {}
            ProcessChange::ConsumptionApiWebServer(Change::Added(_)) => {
                log::info!("Starting analytics api webserver process");
                process_registry.consumption.start()?;
            }
            ProcessChange::ConsumptionApiWebServer(Change::Removed(_)) => {
                log::info!("Stopping analytics api webserver process");
                process_registry.consumption.stop().await?;
            }
            ProcessChange::ConsumptionApiWebServer(Change::Updated {
                before: _,
                after: _,
            }) => {
                log::info!("Re-Starting analytics api webserver process");
                process_registry.consumption.stop().await?;
                process_registry.consumption.start()?;
            }
            ProcessChange::OrchestrationWorker(Change::Added(new_orchestration_worker)) => {
                log::info!("Starting Orchestration worker process");
                process_registry
                    .orchestration_workers
                    .start(new_orchestration_worker)
                    .await?;
            }
            ProcessChange::OrchestrationWorker(Change::Removed(old_orchestration_worker)) => {
                log::info!("Stopping Orchestration worker process");
                process_registry
                    .orchestration_workers
                    .stop(old_orchestration_worker)
                    .await?;
            }
            ProcessChange::OrchestrationWorker(Change::Updated { before, after }) => {
                log::info!("Restarting Orchestration worker process: {:?}", before.id());
                process_registry.orchestration_workers.stop(before).await?;
                process_registry.orchestration_workers.start(after).await?;
            }
        }
    }

    Ok(())
}

/// This method executes changes that are only allowed on the leader instance.
pub async fn execute_leader_changes(
    process_registry: &mut ProcessRegistries,
    changes: &[ProcessChange],
) -> Result<(), SyncProcessChangesError> {
    for change in changes.iter() {
        match (change, &mut process_registry.blocks) {
            (ProcessChange::OlapProcess(Change::Added(olap_process)), Some(blocks)) => {
                log::info!("Starting Blocks process: {:?}", olap_process.id());
                blocks.start(olap_process)?;
            }
            (ProcessChange::OlapProcess(Change::Removed(olap_process)), Some(blocks)) => {
                log::info!("Stopping Blocks process: {:?}", olap_process.id());
                blocks.stop(olap_process).await?;
            }
            (ProcessChange::OlapProcess(Change::Updated { before, after }), Some(blocks)) => {
                log::info!("Updating Blocks process: {:?}", before.id());
                blocks.stop(before).await?;
                blocks.start(after)?;
            }
            _ => {}
        }
    }

    Ok(())
}
