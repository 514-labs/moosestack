/// Stream infrastructure module for managing streaming data pipelines.
///
/// This module provides abstractions for working with streaming infrastructure
/// such as Redpanda/Kafka. It offers a uniform interface for managing different
/// streaming engines while isolating the core domain logic from the specific
/// implementation details of each engine.
///
/// The module handles:
/// - Validation of streaming configuration changes
/// - Execution of streaming infrastructure changes
/// - Conversion between core domain objects and engine-specific objects
/// - Type-safe serialization of configuration objects
use kafka::models::{KafkaChange, KafkaConfig, KafkaStreamConfig};
use serde::{Deserialize, Serialize};

use crate::{
    framework::core::infrastructure_map::{Change, StreamingChange},
    project::Project,
};

pub mod kafka;

/// Errors that can occur during streaming infrastructure operations.
///
/// This enum wraps specific errors from different streaming engines
/// to provide a unified error handling approach for the streaming module.
#[derive(Debug, thiserror::Error)]
pub enum StreamingChangesError {
    /// Errors from Redpanda/Kafka operations
    #[error("Failed to execute the changes on Redpanda")]
    RedpandaChanges(#[from] kafka::errors::KafkaChangesError),
}

/// Validates changes to be made to the streaming infrastructure
/// by delegating validation to the appropriate streaming engine (currently only Redpanda).
///
/// This function converts core domain model objects to engine-specific objects
/// before dispatching the validation to the appropriate engine implementation.
///
/// # Arguments
/// * `project` - The project configuration containing connection details
/// * `changes` - A slice of StreamingChange enums representing the changes to validate
///
/// # Returns
/// * `Ok(())` if validation succeeds
/// * `Err(StreamingChangesError)` if validation fails
///
/// # Errors
/// * Returns wrapped errors from the underlying streaming engine
pub fn validate_changes(
    project: &Project,
    changes: &[StreamingChange],
) -> Result<(), StreamingChangesError> {
    // Convert core StreamingChange to Redpanda-specific RedpandaChange
    let kafka_changes = convert_to_kafka_changes(&project.redpanda_config, changes);

    // Delegate to kafka client validate_changes
    kafka::client::validate_changes(&kafka_changes)?;

    Ok(())
}

/// Executes changes on the streaming infrastructure.
///
/// This method dispatches the execution of the changes to the right streaming engine
/// (currently only Redpanda). When multiple streaming engines are supported
/// (e.g., Redpanda, RabbitMQ), this function will route changes to the appropriate
/// implementation.
///
/// # Arguments
/// * `project` - The project configuration containing connection details
/// * `changes` - A slice of StreamingChange enums representing the changes to apply
///
/// # Returns
/// * `Ok(())` if changes were applied successfully
/// * `Err(StreamingChangesError)` if any operation failed
///
/// # Errors
/// * Returns wrapped errors from the underlying streaming engine
pub async fn execute_changes(
    project: &Project,
    changes: &[StreamingChange],
) -> Result<(), StreamingChangesError> {
    // Convert core StreamingChange to Redpanda-specific RedpandaChange
    let kafka_changes = convert_to_kafka_changes(&project.redpanda_config, changes);

    // Delegate to redpanda client execute_changes
    kafka::client::execute_changes(project, &kafka_changes).await?;

    Ok(())
}

/// Converts core StreamingChange objects to Redpanda-specific RedpandaChange objects.
///
/// This function handles the translation between the core domain model and the
/// Redpanda-specific implementation details. It maps each type of core change
/// to its corresponding Redpanda-specific representation.
///
/// # Arguments
/// * `config` - The Redpanda configuration to use for conversion
/// * `changes` - A slice of core StreamingChange objects to convert
///
/// # Returns
/// * A Vec of RedpandaChange objects representing the converted changes
fn convert_to_kafka_changes(config: &KafkaConfig, changes: &[StreamingChange]) -> Vec<KafkaChange> {
    changes
        .iter()
        .map(|change| match change {
            StreamingChange::Topic(Change::Added(topic)) => {
                let config = KafkaStreamConfig::from_topic(config, topic);
                KafkaChange::Added(config)
            }
            StreamingChange::Topic(Change::Removed(topic)) => {
                let config = KafkaStreamConfig::from_topic(config, topic);
                KafkaChange::Removed(config)
            }
            StreamingChange::Topic(Change::Updated { before, after }) => {
                let before_config = KafkaStreamConfig::from_topic(config, before);
                let after_config = KafkaStreamConfig::from_topic(config, after);
                KafkaChange::Updated {
                    before: before_config,
                    after: after_config,
                }
            }
        })
        .collect()
}

/// Unified configuration for different streaming engines.
///
/// This enum provides a type-safe way to handle configurations for different
/// streaming engines through a single interface. It supports serialization
/// and deserialization for storage and transmission.
///
/// We use streaming_engine_type because python 3.12 doesn't like type
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "streaming_engine_type")]
pub enum StreamConfig {
    /// Configuration for Redpanda/Kafka topics
    Redpanda(KafkaStreamConfig),
}

impl StreamConfig {
    /// Serializes the configuration to a JSON string.
    ///
    /// # Returns
    /// * A String containing the JSON representation of this configuration
    ///
    /// # Panics
    /// * Panics if serialization fails
    pub fn as_json_string(&self) -> String {
        serde_json::to_string(self).unwrap()
    }

    /// Deserializes a StreamConfig from a JSON string.
    ///
    /// # Arguments
    /// * `s` - The JSON string to parse
    ///
    /// # Returns
    /// * A new StreamConfig instance
    ///
    /// # Panics
    /// * Panics if deserialization fails
    pub fn from_json_string(s: &str) -> Self {
        serde_json::from_str(s).unwrap()
    }
}
