use rdkafka::{metadata::MetadataTopic, producer::FutureProducer};
use serde::{Deserialize, Serialize};

use crate::framework::{core::infrastructure::topic::Topic, versions::Version};

use super::constants::NAMESPACE_SEPARATOR;

/// RedpandaStreamConfig represents the configuration for a Redpanda/Kafka topic.
///
/// This struct contains all necessary configuration parameters for working with a
/// Redpanda topic, including name, partitions, retention period, message size limits,
/// and namespace information.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct KafkaStreamConfig {
    /// The name of the stream, this includes the namespace and the version if it exists
    pub name: String,
    /// The number of partitions for the stream
    pub partitions: usize,
    /// The retention period for the stream in milliseconds
    pub retention_ms: u128,
    /// The maximum message size for the stream in bytes
    pub max_message_bytes: usize,
    /// The namespace for the stream, if any
    pub namespace: Option<String>,
    /// The version of the stream, if it exists
    pub version: Option<Version>,
}

impl KafkaStreamConfig {
    /// Extracts the topic name without the namespace prefix.
    ///
    /// If the topic name includes a namespace separator, returns the part after the separator.
    /// Otherwise, returns the full name.
    ///
    /// # Returns
    /// * A String containing the topic name without the namespace
    pub fn get_topic_name_without_namespace(&self) -> String {
        if let Some(pos) = self.name.find(NAMESPACE_SEPARATOR) {
            self.name[pos + 1..].to_string()
        } else {
            self.name.to_owned()
        }
    }

    /// Creates a RedpandaStreamConfig from a core Topic model.
    ///
    /// This function converts a domain model Topic to its Redpanda-specific representation,
    /// applying namespace configuration if available.
    ///
    /// # Arguments
    /// * `kafka_config` - The RedpandaConfig containing namespace information
    /// * `topic` - The core Topic domain model to convert
    ///
    /// # Returns
    /// * A new RedpandaStreamConfig instance
    pub fn from_topic(kafka_config: &KafkaConfig, topic: &Topic) -> Self {
        Self {
            name: topic_name(&kafka_config.namespace, topic.id()),
            partitions: topic.partition_count,
            retention_ms: topic.retention_period.as_millis(),
            max_message_bytes: topic.max_message_bytes,
            namespace: kafka_config.namespace.clone(),
            version: topic.version.clone(),
        }
    }

    /// Creates a RedpandaStreamConfig from Kafka metadata.
    ///
    /// This constructor builds a RedpandaStreamConfig from metadata returned by the Kafka API,
    /// along with additional configuration parameters.
    ///
    /// # Arguments
    /// * `metadata` - The MetadataTopic from Kafka API
    /// * `retention_ms` - The retention period in milliseconds
    /// * `max_message_bytes` - The maximum message size in bytes
    ///
    /// # Returns
    /// * A new RedpandaStreamConfig instance
    pub fn from_metadata(
        metadata: &MetadataTopic,
        retention_ms: u128,
        max_message_bytes: usize,
    ) -> Self {
        let namespace = get_namespace(metadata);
        let version = extract_version_from_topic_name(metadata.name());
        Self {
            name: metadata.name().to_string(),
            partitions: metadata.partitions().len(),
            retention_ms,
            max_message_bytes,
            namespace,
            version,
        }
    }

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

    /// Deserializes a RedpandaStreamConfig from a JSON string.
    ///
    /// # Arguments
    /// * `s` - The JSON string to parse
    ///
    /// # Returns
    /// * A new RedpandaStreamConfig instance
    ///
    /// # Panics
    /// * Panics if deserialization fails
    pub fn from_json_string(s: &str) -> Self {
        serde_json::from_str(s).unwrap()
    }
}

/// Configuration for connecting to and interacting with a Redpanda/Kafka cluster.
///
/// This struct contains all necessary connection parameters and default settings
/// for working with a Redpanda cluster, including authentication, timeouts, and
/// namespace configuration.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct KafkaConfig {
    /// Broker connection string in format "host:port"
    pub broker: String,
    /// Optional Schema Registry base URL (e.g., http://localhost:8081)
    #[serde(default)]
    pub schema_registry_url: Option<String>,
    /// Message timeout in milliseconds
    pub message_timeout_ms: i32,
    /// Default retention period in milliseconds
    pub retention_ms: i32,
    /// Replication factor for topics (defaults to 1)
    #[serde(default = "default_replication_factor")]
    pub replication_factor: i32,
    /// SASL username for authentication, if required
    pub sasl_username: Option<String>,
    /// SASL password for authentication, if required
    pub sasl_password: Option<String>,
    /// SASL mechanism (e.g., "PLAIN", "SCRAM-SHA-256")
    pub sasl_mechanism: Option<String>,
    /// Security protocol (e.g., "SASL_SSL", "PLAINTEXT")
    pub security_protocol: Option<String>,
    /// Namespace for topic isolation
    pub namespace: Option<String>,
}

impl KafkaConfig {
    /// Gets the namespace prefix for topics.
    ///
    /// If a namespace is configured, returns the namespace followed by a separator.
    /// Otherwise, returns an empty string.
    ///
    /// # Returns
    /// * A String containing the namespace prefix
    pub fn get_namespace_prefix(&self) -> String {
        namespace_prefix(&self.namespace)
    }

    /// Prefixes a value with the namespace.
    ///
    /// Prepends the namespace and separator to the provided value if a namespace is configured.
    ///
    /// # Arguments
    /// * `value` - The string value to prefix
    ///
    /// # Returns
    /// * A String containing the prefixed value
    pub fn prefix_with_namespace(&self, value: &str) -> String {
        format!("{}{}", self.get_namespace_prefix(), value)
    }
}

/// Default replication factor for Redpanda topics.
///
/// # Returns
/// * The default replication factor (1)
fn default_replication_factor() -> i32 {
    1
}

/// Formats a namespace prefix with the appropriate separator.
///
/// # Arguments
/// * `namespace` - Optional namespace
///
/// # Returns
/// * A String containing the namespace prefix with separator if namespace is present,
///   otherwise an empty string
fn namespace_prefix(namespace: &Option<String>) -> String {
    namespace
        .as_ref()
        .map(|ns| format!("{ns}{NAMESPACE_SEPARATOR}"))
        .unwrap_or_default()
}

/// Extracts the namespace from a topic's metadata.
///
/// Parses the topic name to extract the namespace part before the separator.
///
/// # Arguments
/// * `topic` - The MetadataTopic to extract namespace from
///
/// # Returns
/// * Some(String) containing the namespace if present, None otherwise
fn get_namespace(topic: &MetadataTopic) -> Option<String> {
    topic
        .name()
        .split(NAMESPACE_SEPARATOR)
        .next()
        .map(|ns| ns.to_string())
}

/// Extracts the version from a topic name.
///
/// The version is expected to be at the end of the topic name as a suffix in the format:
/// `_version_version_version` where each "version" represents a component of a semantic version.
/// The version can have one, two, or three components (e.g., "1", "1_2", or "1_2_3").
///
/// # Arguments
/// * `topic_name` - The topic name to extract the version from
///
/// # Returns
/// * `Option<Version>` - The extracted version if present, None otherwise
///
/// # Examples
/// ```
/// // Three-part version
/// let topic_name = "my_topic_1_2_3";
/// let version = extract_version_from_topic_name(topic_name);
/// assert_eq!(version.unwrap().as_str(), "1.2.3");
///
/// // Two-part version
/// let topic_name = "my_topic_1_2";
/// let version = extract_version_from_topic_name(topic_name);
/// assert_eq!(version.unwrap().as_str(), "1.2");
///
/// // One-part version
/// let topic_name = "my_topic_1";
/// let version = extract_version_from_topic_name(topic_name);
/// assert_eq!(version.unwrap().as_str(), "1");
/// ```
pub fn extract_version_from_topic_name(topic_name: &str) -> Option<Version> {
    // Split the topic name by underscores
    let parts: Vec<&str> = topic_name.split('_').collect();

    // Need at least one part for a version
    if parts.is_empty() {
        return None;
    }

    // Try to find the version components from the end
    let mut version_parts = Vec::new();
    let mut i = parts.len();

    // Look for up to 3 numeric parts from the end
    while i > 0 && version_parts.len() < 3 {
        i -= 1;
        if parts[i].parse::<i32>().is_ok() {
            version_parts.insert(0, parts[i]);
        } else {
            // Stop if we encounter a non-numeric part
            break;
        }
    }

    // If we found at least one version component
    if !version_parts.is_empty() {
        // Convert underscore format to dot format
        let version_str = version_parts.join(".");
        Some(Version::from_string(version_str))
    } else {
        None
    }
}

/// Constructs a full topic name with namespace and version.
///
/// If a namespace is provided, formats the topic name as "{namespace}{separator}{topic.name}_{version}".
/// Otherwise, returns the topic name with version appended.
///
/// # Arguments
/// * `namespace` - Optional namespace to prefix
/// * `topic` - The Topic to get the name and version from
///
/// # Returns
/// * A String containing the full topic name with version
pub fn topic_name(namespace: &Option<String>, topic_id: String) -> String {
    if let Some(ns) = namespace {
        format!("{ns}{NAMESPACE_SEPARATOR}{topic_id}")
    } else {
        topic_id
    }
}

impl Default for KafkaConfig {
    fn default() -> Self {
        Self {
            broker: "localhost:19092".to_string(),
            schema_registry_url: None,
            message_timeout_ms: 1000,
            retention_ms: 30000,
            replication_factor: 1,
            sasl_username: None,
            sasl_password: None,
            sasl_mechanism: None,
            security_protocol: None,
            namespace: None,
        }
    }
}

/// A wrapper for a Redpanda producer and its configuration.
///
/// This struct combines a FutureProducer with its associated configuration
/// for convenience in passing both together.
#[derive(Clone)]
pub struct ConfiguredProducer {
    /// The underlying Redpanda/Kafka producer
    pub producer: FutureProducer,
    /// The configuration used to create this producer
    pub config: KafkaConfig,
}

/// Represents a change that can be applied to a Redpanda topic.
///
/// This enum allows us to track what types of changes need to be
/// made to the Redpanda streaming infrastructure.
#[derive(Debug, Clone)]
pub enum KafkaChange {
    /// Represents adding a new topic
    Added(KafkaStreamConfig),
    /// Represents removing an existing topic
    Removed(KafkaStreamConfig),
    /// Represents updating an existing topic
    Updated {
        /// The topic configuration before the update
        before: KafkaStreamConfig,
        /// The topic configuration after the update
        after: KafkaStreamConfig,
    },
}
