//! Redpanda client module for managing Redpanda streaming infrastructure.
//!
//! This module provides functionality for interacting with a Redpanda/Kafka cluster including:
//! - Creating, updating, and deleting topics
//! - Managing topic configurations (partitions, retention periods)
//! - Creating producers and consumers for message streaming
//! - Validating infrastructure changes
//!
//! The client supports authentication via SASL and various configuration options
//! to customize behavior for different deployment scenarios.

use crate::infrastructure::stream::kafka::constants::{
    DEFAULT_MAX_MESSAGE_BYTES, KAFKA_MAX_MESSAGE_BYTES_CONFIG_KEY, KAFKA_RETENTION_CONFIG_KEY,
};
use crate::project::Project;
use tracing::{error, info, warn};
use rdkafka::admin::{AlterConfig, NewPartitions, ResourceSpecifier};
use rdkafka::config::RDKafkaLogLevel;
use rdkafka::consumer::stream_consumer::StreamConsumer;
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::error::KafkaError;
use rdkafka::producer::{DeliveryFuture, FutureRecord};
use rdkafka::types::RDKafkaErrorCode;
use rdkafka::ClientConfig;
use rdkafka::{
    admin::{AdminClient, AdminOptions, NewTopic, TopicReplication},
    producer::FutureProducer,
};
use std::collections::{HashMap, VecDeque};
use std::time::Duration;

use super::constants::{
    DEFAULT_RETENTION_MS, KAFKA_ACKS_CONFIG_KEY, KAFKA_AUTO_COMMIT_INTERVAL_MS_CONFIG_KEY,
    KAFKA_AUTO_OFFSET_RESET_CONFIG_KEY, KAFKA_BOOSTRAP_SERVERS_CONFIG_KEY,
    KAFKA_ENABLE_AUTO_COMMIT_CONFIG_KEY, KAFKA_ENABLE_AUTO_OFFSET_STORE_CONFIG_KEY,
    KAFKA_ENABLE_GAPLESS_GUARANTEE_CONFIG_KEY, KAFKA_ENABLE_IDEMPOTENCE_CONFIG_KEY,
    KAFKA_ENABLE_PARTITION_EOF_CONFIG_KEY, KAFKA_GROUP_ID_CONFIG_KEY,
    KAFKA_ISOLATION_LEVEL_CONFIG_KEY, KAFKA_MESSAGE_TIMEOUT_MS_CONFIG_KEY,
    KAFKA_RETRIES_CONFIG_KEY, KAFKA_SASL_MECHANISM_CONFIG_KEY, KAFKA_SASL_PASSWORD_CONFIG_KEY,
    KAFKA_SASL_USERNAME_CONFIG_KEY, KAFKA_SECURITY_PROTOCOL_CONFIG_KEY,
    KAFKA_SESSION_TIMEOUT_MS_CONFIG_KEY,
};
use super::errors::KafkaChangesError;
use super::models::{ConfiguredProducer, KafkaChange, KafkaConfig, KafkaStreamConfig};

/// Builds an rdkafka client configuration from a RedpandaConfig.
///
/// This function sets up the basic configuration for connecting to a Redpanda/Kafka
/// cluster, including broker addresses and authentication settings if provided.
///
/// # Arguments
/// * `config` - RedpandaConfig containing connection information
///
/// # Returns
/// * An rdkafka ClientConfig object ready to be used for creating clients
fn build_rdkafka_client_config(config: &KafkaConfig) -> ClientConfig {
    let mut client_config = ClientConfig::new();

    client_config.log_level = RDKafkaLogLevel::Emerg;

    client_config.set(KAFKA_BOOSTRAP_SERVERS_CONFIG_KEY, config.clone().broker);

    if let Some(username) = config.clone().sasl_username {
        client_config.set(KAFKA_SASL_USERNAME_CONFIG_KEY, &username);
    }
    if let Some(password) = config.clone().sasl_password {
        client_config.set(KAFKA_SASL_PASSWORD_CONFIG_KEY, &password);
    }
    if let Some(mechanism) = config.clone().sasl_mechanism {
        client_config.set(KAFKA_SASL_MECHANISM_CONFIG_KEY, &mechanism);
    }
    if let Some(security_protocol) = config.clone().security_protocol {
        client_config.set(KAFKA_SECURITY_PROTOCOL_CONFIG_KEY, &security_protocol);
    }
    client_config
}

/// Validates changes to streaming configurations, particularly focused on topic partition counts.
///
/// This function ensures that all planned changes to topics conform to Redpanda's
/// requirements and limitations.
///
/// # Arguments
/// * `changes` - A slice of RedpandaChange to validate
///
/// # Returns
/// * `Ok(())` if all changes are valid
/// * `Err(RedpandaChangesError)` if any changes are invalid
///
/// # Errors
/// * Returns error if attempting to create a topic with 0 partitions
/// * Returns error if attempting to decrease partition count on an existing topic
pub fn validate_changes(changes: &[KafkaChange]) -> Result<(), KafkaChangesError> {
    for change in changes.iter() {
        match change {
            KafkaChange::Added(topic) => {
                if topic.partitions == 0 {
                    return Err(KafkaChangesError::NotSupported(
                        "Partition count cannot be 0".to_string(),
                    ));
                }
            }

            KafkaChange::Updated { before, after } => {
                if before.partitions > after.partitions {
                    return Err(KafkaChangesError::NotSupported(format!(
                        "Cannot decrease parallelism from {:?} to {:?}",
                        before.partitions, after.partitions
                    )));
                }
            }
            _ => {}
        }
    }

    Ok(())
}

/// Executes a batch of streaming infrastructure changes against a Redpanda cluster.
///
/// This function processes each change in the provided list, performing the appropriate
/// action (create, update, or delete topics) based on the change type.
///
/// # Arguments
/// * `project` - Project configuration containing Redpanda connection details
/// * `changes` - A slice of RedpandaChange to apply to the Redpanda cluster
///
/// # Returns
/// * `Ok(())` if all changes were applied successfully
/// * `Err(RedpandaChangesError)` if any operation failed
///
/// # Errors
/// * Returns error if any operation fails (topic creation, update, or deletion)
pub async fn execute_changes(
    project: &Project,
    changes: &[KafkaChange],
) -> Result<(), KafkaChangesError> {
    for change in changes.iter() {
        match change {
            KafkaChange::Added(topic) => {
                info!("Creating topic: {:?}", topic.name);
                create_topics(&project.redpanda_config, vec![&topic]).await?;
            }

            KafkaChange::Removed(topic) => {
                info!("Deleting topic: {:?}", topic.name);
                delete_topics(&project.redpanda_config, vec![&topic]).await?;
            }

            KafkaChange::Updated { before, after } => {
                if before.retention_ms != after.retention_ms {
                    info!("Updating topic: {:?} with: {:?}", before, after);
                    update_topic_config(&project.redpanda_config, &before.name, after).await?;
                }

                match before.partitions.cmp(&after.partitions) {
                    std::cmp::Ordering::Greater => {
                        warn!(
                            "{:?} Cannot decrease a partition size, ignoring the change",
                            before
                        );
                    }
                    std::cmp::Ordering::Less => {
                        info!(
                            "Increasing partitions count for topic: {:?} from {} to {}",
                            before.name, before.partitions, after.partitions
                        );
                        add_partitions(&project.redpanda_config, &before.name, after.partitions)
                            .await?;
                    }
                    std::cmp::Ordering::Equal => {}
                }
            }
        }
    }

    Ok(())
}

/// Adds new partitions to an existing Redpanda/Kafka topic.
///
/// This function increases the partition count for a topic to the specified number.
/// It's important to note that partitions can only be increased, never decreased.
///
/// # Arguments
/// * `kafka_config` - Configuration for connecting to Redpanda/Kafka cluster
/// * `id` - Name/ID of the topic to add partitions to
/// * `partition_count` - The total number of partitions the topic should have after the operation
///
/// # Returns
/// * `Ok(())` if partitions were added successfully
/// * `Err(anyhow::Error)` if operation failed
///
/// # Errors
/// * Returns error if admin client creation fails
/// * Returns error if partition creation request fails
/// * Returns error if operation times out (after 5 seconds)
async fn add_partitions(
    kafka_config: &KafkaConfig,
    id: &str,
    partition_count: usize,
) -> anyhow::Result<()> {
    info!("Adding partitions to topic: {}", id);

    let admin_client: AdminClient<_> = build_rdkafka_client_config(kafka_config)
        .create()
        .expect("Redpanda Admin Client creation failed");

    let options = AdminOptions::new().operation_timeout(Some(Duration::from_secs(5)));
    let new_partitions = NewPartitions::new(id, partition_count);
    let result = admin_client
        .create_partitions([&new_partitions], &options)
        .await?;

    for res in result {
        match res {
            Ok(_) => info!("Topic {} set with {} partitions", id, partition_count),
            Err((_, err)) => {
                error!("Failed to add partitions to topic {}: {}", id, err);
                return Err(err.into());
            }
        }
    }

    Ok(())
}

/// Updates configuration parameters for an existing topic.
///
/// Currently, this function focuses on updating the retention period for the specified topic.
/// More configuration options could be added in the future.
///
/// # Arguments
/// * `kafka_config` - Configuration for connecting to Redpanda/Kafka cluster
/// * `id` - Name/ID of the topic to update
/// * `after` - The updated RedpandaStreamConfig configuration to apply
///
/// # Returns
/// * `Ok(())` if configuration was updated successfully
/// * `Err(anyhow::Error)` if operation failed
///
/// # Errors
/// * Returns error if admin client creation fails
/// * Returns error if configuration update request fails
/// * Returns error if operation times out (after 5 seconds)
async fn update_topic_config(
    kafka_config: &KafkaConfig,
    id: &str,
    after: &KafkaStreamConfig,
) -> anyhow::Result<()> {
    info!("Updating topic config for: {}", id);

    let admin_client: AdminClient<_> = build_rdkafka_client_config(kafka_config)
        .create()
        .expect("Redpanda Admin Client creation failed");

    let options = AdminOptions::new().operation_timeout(Some(Duration::from_secs(5)));

    let retention_ms = after.retention_ms.to_string();

    let topic = ResourceSpecifier::Topic(id);
    let config = AlterConfig::new(topic).set("retention.ms", retention_ms.as_str());

    let result = admin_client.alter_configs(&[config], &options).await?;

    for res in result {
        match res {
            Ok(_) => info!("Topic {} config updated successfully", id),
            Err((_, err)) => {
                error!("Failed to update config for topic {}: {}", id, err);
                return Err(err.into());
            }
        }
    }

    Ok(())
}

/// Creates one or more topics in the Redpanda/Kafka cluster.
///
/// This function creates new topics with the specified configuration, including
/// partition count, replication factor, retention period, and max message size.
///
/// # Arguments
/// * `config` - RedpandaConfig containing connection information
/// * `topics` - Vector of RedpandaStreamConfig objects to create
///
/// # Returns
/// * `Ok(())` if all topics were created successfully
/// * `Err(anyhow::Error)` if any operation failed
///
/// # Errors
/// * Returns error if admin client creation fails
/// * Returns error if topic creation request fails
/// * Returns error if operation times out (after 5 seconds)
///
/// # Side Effects
/// * Creates topics in the Redpanda/Kafka cluster
/// * Logs results of topic creation operations
pub async fn create_topics(
    config: &KafkaConfig,
    topics: Vec<&KafkaStreamConfig>,
) -> anyhow::Result<()> {
    info!("Creating topics: {:?}", topics);

    let admin_client: AdminClient<_> = build_rdkafka_client_config(config)
        .create()
        .expect("Redpanda Admin Client creation failed");

    // Prepare the AdminOptions
    let options = AdminOptions::new().operation_timeout(Some(std::time::Duration::from_secs(5)));

    for topic in &topics {
        // Create a new topic with partitions and replication factor
        let topic_name = topic.name.clone();
        let new_topic = NewTopic::new(
            &topic_name,
            topic.partitions as i32,
            TopicReplication::Fixed(config.replication_factor),
        );

        let topic_retention = topic.retention_ms.to_string();
        let max_message_bytes = topic.max_message_bytes.to_string();

        // Set some topic configurations
        let new_topic = new_topic
            .set(KAFKA_RETENTION_CONFIG_KEY, &topic_retention)
            .set(KAFKA_MAX_MESSAGE_BYTES_CONFIG_KEY, &max_message_bytes);

        let result_list = admin_client.create_topics(&[new_topic], &options).await?;

        for result in result_list {
            match result {
                Ok(topic_name) => info!("Topic {} created successfully", topic_name),
                Err((topic_name, RDKafkaErrorCode::TopicAlreadyExists)) => {
                    info!("Topic {} already exists", topic_name)
                }
                Err((topic_name, err)) => {
                    error!("Failed to create topic {}: {}", topic_name, err);
                    return Err(err.into());
                }
            }
        }
    }

    Ok(())
}

/// Deletes one or more topics from the Redpanda/Kafka cluster.
///
/// # Arguments
/// * `config` - RedpandaConfig containing connection information
/// * `topics` - Vector of RedpandaStreamConfig objects representing topics to delete
///
/// # Returns
/// * `Ok(())` if all topics were deleted successfully
/// * `Err(anyhow::Error)` if any operation failed
///
/// # Errors
/// * Returns error if admin client creation fails
/// * Returns error if topic deletion request fails
/// * Returns error if operation times out (after 5 seconds)
///
/// # Side Effects
/// * Deletes topics from the Redpanda/Kafka cluster
/// * Logs results of topic deletion operations
pub async fn delete_topics(
    config: &KafkaConfig,
    topics: Vec<&KafkaStreamConfig>,
) -> Result<(), anyhow::Error> {
    info!("Deleting topics: {:?}", topics);

    let admin_client: AdminClient<_> = build_rdkafka_client_config(config)
        .create()
        .expect("Redpanda Admin Client creation failed");

    // Prepare the AdminOptions
    let options = AdminOptions::new().operation_timeout(Some(std::time::Duration::from_secs(5)));

    for topic in &topics {
        let topic_name = &topic.name;
        let result_list = admin_client
            .delete_topics(&[topic_name.as_str()], &options)
            .await?;

        for result in result_list {
            match result {
                Ok(topic_name) => info!("Topic {} deleted successfully", topic_name),
                Err((topic_name, err)) => {
                    error!("Failed to delete topic {}: {}", topic_name, err)
                }
            }
        }
    }

    Ok(())
}

/// Retrieves configuration information for a specific topic.
///
/// This function fetches all configuration parameters for the specified topic
/// and returns them as a map of key-value pairs.
///
/// # Arguments
/// * `config` - RedpandaConfig containing connection information
/// * `topic_name` - The name of the topic to describe
///
/// # Returns
/// * `Ok(HashMap<String, String>)` with configuration key-value pairs on success
/// * `Err(KafkaError)` if the operation failed
///
/// # Errors
/// * Returns error if admin client creation fails
/// * Returns error if describe configs request fails
/// * Returns empty HashMap if no config could be retrieved
pub async fn describe_topic_config(
    config: &KafkaConfig,
    topic_name: &str,
) -> Result<HashMap<String, String>, rdkafka::error::KafkaError> {
    info!("Describing config for topic: {}", topic_name);

    let admin_client: AdminClient<_> = build_rdkafka_client_config(config)
        .create()
        .expect("Redpanda Admin Client creation failed");

    let options = AdminOptions::new().operation_timeout(Some(std::time::Duration::from_secs(5)));

    let result = admin_client
        .describe_configs(&[ResourceSpecifier::Topic(topic_name)], &options)
        .await?;

    match result.into_iter().next() {
        Some(Ok(config_resource)) => {
            let config_map: HashMap<String, String> = config_resource
                .entry_map()
                .into_iter()
                .filter_map(|(config_name, config_entry)| {
                    config_entry
                        .value
                        .as_ref()
                        .map(|value| (config_name.to_string(), value.to_string()))
                })
                .collect();

            Ok(config_map)
        }
        Some(Err(err)) => {
            error!("Failed to describe topic config: {}", err);
            Ok(HashMap::new())
        }
        None => {
            error!("No response from describe_configs");
            Ok(HashMap::new())
        }
    }
}

/// Creates a producer with idempotent delivery guarantees.
///
/// An idempotent producer ensures that messages are delivered exactly once
/// by assigning sequence numbers to each message and deduplicating at the broker.
///
/// # Arguments
/// * `config` - RedpandaConfig containing connection information
///
/// # Returns
/// * A FutureProducer configured for idempotent production
///
/// # Panics
/// * Panics if the producer creation fails
pub fn create_idempotent_producer(config: &KafkaConfig) -> FutureProducer {
    let mut client_config = build_rdkafka_client_config(config);

    client_config
        .set(
            KAFKA_MESSAGE_TIMEOUT_MS_CONFIG_KEY,
            (5 * 60 * 1000).to_string(),
        )
        .set(KAFKA_ENABLE_IDEMPOTENCE_CONFIG_KEY, true.to_string())
        .set(KAFKA_ACKS_CONFIG_KEY, "all")
        .set(KAFKA_ENABLE_GAPLESS_GUARANTEE_CONFIG_KEY, true.to_string());
    client_config.create().expect("Failed to create producer")
}

/// Creates a standard producer with custom message timeout and at-least-once delivery guarantees.
///
/// # Arguments
/// * `config` - RedpandaConfig containing connection information and producer settings
///
/// # Returns
/// * A ConfiguredProducer containing both the producer and its configuration
///
/// # Panics
/// * Panics if the producer creation fails
pub fn create_producer(config: KafkaConfig) -> ConfiguredProducer {
    let mut client_config = build_rdkafka_client_config(&config);

    client_config.set(
        "message.timeout.ms",
        config.clone().message_timeout_ms.to_string(),
    );
    // This means that all the In Sync replicas need to acknowledge the message
    // before the message is considered sent.
    // Idempotence implies acks = all but idempotence is a stronger garantee (exactly once)
    // We currently only want at least once delivery
    client_config.set(KAFKA_ACKS_CONFIG_KEY, "all");
    // This is the maximum number of retries that will be made before the timeout.
    client_config.set(KAFKA_RETRIES_CONFIG_KEY, "2147483647");

    let producer = client_config.create().expect("Failed to create producer");
    ConfiguredProducer { producer, config }
}

/// Retrieves the total message count across all partitions for a specific topic.
///
/// This function calculates the sum of high watermarks across all partitions
/// to determine the total number of messages in a topic.
///
/// # Arguments
/// * `topic` - Name of the topic to check
/// * `config` - RedpandaConfig containing connection information
///
/// # Returns
/// * `Ok(i64)` with the total number of messages on success
/// * `Err(KafkaError)` if the operation failed
///
/// # Errors
/// * Returns error if client creation fails
/// * Returns error if metadata fetch fails
/// * Returns error if watermark fetch fails for any partition
pub async fn check_topic_size(topic: &str, config: &KafkaConfig) -> Result<i64, KafkaError> {
    let client: StreamConsumer<_> = build_rdkafka_client_config(config).create()?;
    let timeout = Duration::from_secs(1);
    let md = client.fetch_metadata(Some(topic), timeout)?;
    let partitions = match md.topics().iter().find(|t| t.name() == topic) {
        None => return Ok(0),
        Some(topic) => topic.partitions(),
    };
    let total_count = partitions
        .iter()
        .map(|partition| {
            let (_, high_watermark) = client.fetch_watermarks(topic, partition.id(), timeout)?;
            Ok::<i64, KafkaError>(high_watermark)
        })
        .collect::<Result<Vec<i64>, _>>()?
        .into_iter()
        .sum();

    Ok(total_count)
}

/// Fetches all topics and their configurations from the Redpanda/Kafka cluster.
///
/// This function retrieves all topics that match the namespace prefix (if any)
/// along with their partition counts, retention periods, and max message sizes.
///
/// # Arguments
/// * `config` - RedpandaConfig containing connection information
///
/// # Returns
/// * `Ok(Vec<RedpandaStreamConfig>)` with topic configurations on success
/// * `Err(KafkaError)` if the operation failed
///
/// # Errors
/// * Returns error if client creation fails
/// * Returns error if metadata fetch fails
/// * Returns error if describe configs fails for any topic
pub async fn fetch_topics(
    config: &KafkaConfig,
) -> Result<Vec<KafkaStreamConfig>, rdkafka::error::KafkaError> {
    let rdkafka_config = build_rdkafka_client_config(config);
    let client: BaseConsumer = rdkafka_config.create()?;
    let admin_client: AdminClient<_> = rdkafka_config.create()?;
    let mut topics: Vec<KafkaStreamConfig> = Vec::new();

    let options = AdminOptions::new().operation_timeout(Some(std::time::Duration::from_secs(5)));

    let metadata = client.fetch_metadata(None, Duration::from_secs(5))?;

    for topic in metadata.topics() {
        if topic.name().starts_with(&config.get_namespace_prefix()) {
            let topic_name = topic.name();

            let config_result = admin_client
                .describe_configs(&[ResourceSpecifier::Topic(topic_name)], &options)
                .await?;

            let topic_config = config_result.first().unwrap().as_ref().unwrap();

            let retention_ms: u128 = topic_config
                .get(KAFKA_RETENTION_CONFIG_KEY)
                .and_then(|entry| entry.value.as_ref().and_then(|v| v.parse::<u128>().ok()))
                .unwrap_or(DEFAULT_RETENTION_MS);

            let max_message_bytes: usize = topic_config
                .get(KAFKA_MAX_MESSAGE_BYTES_CONFIG_KEY)
                .and_then(|entry| entry.value.as_ref().and_then(|v| v.parse::<usize>().ok()))
                .unwrap_or(DEFAULT_MAX_MESSAGE_BYTES);

            topics.push(KafkaStreamConfig::from_metadata(
                topic,
                retention_ms,
                max_message_bytes,
            ));
        }
    }

    Ok(topics)
}

/// Creates a consumer with custom configuration options.
///
/// This function creates a StreamConsumer with the provided extra configuration options.
///
/// # Arguments
/// * `config` - RedpandaConfig containing connection information
/// * `extra_config` - Additional configuration key-value pairs
///
/// # Returns
/// * A StreamConsumer configured with the specified options
///
/// # Panics
/// * Panics if the consumer creation fails
pub fn create_consumer(config: &KafkaConfig, extra_config: &[(&str, &str)]) -> StreamConsumer {
    let mut client_config = build_rdkafka_client_config(config);

    extra_config.iter().for_each(|(k, v)| {
        client_config.set(*k, *v);
    });
    client_config.create().expect("Failed to create consumer")
}

/// Creates a subscriber (consumer) for a specific topic with standard configuration.
///
/// This function creates a StreamConsumer with common settings for subscribing to a topic,
/// including auto-commit, session timeout, and offset reset behavior.
///
/// # Arguments
/// * `config` - RedpandaConfig containing connection information
/// * `group_id` - Consumer group ID to use (will be prefixed with namespace if available)
/// * `topic` - Name of the topic to subscribe to
///
/// # Returns
/// * A StreamConsumer subscribed to the specified topic
///
/// # Panics
/// * Panics if the consumer creation fails
/// * Panics if the subscription fails
pub fn create_subscriber(config: &KafkaConfig, group_id: &str, topic: &str) -> StreamConsumer {
    let group_id = config.prefix_with_namespace(group_id);
    let consumer = create_consumer(
        config,
        &[
            (KAFKA_SESSION_TIMEOUT_MS_CONFIG_KEY, "6000"),
            (KAFKA_ENABLE_PARTITION_EOF_CONFIG_KEY, "false"),
            (KAFKA_ENABLE_AUTO_COMMIT_CONFIG_KEY, "true"),
            (KAFKA_AUTO_COMMIT_INTERVAL_MS_CONFIG_KEY, "1000"),
            (KAFKA_ENABLE_AUTO_OFFSET_STORE_CONFIG_KEY, "false"),
            // to read records sent before subscriber is created
            (KAFKA_AUTO_OFFSET_RESET_CONFIG_KEY, "earliest"),
            // Groupid
            (KAFKA_GROUP_ID_CONFIG_KEY, &group_id),
            (KAFKA_ISOLATION_LEVEL_CONFIG_KEY, "read_committed"),
        ],
    );

    let topics = [topic];

    consumer
        .subscribe(&topics)
        .expect("Can't subscribe to specified topic");

    consumer
}

/// Waits for a message delivery future to complete and logs the result.
///
/// This function awaits the completion of a message send operation and logs
/// information about successful deliveries or errors.
///
/// # Arguments
/// * `topic` - The topic the message was sent to (for logging)
/// * `future` - The DeliveryFuture to await
///
/// # Side Effects
/// * Logs delivery information periodically (every 1024 messages)
/// * Logs warnings for failed deliveries
/// * Logs errors for cancelled futures
pub async fn wait_for_delivery(topic: &str, future: DeliveryFuture) {
    match future.await {
        Ok(Ok(delivery)) => {
            if delivery.offset % 1024 == 0 {
                info!(
                    // the timestamp of this logging is not the same time Kafka receives the message
                    "Sent to {} partition {} offset {}",
                    topic, delivery.partition, delivery.offset
                )
            }
        }
        Ok(Err((error, _))) => {
            warn!(
                "Failed to deliver message to {} with error: {}",
                topic, error
            );
        }
        Err(cancelled) => {
            error!(
                "Kafka DeliveryFuture is {}. This should never happen.",
                cancelled
            );
        }
    }
}

/// Processes the delivery future queue to prevent it from growing too large.
///
/// This function checks if the queue size has exceeded a threshold and, if so,
/// waits for some futures to complete to reduce the queue size.
///
/// # Arguments
/// * `topic` - The topic messages were sent to (for logging)
/// * `queue` - A mutable reference to the queue of DeliveryFuture objects
///
/// # Side Effects
/// * Waits for delivery futures to complete if queue size exceeds 2^16
/// * Reduces queue size to 2^15 entries
async fn maybe_dequeue(topic: &str, queue: &mut VecDeque<DeliveryFuture>) {
    if queue.len() >= 2 << 16 {
        while queue.len() >= 2 << 15 {
            match queue.pop_front() {
                None => return,
                Some(f) => wait_for_delivery(topic, f).await,
            };
        }
    }
}

/// Sends a message with back-pressure handling for queue full conditions.
///
/// This function attempts to send a message and handles queue full errors by
/// waiting for pending messages to be delivered before retrying.
///
/// # Arguments
/// * `queue` - A mutable reference to the queue of DeliveryFuture objects
/// * `producer` - The FutureProducer to use for sending messages
/// * `topic` - The topic to send the message to
/// * `payload` - The message payload as a String
///
/// # Side Effects
/// * Adds new delivery futures to the queue
/// * Manages queue size through maybe_dequeue
/// * Waits for delivery futures to complete if queue is full
pub async fn send_with_back_pressure(
    queue: &mut VecDeque<DeliveryFuture>,
    producer: &FutureProducer,
    topic: &str,
    payload: String,
) {
    let mut record = FutureRecord::to(topic)
        .key(topic)
        .payload(payload.as_bytes());

    loop {
        let queue_result = producer.send_result(record);
        match queue_result {
            Ok(f) => {
                queue.push_back(f);
                maybe_dequeue(topic, queue).await;
                return;
            }
            Err((KafkaError::MessageProduction(RDKafkaErrorCode::QueueFull), r)) => {
                record = r;
                if let Some(f) = queue.pop_front() {
                    wait_for_delivery(topic, f).await;
                }
            }
            Err((unknown_err, _)) => {
                error!(
                    "Got unknown error {}. This should never happen.",
                    unknown_err
                );
                return;
            }
        }
    }
}

/// Simple health check for Kafka connectivity without using unsafe iterators across await points
pub async fn health_check(config: &KafkaConfig) -> Result<bool, KafkaError> {
    let client_config = build_rdkafka_client_config(config);
    let client: BaseConsumer = client_config.create()?;

    // Simple client.metadata() call without iterating over topics
    match client.fetch_metadata(None, Duration::from_secs(2)) {
        Ok(_) => Ok(true),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_changes_zero_partitions() {
        let topic = KafkaStreamConfig {
            name: "test_topic".to_string(),
            partitions: 0,
            retention_ms: 60000,
            max_message_bytes: 1024,
            namespace: None,
            version: None,
        };

        let changes = vec![KafkaChange::Added(topic)];

        assert!(validate_changes(&changes).is_err());
    }

    #[test]
    fn test_validate_changes_decrease_partitions() {
        let before = KafkaStreamConfig {
            name: "test_topic".to_string(),
            partitions: 3,
            retention_ms: 60000,
            max_message_bytes: 1024,
            namespace: None,
            version: None,
        };

        let after = KafkaStreamConfig {
            partitions: 1,
            ..before.clone()
        };

        let changes = vec![KafkaChange::Updated { before, after }];

        assert!(validate_changes(&changes).is_err());
    }

    #[test]
    fn test_validate_changes_valid() {
        let before = KafkaStreamConfig {
            name: "test_topic".to_string(),
            partitions: 1,
            retention_ms: 60000,
            max_message_bytes: 1024,
            namespace: None,
            version: None,
        };

        let after = KafkaStreamConfig {
            partitions: 3,
            ..before.clone()
        };

        let changes = vec![KafkaChange::Updated { before, after }];

        assert!(validate_changes(&changes).is_ok());
    }
}
