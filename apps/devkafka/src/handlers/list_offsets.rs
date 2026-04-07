use kafka_protocol::messages::list_offsets_response::{
    ListOffsetsPartitionResponse, ListOffsetsResponse, ListOffsetsTopicResponse,
};
use kafka_protocol::messages::ListOffsetsRequest;

use crate::broker::Broker;

pub async fn handle(
    broker: &Broker,
    request: ListOffsetsRequest,
    _api_version: i16,
) -> ListOffsetsResponse {
    let mut response = ListOffsetsResponse::default();
    let topics = broker.topics.read().await;

    for topic_req in &request.topics {
        let mut topic_resp = ListOffsetsTopicResponse::default();
        topic_resp.name = topic_req.name.clone();

        for partition_req in &topic_req.partitions {
            let mut part_resp = ListOffsetsPartitionResponse::default();
            part_resp.partition_index = partition_req.partition_index;

            if let Some(topic) = topics.get(&topic_req.name) {
                if let Some(partition) =
                    topic.partitions.get(partition_req.partition_index as usize)
                {
                    part_resp.error_code = 0;
                    match partition_req.timestamp {
                        -2 => {
                            // Earliest
                            part_resp.offset = partition.earliest_offset();
                        }
                        -1 => {
                            // Latest
                            part_resp.offset = partition.latest_offset();
                        }
                        _ => {
                            // For any other timestamp, return latest
                            part_resp.offset = partition.latest_offset();
                        }
                    }
                    part_resp.timestamp = -1;
                } else {
                    part_resp.error_code = 3; // UNKNOWN_TOPIC_OR_PARTITION
                    part_resp.offset = -1;
                }
            } else {
                part_resp.error_code = 3;
                part_resp.offset = -1;
            }

            topic_resp.partitions.push(part_resp);
        }

        response.topics.push(topic_resp);
    }

    response
}
