use std::sync::Arc;
use std::time::Duration;

use bytes::{BufMut, BytesMut};
use kafka_protocol::messages::fetch_response::{
    FetchResponse, FetchableTopicResponse, PartitionData,
};
use kafka_protocol::messages::FetchRequest;
use tokio::sync::Notify;

use crate::broker::Broker;

pub async fn handle(broker: &Broker, request: FetchRequest, _api_version: i16) -> FetchResponse {
    let max_wait_ms = request.max_wait_ms.max(0) as u64;
    let min_bytes = request.min_bytes.max(0);

    // First attempt to fetch
    let (response, total_bytes) = do_fetch(broker, &request).await;

    // Long polling: if we got less than min_bytes and max_wait_ms > 0, wait for data
    if total_bytes < min_bytes as i64 && max_wait_ms > 0 {
        let notifies = collect_notifies(broker, &request).await;

        if !notifies.is_empty() {
            let timeout = Duration::from_millis(max_wait_ms);
            let _ = tokio::time::timeout(timeout, wait_any_notify(&notifies)).await;

            // Re-fetch after wait
            let (response, _) = do_fetch(broker, &request).await;
            return response;
        }
    }

    response
}

async fn wait_any_notify(notifies: &[Arc<Notify>]) {
    // Use tokio::select! to wait on up to a few notifies.
    // For simplicity in dev usage, wait on all of them via a spawned approach.
    if notifies.is_empty() {
        return;
    }

    // Create a shared notify that fires when any partition gets data
    let combined = Arc::new(Notify::new());
    let mut handles = Vec::new();

    for notify in notifies {
        let n = notify.clone();
        let c = combined.clone();
        handles.push(tokio::spawn(async move {
            n.notified().await;
            c.notify_one();
        }));
    }

    combined.notified().await;

    // Abort remaining tasks
    for h in handles {
        h.abort();
    }
}

async fn do_fetch(broker: &Broker, request: &FetchRequest) -> (FetchResponse, i64) {
    let mut response = FetchResponse::default();
    let topics = broker.topics.read().await;
    let mut total_bytes: i64 = 0;

    for topic_req in &request.topics {
        let mut topic_resp = FetchableTopicResponse::default();
        topic_resp.topic = topic_req.topic.clone();

        for partition_req in &topic_req.partitions {
            let mut part_resp = PartitionData::default();
            part_resp.partition_index = partition_req.partition;

            let max_bytes = partition_req.partition_max_bytes.max(0);

            if let Some(topic) = topics.get(&topic_req.topic) {
                if let Some(partition) = topic.partitions.get(partition_req.partition as usize) {
                    part_resp.error_code = 0;
                    part_resp.high_watermark = partition.latest_offset();
                    part_resp.last_stable_offset = partition.latest_offset();
                    part_resp.log_start_offset = partition.earliest_offset();

                    let batches = partition.fetch(partition_req.fetch_offset, max_bytes);

                    let mut records = BytesMut::new();
                    for batch in &batches {
                        records.put(batch.raw_batch.clone());
                        total_bytes += batch.raw_batch.len() as i64;
                    }
                    if !records.is_empty() {
                        part_resp.records = Some(records.freeze());
                    }
                } else {
                    part_resp.error_code = 3;
                    part_resp.high_watermark = -1;
                }
            } else {
                part_resp.error_code = 3;
                part_resp.high_watermark = -1;
            }

            topic_resp.partitions.push(part_resp);
        }

        response.responses.push(topic_resp);
    }

    (response, total_bytes)
}

async fn collect_notifies(broker: &Broker, request: &FetchRequest) -> Vec<Arc<Notify>> {
    let topics = broker.topics.read().await;
    let mut notifies = Vec::new();

    for topic_req in &request.topics {
        if let Some(topic) = topics.get(&topic_req.topic) {
            for partition_req in &topic_req.partitions {
                if let Some(partition) = topic.partitions.get(partition_req.partition as usize) {
                    notifies.push(partition.notify.clone());
                }
            }
        }
    }

    notifies
}
