use kafka_protocol::messages::offset_fetch_response::{
    OffsetFetchResponse, OffsetFetchResponsePartition, OffsetFetchResponseTopic,
};
use kafka_protocol::messages::OffsetFetchRequest;
use kafka_protocol::protocol::StrBytes;

use crate::broker::Broker;
use crate::groups::OffsetKey;

/// Handle OffsetFetch requests, returning committed offsets for consumer group partitions.
pub async fn handle(
    broker: &Broker,
    request: OffsetFetchRequest,
    _api_version: i16,
) -> OffsetFetchResponse {
    let mut response = OffsetFetchResponse::default();
    response.error_code = 0;
    let coordinator = broker.groups.read().await;

    let empty = vec![];
    let topics = request.topics.as_deref().unwrap_or(&empty);

    for topic in topics {
        let mut topic_resp = OffsetFetchResponseTopic::default();
        topic_resp.name = topic.name.clone();

        for &partition_index in &topic.partition_indexes {
            let mut part_resp = OffsetFetchResponsePartition::default();
            part_resp.partition_index = partition_index;

            let key = OffsetKey {
                group_id: request.group_id.clone(),
                topic: topic.name.clone(),
                partition: partition_index,
            };

            part_resp.committed_offset = coordinator
                .committed_offsets
                .get(&key)
                .copied()
                .unwrap_or(-1);
            part_resp.error_code = 0;
            part_resp.metadata = Some(StrBytes::from_static_str(""));

            topic_resp.partitions.push(part_resp);
        }

        response.topics.push(topic_resp);
    }

    response
}
