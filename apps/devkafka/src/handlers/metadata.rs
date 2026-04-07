use kafka_protocol::messages::metadata_response::{
    MetadataResponse, MetadataResponseBroker, MetadataResponsePartition, MetadataResponseTopic,
};
use kafka_protocol::messages::{MetadataRequest, TopicName};
use kafka_protocol::protocol::StrBytes;

use crate::broker::Broker;
use crate::storage;

pub async fn handle(
    broker: &Broker,
    request: MetadataRequest,
    _api_version: i16,
) -> MetadataResponse {
    let mut response = MetadataResponse::default();

    let mut broker_info = MetadataResponseBroker::default();
    broker_info.node_id = broker.node_id.into();
    broker_info.host = StrBytes::from_string(broker.advertised_host.clone());
    broker_info.port = broker.port;
    response.brokers.push(broker_info);

    response.controller_id = broker.node_id.into();
    response.cluster_id = Some(StrBytes::from_string(broker.cluster_id.clone()));

    let mut topics = broker.topics.write().await;

    let topic_names: Vec<TopicName> = if let Some(ref requested_topics) = request.topics {
        if requested_topics.is_empty() {
            topics.keys().cloned().collect()
        } else {
            let names: Vec<TopicName> = requested_topics
                .iter()
                .filter_map(|t| t.name.clone())
                .collect();

            if request.allow_auto_topic_creation {
                for name in &names {
                    if !name.0.is_empty() {
                        storage::auto_create_topic(
                            &mut topics,
                            name.clone(),
                            broker.default_partitions,
                        );
                    }
                }
            }

            names
        }
    } else {
        topics.keys().cloned().collect()
    };

    for topic_name in &topic_names {
        let mut topic_resp = MetadataResponseTopic::default();
        topic_resp.name = Some(topic_name.clone());

        if let Some(topic_state) = topics.get(topic_name) {
            topic_resp.error_code = 0;
            for partition in &topic_state.partitions {
                let mut part_resp = MetadataResponsePartition::default();
                part_resp.partition_index = partition.partition_id;
                part_resp.leader_id = broker.node_id.into();
                part_resp.replica_nodes = vec![broker.node_id.into()];
                part_resp.isr_nodes = vec![broker.node_id.into()];
                part_resp.error_code = 0;
                topic_resp.partitions.push(part_resp);
            }
        } else {
            topic_resp.error_code = 3; // UNKNOWN_TOPIC_OR_PARTITION
        }

        response.topics.push(topic_resp);
    }

    response
}
