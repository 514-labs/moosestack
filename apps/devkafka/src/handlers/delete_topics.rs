use kafka_protocol::messages::delete_topics_response::{
    DeletableTopicResult, DeleteTopicsResponse,
};
use kafka_protocol::messages::DeleteTopicsRequest;

use crate::broker::Broker;

pub async fn handle(
    broker: &Broker,
    request: DeleteTopicsRequest,
    _api_version: i16,
) -> DeleteTopicsResponse {
    let mut response = DeleteTopicsResponse::default();
    let mut topics = broker.topics.write().await;

    for topic in &request.topic_names {
        let mut result = DeletableTopicResult::default();
        result.name = Some(topic.clone());

        if topics.remove(topic).is_some() {
            result.error_code = 0;
            tracing::info!(topic = %topic.0, "Topic deleted");
        } else {
            result.error_code = 3; // UNKNOWN_TOPIC_OR_PARTITION
        }

        response.responses.push(result);
    }

    response
}
