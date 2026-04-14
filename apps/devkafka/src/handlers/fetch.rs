use std::time::Duration;

use bytes::{BufMut, BytesMut};
use kafka_protocol::messages::fetch_response::{
    FetchResponse, FetchableTopicResponse, PartitionData,
};
use kafka_protocol::messages::FetchRequest;
use tokio::sync::watch;

use crate::broker::Broker;
use crate::error;

/// Handle Fetch requests with long-polling support.
///
/// If the initial fetch returns fewer than `min_bytes`, waits up to `max_wait_ms`
/// for new data to arrive on any requested partition before re-fetching.
pub async fn handle(broker: &Broker, request: FetchRequest, _api_version: i16) -> FetchResponse {
    let max_wait_ms = request.max_wait_ms.max(0) as u64;
    let min_bytes = request.min_bytes.max(0);

    // Subscribe before the first fetch so we don't miss data produced during
    // the initial fetch. We compare future notifications against the first
    // response's high watermarks so pre-fetch notifications don't break
    // long-poll semantics.
    let mut receivers = collect_receivers(broker, &request).await;

    // First attempt to fetch
    let (response, total_bytes) = do_fetch(broker, &request).await;

    // Long polling: if we got less than min_bytes and max_wait_ms > 0, wait for data
    if total_bytes < min_bytes as i64 && max_wait_ms > 0 && !receivers.is_empty() {
        let baselines = collect_high_watermarks(&response);
        let timeout = Duration::from_millis(max_wait_ms);
        let _ =
            tokio::time::timeout(timeout, wait_any_changed_since(&mut receivers, &baselines)).await;

        // Re-fetch after wait
        let (response, _) = do_fetch(broker, &request).await;
        return response;
    }

    response
}

/// Wait until any of the watch receivers reports a change.
async fn wait_any_changed_since(receivers: &mut [watch::Receiver<u64>], baselines: &[u64]) {
    if receivers.is_empty() || receivers.len() != baselines.len() {
        return;
    }

    if receivers
        .iter()
        .zip(baselines.iter())
        .any(|(receiver, baseline)| *receiver.borrow() > *baseline)
    {
        return;
    }

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let tx = std::sync::Arc::new(tokio::sync::Mutex::new(Some(tx)));
    let mut handles = Vec::with_capacity(receivers.len());

    for (recv, baseline) in receivers.iter().cloned().zip(baselines.iter().copied()) {
        let tx = tx.clone();
        handles.push(tokio::spawn(async move {
            let mut recv = recv;
            loop {
                if *recv.borrow() > baseline {
                    break;
                }
                if recv.changed().await.is_err() {
                    return;
                }
            }
            if let Some(tx) = tx.lock().await.take() {
                let _ = tx.send(());
            }
        }));
    }

    let _ = rx.await;
    for handle in handles {
        handle.abort();
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
                        tracing::debug!(
                            topic = %topic_req.topic.0,
                            partition = partition_req.partition,
                            fetch_offset = partition_req.fetch_offset,
                            batches = batches.len(),
                            bytes = records.len(),
                            high_watermark = partition.latest_offset(),
                            "Fetch returned data"
                        );
                        part_resp.records = Some(records.freeze());
                    } else if partition_req.fetch_offset > partition.latest_offset() {
                        tracing::warn!(
                            topic = %topic_req.topic.0,
                            partition = partition_req.partition,
                            fetch_offset = partition_req.fetch_offset,
                            latest_offset = partition.latest_offset(),
                            "Fetch offset beyond end of partition (stale offset?)"
                        );
                    }
                } else {
                    part_resp.error_code = error::UNKNOWN_TOPIC_OR_PARTITION;
                    part_resp.high_watermark = -1;
                }
            } else {
                part_resp.error_code = error::UNKNOWN_TOPIC_OR_PARTITION;
                part_resp.high_watermark = -1;
            }

            topic_resp.partitions.push(part_resp);
        }

        response.responses.push(topic_resp);
    }

    (response, total_bytes)
}

async fn collect_receivers(broker: &Broker, request: &FetchRequest) -> Vec<watch::Receiver<u64>> {
    let topics = broker.topics.read().await;
    let mut receivers = Vec::new();

    for topic_req in &request.topics {
        if let Some(topic) = topics.get(&topic_req.topic) {
            for partition_req in &topic_req.partitions {
                if let Some(partition) = topic.partitions.get(partition_req.partition as usize) {
                    receivers.push(partition.data_version());
                }
            }
        }
    }

    receivers
}

fn collect_high_watermarks(response: &FetchResponse) -> Vec<u64> {
    response
        .responses
        .iter()
        .flat_map(|topic| {
            topic
                .partitions
                .iter()
                .map(|partition| partition.high_watermark.max(0) as u64)
        })
        .collect()
}
