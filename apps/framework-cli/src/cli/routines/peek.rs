//! Module for examining data in the Moose framework.
//!
//! This module provides functionality to retrieve and display sample data from
//! either database tables or streaming topics for debugging and exploration purposes.

use crate::cli::display::Message;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::olap::clickhouse::mapper::std_table_to_clickhouse_table;
use crate::infrastructure::olap::clickhouse_alt_client::{get_pool, select_some_as_json};
use crate::project::Project;

use super::{setup_redis_client, RoutineFailure, RoutineSuccess};

use crate::infrastructure::olap::clickhouse::model::ClickHouseTable;
use crate::infrastructure::stream::kafka::client::create_consumer;
use futures::stream::BoxStream;
use log::info;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::{Message as KafkaMessage, Offset, TopicPartitionList};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio_stream::StreamExt;

/// Retrieves and displays a sample of data from either a database table or streaming topic.
///
/// Allows users to examine the actual data contents of resources in the Moose framework
/// by querying either the ClickHouse database tables or Redpanda streaming topics.
/// Results can be displayed to the console or written to a file.
///
/// # Arguments
///
/// * `project` - The project configuration to use
/// * `name` - Name of the table or stream to peek
/// * `limit` - Maximum number of records to retrieve
/// * `file` - Optional file path to save the output instead of displaying to console
/// * `is_stream` - Whether to peek at a stream/topic (true) or a table (false)
///
/// # Returns
///
/// * `Result<RoutineSuccess, RoutineFailure>` - Success or failure of the operation
pub async fn peek(
    project: Arc<Project>,
    name: &str,
    limit: u8,
    file: Option<PathBuf>,
    is_stream: bool,
) -> Result<RoutineSuccess, RoutineFailure> {
    let pool = get_pool(&project.clickhouse_config);
    let mut client = pool.get_handle().await.map_err(|_| {
        RoutineFailure::error(Message::new(
            "Failed".to_string(),
            "Error connecting to storage".to_string(),
        ))
    })?;

    let redis_client = setup_redis_client(project.clone()).await.map_err(|e| {
        RoutineFailure::error(Message {
            action: "Prod".to_string(),
            details: format!("Failed to setup redis client: {e:?}"),
        })
    })?;

    let infra = InfrastructureMap::load_from_redis(&redis_client)
        .await
        .map_err(|_| {
            RoutineFailure::error(Message::new(
                "Failed".to_string(),
                "Error retrieving current state".to_string(),
            ))
        })?
        .ok_or_else(|| {
            RoutineFailure::error(Message::new(
                "Failed".to_string(),
                "No state found".to_string(),
            ))
        })?;

    let consumer_ref: StreamConsumer;
    let table_ref: ClickHouseTable;

    let mut stream: BoxStream<anyhow::Result<Value>> = if is_stream {
        let group_id = project.redpanda_config.prefix_with_namespace("peek");

        consumer_ref = create_consumer(&project.redpanda_config, &[("group.id", &group_id)]);
        let consumer = &consumer_ref;

        let topic = infra
            .topics
            .iter()
            .find_map(|(key, topic)| {
                if key.to_lowercase() == name.to_lowercase() {
                    Some(topic)
                } else {
                    None
                }
            })
            .ok_or_else(|| {
                RoutineFailure::error(Message::new(
                    "Failed".to_string(),
                    "No matching topic found".to_string(),
                ))
            })?;
        let topic_partition_map = (0..topic.partition_count)
            .map(|partition| {
                (
                    (topic.id().clone(), partition as i32),
                    Offset::OffsetTail(limit as i64),
                )
            })
            .collect();

        info!("Peek topic_partition_map {:?}", topic_partition_map);
        TopicPartitionList::from_topic_map(&topic_partition_map)
            .and_then(|tpl| consumer.assign(&tpl))
            .map_err(|e| {
                RoutineFailure::new(
                    Message::new("Failed".to_string(), "Topic metadata fetch".to_string()),
                    e,
                )
            })?;

        Box::pin(
            consumer
                .stream()
                .map(|message| {
                    Ok(serde_json::from_slice::<Value>(
                        message?.payload().unwrap_or(&[]),
                    )?)
                })
                .take(limit.into())
                // ends the stream if the next message takes 1 second
                // i.e. the kafka queue has less than `limit` records
                .timeout(Duration::from_secs(1))
                .take_while(Result::is_ok)
                .map(Result::unwrap),
        )
    } else {
        let table = infra
            .tables
            .iter()
            .find_map(|(key, table)| {
                if key.to_lowercase() == name.to_lowercase() {
                    Some(table)
                } else {
                    None
                }
            })
            .ok_or_else(|| {
                RoutineFailure::error(Message::new(
                    "Failed".to_string(),
                    "No matching table found".to_string(),
                ))
            })?;

        table_ref = std_table_to_clickhouse_table(table).map_err(|_| {
            RoutineFailure::error(Message::new(
                "Failed".to_string(),
                "Error fetching table".to_string(),
            ))
        })?;

        Box::pin(
            select_some_as_json(
                &project.clickhouse_config.db_name,
                &table_ref,
                &mut client,
                limit as i64,
            )
            .await
            .map_err(|_| {
                RoutineFailure::error(Message::new(
                    "Failed".to_string(),
                    "Error selecting data".to_string(),
                ))
            })?
            .map(|result| anyhow::Ok(result?)),
        )
    };

    let mut success_count = 0;

    let (mut file, success_message): (Option<File>, Box<dyn Fn(i32) -> String>) =
        if let Some(file_path) = file {
            (
                Some(File::create(&file_path).await.map_err(|_| {
                    RoutineFailure::error(Message::new(
                        "Failed".to_string(),
                        "Error creating file".to_string(),
                    ))
                })?),
                Box::new(move |success_count| {
                    format!("{success_count} rows written to {file_path:?}")
                }),
            )
        } else {
            (
                None,
                Box::new(|success_count| {
                    // Just a newline for output cleanliness
                    println!();
                    format!("{success_count} rows")
                }),
            )
        };

    while let Some(result) = stream.next().await {
        match result {
            Ok(value) => {
                let json = serde_json::to_string(&value).unwrap();
                match &mut file {
                    None => {
                        println!("{json}");
                        info!("{}", json);
                    }
                    Some(ref mut file) => {
                        file.write_all(format!("{json}\n").as_bytes())
                            .await
                            .map_err(|_| {
                                RoutineFailure::error(Message::new(
                                    "Failed".to_string(),
                                    "Error writing to file".to_string(),
                                ))
                            })?;
                    }
                }
                success_count += 1;
            }
            Err(e) => {
                log::error!("Failed to read row {}", e);
            }
        }
    }

    Ok(RoutineSuccess::success(Message::new(
        "Peeked".to_string(),
        success_message(success_count),
    )))
}
