use kafka_protocol::messages::create_topics_response::{
    CreatableTopicResult, CreateTopicsResponse,
};
use kafka_protocol::messages::CreateTopicsRequest;

use crate::broker::Broker;
use crate::storage::TopicState;

pub async fn handle(
    broker: &Broker,
    request: CreateTopicsRequest,
    _api_version: i16,
) -> CreateTopicsResponse {
    let mut response = CreateTopicsResponse::default();
    let mut topics = broker.topics.write().await;

    for topic_req in &request.topics {
        let mut result = CreatableTopicResult::default();
        result.name = topic_req.name.clone();

        let num_partitions = if topic_req.num_partitions <= 0 {
            broker.default_partitions
        } else {
            topic_req.num_partitions
        };

        if topics.contains_key(&topic_req.name) {
            result.error_code = 36; // TOPIC_ALREADY_EXISTS
            result.error_message = Some(kafka_protocol::protocol::StrBytes::from_static_str(
                "Topic already exists",
            ));
        } else {
            topics.insert(
                topic_req.name.clone(),
                TopicState::new(topic_req.name.clone(), num_partitions),
            );
            result.error_code = 0;
            result.num_partitions = num_partitions;
            result.replication_factor = 1;
            tracing::info!(topic = %topic_req.name.0, partitions = num_partitions, "Topic created");
        }

        response.topics.push(result);
    }

    response
}
