//! Module for examining data in the Moose framework.
//!
//! This module provides functionality to retrieve and display sample data from
//! either database tables or streaming topics for debugging and exploration purposes.

use crate::cli::display::Message;
use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure::topic::Topic;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::olap::clickhouse::mapper::std_table_to_clickhouse_table;
use crate::infrastructure::olap::clickhouse_http_client::create_query_client;
use crate::project::Project;

use super::{setup_redis_client, RoutineFailure, RoutineSuccess};

use crate::infrastructure::olap::clickhouse::model::ClickHouseTable;
use crate::infrastructure::stream::kafka::client::create_consumer;
use futures::stream::BoxStream;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::{Message as KafkaMessage, Offset, TopicPartitionList};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio_stream::StreamExt;
use tracing::info;

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
    // Get HTTP-based ClickHouse client
    let client = create_query_client(&project.clickhouse_config);

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

        let topic = find_topic_by_name(&infra, name).ok_or_else(|| {
            let available_topics: Vec<String> =
                infra.topics.values().map(|t| t.name.clone()).collect();
            RoutineFailure::error(Message::new(
                "Failed".to_string(),
                format!(
                    "No matching topic found: '{}'. Available topics: {}",
                    name,
                    available_topics.join(", ")
                ),
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
        let table = find_table_by_name(&infra, name).ok_or_else(|| {
            let available_tables: Vec<String> =
                infra.tables.values().map(|t| t.name.clone()).collect();
            RoutineFailure::error(Message::new(
                "Failed".to_string(),
                format!(
                    "No matching table found: '{}'. Available tables: {}",
                    name,
                    available_tables.join(", ")
                ),
            ))
        })?;

        table_ref = std_table_to_clickhouse_table(table).map_err(|_| {
            RoutineFailure::error(Message::new(
                "Failed".to_string(),
                "Error fetching table".to_string(),
            ))
        })?;

        // Build the SELECT query
        let order_by = match &table_ref.order_by {
            crate::framework::core::infrastructure::table::OrderBy::Fields(fields)
                if !fields.is_empty() =>
            {
                format!(
                    "ORDER BY {}",
                    crate::infrastructure::olap::clickhouse::model::wrap_and_join_column_names(
                        fields, ", "
                    )
                )
            }
            crate::framework::core::infrastructure::table::OrderBy::SingleExpr(expr) => {
                format!("ORDER BY {expr}")
            }
            _ => {
                // Fall back to primary key
                let key_columns: Vec<String> = table_ref
                    .primary_key_columns()
                    .iter()
                    .map(|s| s.to_string())
                    .collect();

                if key_columns.is_empty() {
                    "".to_string()
                } else {
                    format!(
                        "ORDER BY {}",
                        crate::infrastructure::olap::clickhouse::model::wrap_and_join_column_names(
                            &key_columns,
                            ", "
                        )
                    )
                }
            }
        };

        // Respect explicit table database, fallback to project default
        let database = table
            .database
            .as_deref()
            .unwrap_or(&project.clickhouse_config.db_name);
        let query = format!(
            "SELECT * FROM \"{}\".\"{}\" {} LIMIT {}",
            database, table_ref.name, order_by, limit
        );

        info!("Peek query: {}", query);

        // Execute query
        let rows = crate::infrastructure::olap::clickhouse_http_client::query_as_json_stream(
            &client, &query,
        )
        .await
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Peek".to_string(),
                format!("ClickHouse query error: {}", e),
            ))
        })?;

        // Convert Vec to stream
        Box::pin(tokio_stream::iter(rows.into_iter().map(anyhow::Ok)))
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
                tracing::error!("Failed to read row {}", e);
            }
        }
    }

    Ok(RoutineSuccess::success(Message::new(
        "Peeked".to_string(),
        success_message(success_count),
    )))
}

/// Finds a table in the infrastructure map by name (case-insensitive).
///
/// # Arguments
///
/// * `infra` - The infrastructure map to search
/// * `name` - The table name to find
///
/// # Returns
///
/// * `Option<&Table>` - The found table, or None if not found
fn find_table_by_name<'a>(infra: &'a InfrastructureMap, name: &str) -> Option<&'a Table> {
    infra
        .tables
        .values()
        .find(|table| table.name.eq_ignore_ascii_case(name))
}

/// Finds a topic in the infrastructure map by name (case-insensitive).
///
/// # Arguments
///
/// * `infra` - The infrastructure map to search
/// * `name` - The topic name to find
///
/// # Returns
///
/// * `Option<&Topic>` - The found topic, or None if not found
fn find_topic_by_name<'a>(infra: &'a InfrastructureMap, name: &str) -> Option<&'a Topic> {
    infra
        .topics
        .values()
        .find(|topic| topic.name.eq_ignore_ascii_case(name))
}

#[cfg(test)]
mod tests {
    use super::{find_table_by_name, find_topic_by_name};
    use crate::framework::core::infrastructure::table::Table;
    use crate::framework::core::infrastructure::topic::Topic;
    use crate::framework::core::infrastructure_map::InfrastructureMap;
    use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;
    use std::collections::HashMap;
    use std::time::Duration;

    fn create_test_table(name: &str, database: Option<String>) -> Table {
        Table {
            name: name.to_string(),
            database,
            columns: vec![],
            order_by: crate::framework::core::infrastructure::table::OrderBy::Fields(vec![]),
            partition_by: None,
            sample_by: None,
            version: None,
            engine: ClickhouseEngine::MergeTree,
            source_primitive: crate::framework::core::infrastructure_map::PrimitiveSignature {
                name: name.to_string(),
                primitive_type:
                    crate::framework::core::infrastructure_map::PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: crate::framework::core::partial_infrastructure_map::LifeCycle::FullyManaged,
            engine_params_hash: None,
            table_settings_hash: None,
            table_settings: None,
            indexes: vec![],
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
        }
    }

    fn create_test_topic(
        name: &str,
        version: Option<crate::framework::versions::Version>,
    ) -> Topic {
        Topic {
            name: name.to_string(),
            version,
            retention_period: Duration::from_secs(3600),
            partition_count: 1,
            max_message_bytes: 1024,
            columns: vec![],
            source_primitive: crate::framework::core::infrastructure_map::PrimitiveSignature {
                name: name.to_string(),
                primitive_type:
                    crate::framework::core::infrastructure_map::PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: crate::framework::core::partial_infrastructure_map::LifeCycle::FullyManaged,
            schema_config: None,
        }
    }

    fn create_test_infra() -> InfrastructureMap {
        let mut tables = HashMap::new();
        let mut topics = HashMap::new();

        // Add tables with table IDs as keys (simulating real inframap)
        let table1 = create_test_table("users", None);
        let table2 = create_test_table("orders", None);
        let table3 = create_test_table("analytics", Some("warehouse".to_string()));

        tables.insert("local_users".to_string(), table1);
        tables.insert("local_orders".to_string(), table2);
        tables.insert("warehouse_analytics".to_string(), table3);

        // Add topics with topic IDs as keys (simulating real inframap)
        // Topics get versioned IDs like "events_0_0_1" but names are just "events"
        let topic1 = create_test_topic(
            "events",
            Some(crate::framework::versions::Version::from_string(
                "0.0.1".to_string(),
            )),
        );
        let topic2 = create_test_topic(
            "logs",
            Some(crate::framework::versions::Version::from_string(
                "0.0.1".to_string(),
            )),
        );

        // Use topic.id() as key to simulate real inframap (key != name)
        topics.insert(topic1.id(), topic1);
        topics.insert(topic2.id(), topic2);

        InfrastructureMap {
            default_database: "local".to_string(),
            tables,
            topics,
            api_endpoints: HashMap::new(),
            dmv1_views: HashMap::new(),
            topic_to_table_sync_processes: HashMap::new(),
            topic_to_topic_sync_processes: HashMap::new(),
            function_processes: HashMap::new(),
            block_db_processes: crate::framework::core::infrastructure::olap_process::OlapProcess {},
            consumption_api_web_server: crate::framework::core::infrastructure::consumption_webserver::ConsumptionApiWebServer {},
            orchestration_workers: HashMap::new(),
            sql_resources: HashMap::new(),
            workflows: HashMap::new(),
            web_apps: HashMap::new(),
            materialized_views: HashMap::new(),
            views: HashMap::new(),
        }
    }

    #[test]
    fn test_table_lookup_by_name() {
        let infra = create_test_infra();

        // Should find table by name, not by HashMap key
        let table = find_table_by_name(&infra, "users");

        assert!(table.is_some(), "Should find table 'users'");
        assert_eq!(table.unwrap().name, "users");
    }

    #[test]
    fn test_table_lookup_case_insensitive() {
        let infra = create_test_infra();

        // Should find table regardless of case
        let table = find_table_by_name(&infra, "USERS");

        assert!(
            table.is_some(),
            "Should find table with case-insensitive match"
        );
        assert_eq!(table.unwrap().name, "users");
    }

    #[test]
    fn test_table_lookup_with_explicit_database() {
        let infra = create_test_infra();

        // Should find table with explicit database
        let table = find_table_by_name(&infra, "analytics");

        assert!(table.is_some(), "Should find table 'analytics'");
        let found_table = table.unwrap();
        assert_eq!(found_table.name, "analytics");
        assert_eq!(found_table.database, Some("warehouse".to_string()));
    }

    #[test]
    fn test_table_not_found() {
        let infra = create_test_infra();

        // Should not find non-existent table
        let table = find_table_by_name(&infra, "nonexistent");

        assert!(table.is_none(), "Should not find non-existent table");
    }

    #[test]
    fn test_available_tables_list() {
        let infra = create_test_infra();

        // Should be able to list all available tables
        let available_tables: Vec<String> = infra.tables.values().map(|t| t.name.clone()).collect();

        assert_eq!(available_tables.len(), 3);
        assert!(available_tables.contains(&"users".to_string()));
        assert!(available_tables.contains(&"orders".to_string()));
        assert!(available_tables.contains(&"analytics".to_string()));
    }

    #[test]
    fn test_topic_lookup_by_name() {
        let infra = create_test_infra();

        // Should find topic by name, not by HashMap key
        let topic = find_topic_by_name(&infra, "events");

        assert!(topic.is_some(), "Should find topic 'events'");
        assert_eq!(topic.unwrap().name, "events");
    }

    #[test]
    fn test_topic_lookup_case_insensitive() {
        let infra = create_test_infra();

        // Should find topic regardless of case
        let topic = find_topic_by_name(&infra, "LOGS");

        assert!(
            topic.is_some(),
            "Should find topic with case-insensitive match"
        );
        assert_eq!(topic.unwrap().name, "logs");
    }

    #[test]
    fn test_database_resolution_with_explicit_database() {
        let table = create_test_table("analytics", Some("warehouse".to_string()));
        let default_db = "local";

        let database = table.database.as_deref().unwrap_or(default_db);

        assert_eq!(
            database, "warehouse",
            "Should use table's explicit database"
        );
    }

    #[test]
    fn test_database_resolution_with_default() {
        let table = create_test_table("users", None);
        let default_db = "local";

        let database = table.database.as_deref().unwrap_or(default_db);

        assert_eq!(
            database, "local",
            "Should use default database when table.database is None"
        );
    }
}
