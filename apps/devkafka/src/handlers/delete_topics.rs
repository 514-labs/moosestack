use kafka_protocol::messages::delete_topics_response::{
    DeletableTopicResult, DeleteTopicsResponse,
};
use kafka_protocol::messages::DeleteTopicsRequest;

use crate::broker::Broker;
use crate::error;

/// Handle DeleteTopics requests, removing specified topics from the broker.
///
/// Supports both v1-5 (`topic_names` field) and v6+ (`topics` field with
/// `DeleteTopicState.name`). Clients negotiate a version via ApiVersions,
/// so only one field will be populated per request.
pub async fn handle(
    broker: &Broker,
    request: DeleteTopicsRequest,
    _api_version: i16,
) -> DeleteTopicsResponse {
    let mut response = DeleteTopicsResponse::default();
    let mut topics = broker.topics.write().await;

    // v6+ uses request.topics (with name inside DeleteTopicState).
    // v1-5 uses request.topic_names (deprecated in v6).
    // Collect all topic names from whichever field is populated.
    let names_from_topics = request.topics.iter().filter_map(|t| t.name.clone());
    let names_from_legacy = request.topic_names.iter().cloned();

    for topic in names_from_topics.chain(names_from_legacy) {
        let mut result = DeletableTopicResult::default();
        result.name = Some(topic.clone());

        if topics.remove(&topic).is_some() {
            result.error_code = 0;
            tracing::info!(topic = %topic.0, "Topic deleted");
        } else {
            result.error_code = error::UNKNOWN_TOPIC_OR_PARTITION;
        }

        response.responses.push(result);
    }

    response
}
