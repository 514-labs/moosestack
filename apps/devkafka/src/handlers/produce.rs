use kafka_protocol::messages::produce_response::{
    PartitionProduceResponse, ProduceResponse, TopicProduceResponse,
};
use kafka_protocol::messages::ProduceRequest;

use crate::broker::Broker;
use crate::storage;

pub async fn handle(
    broker: &Broker,
    request: ProduceRequest,
    _api_version: i16,
) -> ProduceResponse {
    let mut response = ProduceResponse::default();

    // acks=0 means fire-and-forget; still process but return empty response
    let acks = request.acks;

    let mut topics = broker.topics.write().await;

    for topic_data in &request.topic_data {
        let mut topic_resp = TopicProduceResponse::default();
        topic_resp.name = topic_data.name.clone();

        // Auto-create topic
        let topic_name = topic_data.name.clone();
        storage::auto_create_topic(&mut topics, topic_name.clone(), broker.default_partitions);

        for partition_data in &topic_data.partition_data {
            let mut part_resp = PartitionProduceResponse::default();
            part_resp.index = partition_data.index;

            let topic = topics.get_mut(&topic_name);
            if let Some(topic) = topic {
                if let Some(partition) = topic.partitions.get_mut(partition_data.index as usize) {
                    if let Some(ref records) = partition_data.records {
                        match partition.append(records) {
                            Ok(base_offset) => {
                                part_resp.base_offset = base_offset;
                                part_resp.error_code = 0;
                                part_resp.log_append_time_ms = -1;
                            }
                            Err(e) => {
                                part_resp.error_code = e.kafka_error_code();
                                part_resp.base_offset = -1;
                            }
                        }
                    } else {
                        part_resp.error_code = 0;
                        part_resp.base_offset = -1;
                    }
                } else {
                    part_resp.error_code = 3; // UNKNOWN_TOPIC_OR_PARTITION
                    part_resp.base_offset = -1;
                }
            } else {
                part_resp.error_code = 3;
                part_resp.base_offset = -1;
            }

            topic_resp.partition_responses.push(part_resp);
        }

        response.responses.push(topic_resp);
    }

    if acks == 0 {
        // Return empty response to signal acks=0 to connection handler
        return ProduceResponse::default();
    }

    response
}
