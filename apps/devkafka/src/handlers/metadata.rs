use kafka_protocol::messages::metadata_response::{
    MetadataResponse, MetadataResponseBroker, MetadataResponsePartition, MetadataResponseTopic,
};
use kafka_protocol::messages::{MetadataRequest, TopicName};
use kafka_protocol::protocol::StrBytes;

use crate::broker::Broker;
use crate::error;
use crate::storage;

/// Handle Metadata requests, returning broker and topic/partition information.
/// Auto-creates topics when `allow_auto_topic_creation` is set and specific topics are requested.
pub async fn handle(
    broker: &Broker,
    request: MetadataRequest,
    _api_version: i16,
) -> MetadataResponse {
    let mut response = MetadataResponse::default();

    let mut broker_info = MetadataResponseBroker::default();
    broker_info.node_id = broker.node_id.into();
    broker_info.host = StrBytes::from_string(broker.advertised_host.clone());
    broker_info.port = broker.port as i32;
    response.brokers.push(broker_info);

    response.controller_id = broker.node_id.into();
    response.cluster_id = Some(StrBytes::from_string(broker.cluster_id.clone()));

    // Determine if we need a write lock (auto-create) or read lock suffices.
    let needs_auto_create =
        request.allow_auto_topic_creation && request.topics.as_ref().is_some_and(|t| !t.is_empty());

    if needs_auto_create {
        let mut topics = broker.topics.write().await;
        let names: Vec<TopicName> = request
            .topics
            .as_ref()
            .unwrap()
            .iter()
            .filter_map(|t| t.name.clone())
            .collect();

        for name in &names {
            if !name.0.is_empty() {
                storage::auto_create_topic(&mut topics, name.clone(), broker.default_partitions);
            }
        }

        build_topic_response(&mut response, &topics, &names, broker);
    } else {
        let topics = broker.topics.read().await;
        let topic_names: Vec<TopicName> = if let Some(ref requested_topics) = request.topics {
            if requested_topics.is_empty() {
                topics.keys().cloned().collect()
            } else {
                requested_topics
                    .iter()
                    .filter_map(|t| t.name.clone())
                    .collect()
            }
        } else {
            topics.keys().cloned().collect()
        };

        build_topic_response(&mut response, &topics, &topic_names, broker);
    }

    response
}

fn build_topic_response(
    response: &mut MetadataResponse,
    topics: &std::collections::HashMap<TopicName, crate::storage::TopicState>,
    topic_names: &[TopicName],
    broker: &Broker,
) {
    for topic_name in topic_names {
        let mut topic_resp = MetadataResponseTopic::default();
        topic_resp.name = Some(topic_name.clone());

        if let Some(topic_state) = topics.get(topic_name) {
            topic_resp.error_code = error::NONE;
            for partition in &topic_state.partitions {
                let mut part_resp = MetadataResponsePartition::default();
                part_resp.partition_index = partition.partition_id;
                part_resp.leader_id = broker.node_id.into();
                part_resp.replica_nodes = vec![broker.node_id.into()];
                part_resp.isr_nodes = vec![broker.node_id.into()];
                part_resp.error_code = error::NONE;
                topic_resp.partitions.push(part_resp);
            }
        } else {
            topic_resp.error_code = error::UNKNOWN_TOPIC_OR_PARTITION;
        }

        response.topics.push(topic_resp);
    }
}
