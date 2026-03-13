use std::collections::HashMap;
use std::sync::Arc;

use bytes::{Bytes, BytesMut};
use kafka_protocol::messages::TopicName;
use tokio::sync::Notify;

use crate::error::BrokerError;

pub struct StoredRecordBatch {
    pub base_offset: i64,
    pub record_count: i32,
    pub raw_batch: Bytes,
}

pub struct PartitionState {
    pub partition_id: i32,
    pub records: Vec<StoredRecordBatch>,
    pub next_offset: i64,
    pub notify: Arc<Notify>,
}

impl PartitionState {
    pub fn new(partition_id: i32) -> Self {
        Self {
            partition_id,
            records: Vec::new(),
            next_offset: 0,
            notify: Arc::new(Notify::new()),
        }
    }

    pub fn append(&mut self, raw: &Bytes) -> Result<i64, BrokerError> {
        if raw.len() < 61 {
            return Err(BrokerError::InvalidRecordBatch);
        }
        let record_count = i32::from_be_bytes([raw[57], raw[58], raw[59], raw[60]]);
        if record_count <= 0 {
            return Err(BrokerError::InvalidRecordBatch);
        }
        let base_offset = self.next_offset;
        let patched = patch_record_batch(raw, base_offset);
        self.records.push(StoredRecordBatch {
            base_offset,
            record_count,
            raw_batch: patched,
        });
        self.next_offset += record_count as i64;
        self.notify.notify_waiters();
        Ok(base_offset)
    }

    pub fn fetch(&self, fetch_offset: i64, max_bytes: i32) -> Vec<&StoredRecordBatch> {
        let mut result = Vec::new();
        let mut total_bytes = 0i32;
        for batch in &self.records {
            let batch_end = batch.base_offset + batch.record_count as i64;
            if batch_end <= fetch_offset {
                continue;
            }
            if total_bytes > 0 && total_bytes + batch.raw_batch.len() as i32 > max_bytes {
                break;
            }
            total_bytes += batch.raw_batch.len() as i32;
            result.push(batch);
            if total_bytes >= max_bytes {
                break;
            }
        }
        result
    }

    pub fn earliest_offset(&self) -> i64 {
        0
    }

    pub fn latest_offset(&self) -> i64 {
        self.next_offset
    }
}

#[allow(dead_code)]
pub struct TopicState {
    pub name: TopicName,
    pub partitions: Vec<PartitionState>,
}

impl TopicState {
    pub fn new(name: TopicName, num_partitions: i32) -> Self {
        let partitions = (0..num_partitions).map(PartitionState::new).collect();
        Self { name, partitions }
    }
}

fn patch_record_batch(raw: &Bytes, base_offset: i64) -> Bytes {
    let mut buf = BytesMut::from(raw.as_ref());
    buf[0..8].copy_from_slice(&base_offset.to_be_bytes());
    let crc = crc32c::crc32c(&buf[21..]);
    buf[17..21].copy_from_slice(&crc.to_be_bytes());
    buf.freeze()
}

pub fn auto_create_topic(
    topics: &mut HashMap<TopicName, TopicState>,
    name: TopicName,
    default_partitions: i32,
) -> &mut TopicState {
    topics
        .entry(name.clone())
        .or_insert_with(|| TopicState::new(name, default_partitions))
}
