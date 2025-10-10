//! # Sample Stream Tool
//!
//! This module implements the MCP tool for sampling data from Redpanda/Kafka streaming topics.
//! It provides functionality to retrieve recent messages from topics for debugging and exploration.

use futures::stream::BoxStream;
use log::info;
use rdkafka::consumer::Consumer;
use rdkafka::{Message as KafkaMessage, Offset, TopicPartitionList};
use rmcp::model::{CallToolResult, Tool};
use serde_json::{json, Map, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio_stream::StreamExt;

use super::{create_error_result, create_success_result};
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::redis::redis_client::RedisClient;
use crate::infrastructure::stream::kafka::client::create_consumer;
use crate::infrastructure::stream::kafka::models::KafkaConfig;

// Constants for validation
const MIN_LIMIT: u8 = 1;
const MAX_LIMIT: u8 = 100;
const DEFAULT_LIMIT: u8 = 10;
const VALID_FORMATS: [&str; 2] = ["json", "pretty"];
const DEFAULT_FORMAT: &str = "json";
const SAMPLE_TIMEOUT_SECS: u64 = 2;

/// Error types for stream sampling operations
#[derive(Debug, thiserror::Error)]
pub enum StreamSampleError {
    #[error("Failed to load infrastructure map from Redis: {0}")]
    RedisLoad(#[from] anyhow::Error),

    #[error("Topic '{0}' not found in infrastructure map")]
    TopicNotFound(String),

    #[error("Failed to create or use Kafka consumer: {0}")]
    ConsumerError(String),

    #[error("Failed to serialize messages: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
}

/// Parameters for the get_stream_sample tool
#[derive(Debug)]
struct GetStreamSampleParams {
    /// Name of the stream/topic to sample
    stream_name: String,
    /// Number of messages to retrieve (default: 10, max: 100)
    limit: u8,
    /// Output format: "json" or "pretty" (default: "json")
    format: String,
}

/// Helper to check if a format string is valid
fn is_valid_format(format: &str) -> bool {
    VALID_FORMATS.contains(&format.to_lowercase().as_str())
}

/// Returns the tool definition for the MCP server
pub fn tool_definition() -> Tool {
    let schema = json!({
        "type": "object",
        "properties": {
            "stream_name": {
                "type": "string",
                "description": "Name of the stream/topic to sample from"
            },
            "limit": {
                "type": "number",
                "description": format!("Number of recent messages to retrieve (default: {}, max: {})", DEFAULT_LIMIT, MAX_LIMIT),
                "minimum": MIN_LIMIT,
                "maximum": MAX_LIMIT
            },
            "format": {
                "type": "string",
                "description": format!("Output format: 'json' (default) or 'pretty'. Default: {}", DEFAULT_FORMAT),
                "enum": VALID_FORMATS
            }
        },
        "required": ["stream_name"]
    });

    Tool {
        name: "get_stream_sample".into(),
        description: Some(
            "Retrieve sample messages from a Redpanda/Kafka streaming topic. Get the last N messages from any topic/stream for debugging and exploration. Returns messages as JSON arrays with message payloads.".into()
        ),
        input_schema: Arc::new(schema.as_object().unwrap().clone()),
        annotations: None,
        icons: None,
        output_schema: None,
        title: Some("Get Stream Sample".into()),
    }
}

/// Parse and validate parameters from MCP arguments
fn parse_params(
    arguments: Option<&Map<String, Value>>,
) -> Result<GetStreamSampleParams, StreamSampleError> {
    let stream_name = arguments
        .and_then(|v| v.get("stream_name"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| StreamSampleError::InvalidParameter("stream_name is required".to_string()))?
        .to_string();

    if stream_name.trim().is_empty() {
        return Err(StreamSampleError::InvalidParameter(
            "stream_name cannot be empty".to_string(),
        ));
    }

    let limit = arguments
        .and_then(|v| v.get("limit"))
        .and_then(|v| v.as_u64())
        .map(|v| v as u8)
        .unwrap_or(DEFAULT_LIMIT);

    // Validate limit
    if !(MIN_LIMIT..=MAX_LIMIT).contains(&limit) {
        return Err(StreamSampleError::InvalidParameter(format!(
            "limit must be between {} and {}, got {}",
            MIN_LIMIT, MAX_LIMIT, limit
        )));
    }

    let format = arguments
        .and_then(|v| v.get("format"))
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_FORMAT)
        .to_string();

    // Validate format
    if !is_valid_format(&format) {
        return Err(StreamSampleError::InvalidParameter(format!(
            "format must be one of {}; got {}",
            VALID_FORMATS.join(", "),
            format
        )));
    }

    Ok(GetStreamSampleParams {
        stream_name,
        limit,
        format,
    })
}

/// Handle the tool call with the given arguments
pub async fn handle_call(
    arguments: Option<&Map<String, Value>>,
    redis_client: Arc<RedisClient>,
    kafka_config: Arc<KafkaConfig>,
) -> CallToolResult {
    let params = match parse_params(arguments) {
        Ok(p) => p,
        Err(e) => return create_error_result(format!("Parameter validation error: {}", e)),
    };

    match execute_get_stream_sample(params, redis_client, kafka_config).await {
        Ok(content) => create_success_result(content),
        Err(e) => create_error_result(format!("Error sampling stream: {}", e)),
    }
}

/// Find a topic in the infrastructure map by name (case-insensitive)
fn find_topic_by_name<'a>(
    infra_map: &'a InfrastructureMap,
    topic_name: &str,
) -> Option<&'a crate::framework::core::infrastructure::topic::Topic> {
    infra_map.topics.iter().find_map(|(key, topic)| {
        if key.eq_ignore_ascii_case(topic_name) {
            Some(topic)
        } else {
            None
        }
    })
}

/// Build topic partition map for sampling the last N messages
fn build_partition_map(
    topic_id: &str,
    partition_count: usize,
    limit: u8,
) -> std::collections::HashMap<(String, i32), Offset> {
    (0..partition_count)
        .map(|partition| {
            (
                (topic_id.to_string(), partition as i32),
                Offset::OffsetTail(limit as i64),
            )
        })
        .collect()
}

/// Result of message collection including metadata about the operation
///
/// # Fields
/// * `messages` - Successfully deserialized messages (empty payloads become `null`)
/// * `timed_out` - Whether the collection timed out before reaching the limit
/// * `error_count` - Number of messages that failed to deserialize (excludes empty payloads)
#[derive(Debug)]
struct MessageCollectionResult {
    messages: Vec<Value>,
    timed_out: bool,
    error_count: usize,
}

/// Collect messages from a stream into a vector, tracking timeouts and errors
///
/// # Timeout Behavior
/// The timeout applies to the ENTIRE collection operation, not per-message. This is ensured
/// by applying `.timeout()` before `.take()` in the stream chain. Without this ordering,
/// the timeout would apply to each individual message, potentially waiting up to
/// `limit * timeout_duration` seconds total.
///
/// # Empty Payload Handling
/// Messages with empty payloads are treated as `Value::Null` rather than deserialization
/// errors. This prevents inflating error counts for legitimately empty messages.
async fn collect_messages_from_stream(
    mut stream: BoxStream<'_, Result<anyhow::Result<Value>, tokio_stream::Elapsed>>,
    stream_name: &str,
) -> MessageCollectionResult {
    let mut messages = Vec::new();
    let mut timed_out = false;
    let mut error_count = 0;

    while let Some(result) = stream.next().await {
        match result {
            Ok(Ok(value)) => messages.push(value),
            Ok(Err(e)) => {
                log::warn!(
                    "Error deserializing message from stream '{}': {}",
                    stream_name,
                    e
                );
                error_count += 1;
            }
            Err(_elapsed) => {
                log::info!(
                    "Timeout waiting for messages from stream '{}' after {} seconds. Retrieved {} messages.",
                    stream_name,
                    SAMPLE_TIMEOUT_SECS,
                    messages.len()
                );
                timed_out = true;
                break;
            }
        }
    }

    MessageCollectionResult {
        messages,
        timed_out,
        error_count,
    }
}

/// Main function to retrieve and format stream samples
async fn execute_get_stream_sample(
    params: GetStreamSampleParams,
    redis_client: Arc<RedisClient>,
    kafka_config: Arc<KafkaConfig>,
) -> Result<String, StreamSampleError> {
    // Load infrastructure map from Redis
    let infra_map = InfrastructureMap::load_from_redis(&redis_client)
        .await?
        .ok_or_else(|| {
            StreamSampleError::ConsumerError(
                "No infrastructure map found. The dev server may not be running.".to_string(),
            )
        })?;

    // Find the topic (case-insensitive)
    let topic = find_topic_by_name(&infra_map, &params.stream_name)
        .ok_or_else(|| StreamSampleError::TopicNotFound(params.stream_name.clone()))?;

    // Create consumer with unique group ID for sampling
    let group_id =
        kafka_config.prefix_with_namespace(&format!("mcp_sample_{}", uuid::Uuid::new_v4()));
    let consumer = create_consumer(&kafka_config, &[("group.id", &group_id)]);

    // Build topic partition list with tail offset for getting last N messages
    let topic_partition_map = build_partition_map(&topic.id(), topic.partition_count, params.limit);

    info!(
        "Sampling topic '{}' with partition map: {:?}",
        params.stream_name, topic_partition_map
    );

    // Assign partitions to consumer
    TopicPartitionList::from_topic_map(&topic_partition_map)
        .and_then(|tpl| consumer.assign(&tpl))
        .map_err(|e| {
            StreamSampleError::ConsumerError(format!("Failed to assign partitions: {}", e))
        })?;

    // Create message stream with timeout
    // Note: timeout() is applied BEFORE take() so it applies to the entire collection,
    // not per-message. This ensures we timeout after SAMPLE_TIMEOUT_SECS total, not per message.
    let stream: BoxStream<Result<anyhow::Result<Value>, tokio_stream::Elapsed>> = Box::pin(
        consumer
            .stream()
            .timeout(Duration::from_secs(SAMPLE_TIMEOUT_SECS))
            .take(params.limit.into())
            .map(|timeout_result| {
                timeout_result.map(|kafka_result| {
                    let message = kafka_result?;
                    let payload = message.payload().unwrap_or(&[]);

                    // Handle empty payloads gracefully - treat as null instead of error
                    if payload.is_empty() {
                        Ok(Value::Null)
                    } else {
                        Ok(serde_json::from_slice::<Value>(payload)?)
                    }
                })
            }),
    );

    // Collect messages with timeout tracking
    let result = collect_messages_from_stream(stream, &params.stream_name).await;

    // Format output with metadata about the collection
    format_output(&params, &result, topic.partition_count)
}

/// Format the output based on the requested format
fn format_output(
    params: &GetStreamSampleParams,
    result: &MessageCollectionResult,
    partition_count: usize,
) -> Result<String, StreamSampleError> {
    let messages = &result.messages;

    if messages.is_empty() {
        let mut msg = format!("No messages found in stream '{}'.", params.stream_name);

        if result.timed_out {
            msg.push_str(" Operation timed out waiting for messages.");
        } else {
            msg.push_str(" The topic may be empty or no recent messages are available.");
        }

        return Ok(msg);
    }

    match params.format.as_str() {
        "pretty" => {
            let mut output = format!("# Stream Sample: {}\n\n", params.stream_name);
            output.push_str(&format!(
                "Retrieved {} message(s) from {} partition(s)\n",
                messages.len(),
                partition_count
            ));

            // Add timeout/error information if relevant
            if result.timed_out {
                output.push_str(&format!(
                    "⚠️  Collection timed out after {} seconds (requested {} messages)\n",
                    SAMPLE_TIMEOUT_SECS, params.limit
                ));
            }
            if result.error_count > 0 {
                output.push_str(&format!(
                    "⚠️  {} message(s) failed to deserialize\n",
                    result.error_count
                ));
            }
            output.push('\n');

            for (i, msg) in messages.iter().enumerate() {
                output.push_str(&format!("## Message {}\n", i + 1));
                output.push_str("```json\n");
                output.push_str(&serde_json::to_string_pretty(msg)?);
                output.push_str("\n```\n\n");
            }

            Ok(output)
        }
        _ => {
            // Default to JSON format
            let mut response = json!({
                "stream_name": params.stream_name,
                "message_count": messages.len(),
                "partition_count": partition_count,
                "messages": messages
            });

            // Add metadata about the collection
            if result.timed_out || result.error_count > 0 {
                let metadata = json!({
                    "timed_out": result.timed_out,
                    "error_count": result.error_count,
                    "requested_limit": params.limit,
                });
                response
                    .as_object_mut()
                    .unwrap()
                    .insert("metadata".to_string(), metadata);
            }

            Ok(serde_json::to_string_pretty(&response)?)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_format() {
        assert!(is_valid_format("json"));
        assert!(is_valid_format("JSON"));
        assert!(is_valid_format("pretty"));
        assert!(is_valid_format("PRETTY"));

        assert!(!is_valid_format("invalid"));
        assert!(!is_valid_format(""));
        assert!(!is_valid_format("xml"));
    }

    #[test]
    fn test_parse_params_valid() {
        // Test with all parameters
        let args = json!({
            "stream_name": "user_events",
            "limit": 20,
            "format": "pretty"
        });
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());
        let params = result.unwrap();
        assert_eq!(params.stream_name, "user_events");
        assert_eq!(params.limit, 20);
        assert_eq!(params.format, "pretty");

        // Test with only required parameter
        let args = json!({"stream_name": "test_topic"});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_ok());
        let params = result.unwrap();
        assert_eq!(params.stream_name, "test_topic");
        assert_eq!(params.limit, DEFAULT_LIMIT);
        assert_eq!(params.format, DEFAULT_FORMAT);
    }

    #[test]
    fn test_parse_params_missing_stream_name() {
        let args = json!({"limit": 10});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("stream_name is required"));
    }

    #[test]
    fn test_parse_params_empty_stream_name() {
        let args = json!({"stream_name": "  "});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("stream_name cannot be empty"));
    }

    #[test]
    fn test_parse_params_invalid_limit() {
        // Limit too small
        let args = json!({"stream_name": "test", "limit": 0});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("between 1 and 100"));

        // Limit too large
        let args = json!({"stream_name": "test", "limit": 101});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_params_invalid_format() {
        let args = json!({"stream_name": "test", "format": "invalid"});
        let map = args.as_object().unwrap();
        let result = parse_params(Some(map));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("must be one of"));
    }

    #[test]
    fn test_parse_params_boundary_values() {
        // Test minimum limit
        let args = json!({"stream_name": "test", "limit": MIN_LIMIT});
        let map = args.as_object().unwrap();
        assert!(parse_params(Some(map)).is_ok());

        // Test maximum limit
        let args = json!({"stream_name": "test", "limit": MAX_LIMIT});
        let map = args.as_object().unwrap();
        assert!(parse_params(Some(map)).is_ok());
    }

    #[test]
    fn test_format_output_empty_messages_no_timeout() {
        let params = GetStreamSampleParams {
            stream_name: "test_topic".to_string(),
            limit: 10,
            format: "json".to_string(),
        };
        let collection_result = MessageCollectionResult {
            messages: vec![],
            timed_out: false,
            error_count: 0,
        };
        let result = format_output(&params, &collection_result, 1);
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("No messages found"));
        assert!(!output.contains("timed out"));
    }

    #[test]
    fn test_format_output_empty_messages_with_timeout() {
        let params = GetStreamSampleParams {
            stream_name: "test_topic".to_string(),
            limit: 10,
            format: "json".to_string(),
        };
        let collection_result = MessageCollectionResult {
            messages: vec![],
            timed_out: true,
            error_count: 0,
        };
        let result = format_output(&params, &collection_result, 1);
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("No messages found"));
        assert!(output.contains("timed out"));
    }

    #[test]
    fn test_format_output_json() {
        let params = GetStreamSampleParams {
            stream_name: "test_topic".to_string(),
            limit: 10,
            format: "json".to_string(),
        };
        let collection_result = MessageCollectionResult {
            messages: vec![
                json!({"id": 1, "name": "test1"}),
                json!({"id": 2, "name": "test2"}),
            ],
            timed_out: false,
            error_count: 0,
        };
        let result = format_output(&params, &collection_result, 2);
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("test_topic"));
        assert!(output.contains("message_count"));
        assert!(output.contains("partition_count"));
        assert!(!output.contains("metadata")); // No metadata when no timeout/errors
    }

    #[test]
    fn test_format_output_json_with_timeout() {
        let params = GetStreamSampleParams {
            stream_name: "test_topic".to_string(),
            limit: 10,
            format: "json".to_string(),
        };
        let collection_result = MessageCollectionResult {
            messages: vec![json!({"id": 1, "name": "test1"})],
            timed_out: true,
            error_count: 0,
        };
        let result = format_output(&params, &collection_result, 2);
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("test_topic"));
        assert!(output.contains("metadata"));
        assert!(output.contains("timed_out"));
    }

    #[test]
    fn test_format_output_json_with_errors() {
        let params = GetStreamSampleParams {
            stream_name: "test_topic".to_string(),
            limit: 10,
            format: "json".to_string(),
        };
        let collection_result = MessageCollectionResult {
            messages: vec![json!({"id": 1, "name": "test1"})],
            timed_out: false,
            error_count: 3,
        };
        let result = format_output(&params, &collection_result, 2);
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("metadata"));
        assert!(output.contains("error_count"));
        assert!(output.contains("\"error_count\": 3"));
    }

    #[test]
    fn test_format_output_pretty() {
        let params = GetStreamSampleParams {
            stream_name: "test_topic".to_string(),
            limit: 10,
            format: "pretty".to_string(),
        };
        let collection_result = MessageCollectionResult {
            messages: vec![json!({"id": 1, "name": "test"})],
            timed_out: false,
            error_count: 0,
        };
        let result = format_output(&params, &collection_result, 1);
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("# Stream Sample"));
        assert!(output.contains("Message 1"));
        assert!(output.contains("```json"));
        assert!(!output.contains("⚠️")); // No warnings when no timeout/errors
    }

    #[test]
    fn test_format_output_pretty_with_timeout() {
        let params = GetStreamSampleParams {
            stream_name: "test_topic".to_string(),
            limit: 10,
            format: "pretty".to_string(),
        };
        let collection_result = MessageCollectionResult {
            messages: vec![json!({"id": 1, "name": "test"})],
            timed_out: true,
            error_count: 0,
        };
        let result = format_output(&params, &collection_result, 1);
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("⚠️"));
        assert!(output.contains("timed out"));
    }

    #[test]
    fn test_constants_consistency() {
        // Ensure constants are sensible
        const _: () = assert!(MIN_LIMIT > 0);
        const _: () = assert!(MAX_LIMIT > MIN_LIMIT);
        const _: () = assert!(DEFAULT_LIMIT >= MIN_LIMIT);
        const _: () = assert!(DEFAULT_LIMIT <= MAX_LIMIT);
        assert_eq!(VALID_FORMATS.len(), 2);
        // SAMPLE_TIMEOUT_SECS is a constant, so we don't need to assert on it
    }

    #[test]
    fn test_find_topic_by_name() {
        use crate::framework::core::infrastructure::topic::Topic;
        use crate::framework::core::infrastructure_map::PrimitiveSignature;
        use crate::framework::core::partial_infrastructure_map::LifeCycle;
        use crate::framework::versions::Version;
        use std::collections::HashMap;
        use std::time::Duration;

        // Create mock topics using the struct directly
        let user_topic = Topic {
            version: Some(Version::from_string("0.0.1".to_string())),
            name: "user_events_topic".to_string(),
            retention_period: Duration::from_secs(60000),
            partition_count: 3,
            columns: vec![],
            max_message_bytes: 1024,
            source_primitive: PrimitiveSignature {
                name: "UserEvents".to_string(),
                primitive_type:
                    crate::framework::core::infrastructure_map::PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::default_for_deserialization(),
            schema_config: None,
        };

        let order_topic = Topic {
            version: Some(Version::from_string("0.0.1".to_string())),
            name: "order_events_topic".to_string(),
            retention_period: Duration::from_secs(60000),
            partition_count: 2,
            columns: vec![],
            max_message_bytes: 1024,
            source_primitive: PrimitiveSignature {
                name: "OrderEvents".to_string(),
                primitive_type:
                    crate::framework::core::infrastructure_map::PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::default_for_deserialization(),
            schema_config: None,
        };

        let mut topics = HashMap::new();
        topics.insert("UserEvents".to_string(), user_topic);
        topics.insert("OrderEvents".to_string(), order_topic);

        let infra_map = InfrastructureMap {
            topics,
            ..Default::default()
        };

        // Test exact match
        let result = find_topic_by_name(&infra_map, "UserEvents");
        assert!(result.is_some());
        assert_eq!(result.unwrap().id(), "user_events_topic_0_0_1");

        // Test case-insensitive match
        let result = find_topic_by_name(&infra_map, "userevents");
        assert!(result.is_some());
        assert_eq!(result.unwrap().id(), "user_events_topic_0_0_1");

        // Test different case
        let result = find_topic_by_name(&infra_map, "ORDEREVENTS");
        assert!(result.is_some());
        assert_eq!(result.unwrap().id(), "order_events_topic_0_0_1");

        // Test non-existent topic
        let result = find_topic_by_name(&infra_map, "NonExistent");
        assert!(result.is_none());
    }

    #[test]
    fn test_build_partition_map() {
        // Test with single partition
        let result = build_partition_map("test_topic", 1, 10);
        assert_eq!(result.len(), 1);
        let offset = result.get(&("test_topic".to_string(), 0)).unwrap();
        match offset {
            Offset::OffsetTail(n) => assert_eq!(*n, 10),
            _ => panic!("Expected OffsetTail"),
        }

        // Test with multiple partitions
        let result = build_partition_map("multi_topic", 3, 20);
        assert_eq!(result.len(), 3);
        for i in 0..3_i32 {
            let key = ("multi_topic".to_string(), i);
            assert!(result.contains_key(&key));
            match result.get(&key).unwrap() {
                Offset::OffsetTail(n) => assert_eq!(*n, 20),
                _ => panic!("Expected OffsetTail"),
            }
        }

        // Test with zero partitions (edge case)
        let result = build_partition_map("empty_topic", 0, 5);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_build_partition_map_with_different_limits() {
        // Test with minimum limit
        let result = build_partition_map("topic", 2, MIN_LIMIT);
        assert_eq!(result.len(), 2);
        let offset = result.get(&("topic".to_string(), 0)).unwrap();
        match offset {
            Offset::OffsetTail(n) => assert_eq!(*n, MIN_LIMIT as i64),
            _ => panic!("Expected OffsetTail"),
        }

        // Test with maximum limit
        let result = build_partition_map("topic", 2, MAX_LIMIT);
        assert_eq!(result.len(), 2);
        let offset = result.get(&("topic".to_string(), 0)).unwrap();
        match offset {
            Offset::OffsetTail(n) => assert_eq!(*n, MAX_LIMIT as i64),
            _ => panic!("Expected OffsetTail"),
        }
    }
}
