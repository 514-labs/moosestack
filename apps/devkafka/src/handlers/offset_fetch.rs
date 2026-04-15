use kafka_protocol::messages::offset_fetch_response::{
    OffsetFetchResponse, OffsetFetchResponseGroup, OffsetFetchResponsePartition,
    OffsetFetchResponsePartitions, OffsetFetchResponseTopic, OffsetFetchResponseTopics,
};
use kafka_protocol::messages::OffsetFetchRequest;
use kafka_protocol::protocol::StrBytes;

use crate::broker::Broker;
use crate::groups::OffsetKey;

/// Handle OffsetFetch requests, returning committed offsets for consumer group partitions.
///
/// Versions 1-7 use `group_id` + `topics` in both request and response.
/// Version 8+ uses `groups[]` which batches multiple groups per request and
/// nests topics/partitions inside each group in the response.
pub async fn handle(
    broker: &Broker,
    request: OffsetFetchRequest,
    api_version: i16,
) -> OffsetFetchResponse {
    let mut response = OffsetFetchResponse::default();
    let coordinator = broker.groups.read().await;

    if api_version >= 8 {
        // v8+ groups-based format
        for group_req in &request.groups {
            let mut group_resp = OffsetFetchResponseGroup::default();
            group_resp.group_id = group_req.group_id.clone();

            let empty = vec![];
            let topics = group_req.topics.as_deref().unwrap_or(&empty);

            for topic in topics {
                let mut topic_resp = OffsetFetchResponseTopics::default();
                topic_resp.name = topic.name.clone();

                for &partition_index in &topic.partition_indexes {
                    let mut part_resp = OffsetFetchResponsePartitions::default();
                    part_resp.partition_index = partition_index;

                    let key = OffsetKey {
                        group_id: group_req.group_id.clone(),
                        topic: topic.name.clone(),
                        partition: partition_index,
                    };

                    part_resp.committed_offset = coordinator
                        .committed_offsets
                        .get(&key)
                        .copied()
                        .unwrap_or(-1);
                    part_resp.metadata = Some(StrBytes::from_static_str(""));

                    topic_resp.partitions.push(part_resp);
                }

                group_resp.topics.push(topic_resp);
            }

            response.groups.push(group_resp);
        }
    } else {
        // v1-7 topic-based format
        response.error_code = 0;

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
    }

    response
}
