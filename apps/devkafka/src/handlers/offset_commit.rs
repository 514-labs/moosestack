use kafka_protocol::messages::offset_commit_response::{
    OffsetCommitResponse, OffsetCommitResponsePartition, OffsetCommitResponseTopic,
};
use kafka_protocol::messages::OffsetCommitRequest;

use crate::broker::Broker;
use crate::groups::OffsetKey;

pub async fn handle(
    broker: &Broker,
    request: OffsetCommitRequest,
    _api_version: i16,
) -> OffsetCommitResponse {
    let mut response = OffsetCommitResponse::default();
    let mut coordinator = broker.groups.write().await;

    for topic in &request.topics {
        let mut topic_resp = OffsetCommitResponseTopic::default();
        topic_resp.name = topic.name.clone();

        for partition in &topic.partitions {
            let mut part_resp = OffsetCommitResponsePartition::default();
            part_resp.partition_index = partition.partition_index;

            let key = OffsetKey {
                group_id: request.group_id.clone(),
                topic: topic.name.clone(),
                partition: partition.partition_index,
            };
            coordinator
                .committed_offsets
                .insert(key, partition.committed_offset);
            part_resp.error_code = 0;

            topic_resp.partitions.push(part_resp);
        }

        response.topics.push(topic_resp);
    }

    response
}
