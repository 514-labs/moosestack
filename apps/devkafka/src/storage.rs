use std::collections::HashMap;

use bytes::{Bytes, BytesMut};
use kafka_protocol::messages::TopicName;
use tokio::sync::watch;

use crate::error::BrokerError;

/// A single Kafka record batch stored in memory with its assigned base offset.
pub struct StoredRecordBatch {
    pub base_offset: i64,
    pub record_count: i32,
    pub raw_batch: Bytes,
}

/// In-memory storage for a single partition's record batches.
pub struct PartitionState {
    pub partition_id: i32,
    pub records: Vec<StoredRecordBatch>,
    pub next_offset: i64,
    /// Watch channel for notifying consumers of new data.
    ///
    /// The sender is stored here; consumers subscribe via `data_version()`.
    /// Using `watch` instead of `Notify` ensures:
    /// - All consumers are woken (not just one, unlike `notify_one`)
    /// - Notifications between fetch and wait registration are not lost
    ///   (unlike `notify_waiters` which drops notifications with no waiters)
    pub version_tx: watch::Sender<u64>,
    version_rx: watch::Receiver<u64>,
}

impl PartitionState {
    /// Create an empty partition with no records.
    pub fn new(partition_id: i32) -> Self {
        let (version_tx, version_rx) = watch::channel(0u64);
        Self {
            partition_id,
            records: Vec::new(),
            next_offset: 0,
            version_tx,
            version_rx,
        }
    }

    /// Subscribe to data-arrival notifications for this partition.
    ///
    /// The returned receiver will see a value change each time new data is
    /// appended.  Calling `changed().await` on it will return immediately if
    /// data arrived since the receiver was created (or since the last
    /// `changed()` call), solving both the multi-consumer problem and the
    /// race between fetch and wait registration.
    pub fn data_version(&self) -> watch::Receiver<u64> {
        self.version_rx.clone()
    }

    /// Append a raw record batch, assigning the next sequential base offset.
    /// Returns the base offset of the appended batch.
    pub fn append(&mut self, raw: &Bytes) -> Result<i64, BrokerError> {
        if raw.len() < MIN_RECORD_BATCH_SIZE {
            return Err(BrokerError::InvalidRecordBatch);
        }
        let rc = &raw[BATCH_RECORD_COUNT];
        let record_count = i32::from_be_bytes([rc[0], rc[1], rc[2], rc[3]]);
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
        // Bump the version to notify all subscribed consumers.
        let _ = self.version_tx.send(self.next_offset as u64);
        Ok(base_offset)
    }

    /// Return record batches starting from `fetch_offset` up to `max_bytes`.
    pub fn fetch(&self, fetch_offset: i64, max_bytes: i32) -> Vec<&StoredRecordBatch> {
        let mut result = Vec::new();
        let mut total_bytes: i64 = 0;
        let limit = i64::from(max_bytes);
        for batch in &self.records {
            let batch_end = batch.base_offset + batch.record_count as i64;
            if batch_end <= fetch_offset {
                continue;
            }
            let batch_len = batch.raw_batch.len() as i64;
            if total_bytes > 0 && total_bytes.saturating_add(batch_len) > limit {
                break;
            }
            total_bytes = total_bytes.saturating_add(batch_len);
            result.push(batch);
            if total_bytes >= limit {
                break;
            }
        }
        result
    }

    /// The earliest available offset (always 0 since we never truncate).
    pub fn earliest_offset(&self) -> i64 {
        0
    }

    /// The next offset that will be assigned (i.e. one past the last record).
    pub fn latest_offset(&self) -> i64 {
        self.next_offset
    }
}

/// In-memory storage for a topic — a named collection of partitions.
#[allow(dead_code)]
pub struct TopicState {
    pub name: TopicName,
    pub partitions: Vec<PartitionState>,
}

impl TopicState {
    /// Create a topic with `num_partitions` empty partitions.
    pub fn new(name: TopicName, num_partitions: i32) -> Self {
        let partitions = (0..num_partitions).map(PartitionState::new).collect();
        Self { name, partitions }
    }
}

// Kafka record batch layout byte offsets.
const BATCH_BASE_OFFSET: std::ops::Range<usize> = 0..8;
const BATCH_CRC: std::ops::Range<usize> = 17..21;
const BATCH_CRC_DATA_START: usize = 21;
const BATCH_RECORD_COUNT: std::ops::Range<usize> = 57..61;
/// Minimum valid record batch size in bytes (through the record count field).
const MIN_RECORD_BATCH_SIZE: usize = 61;

fn patch_record_batch(raw: &Bytes, base_offset: i64) -> Bytes {
    let mut buf = BytesMut::from(raw.as_ref());
    buf[BATCH_BASE_OFFSET].copy_from_slice(&base_offset.to_be_bytes());
    let crc = crc32c::crc32c(&buf[BATCH_CRC_DATA_START..]);
    buf[BATCH_CRC].copy_from_slice(&crc.to_be_bytes());
    buf.freeze()
}

/// Get or auto-create a topic with `default_partitions` partitions.
pub fn auto_create_topic(
    topics: &mut HashMap<TopicName, TopicState>,
    name: TopicName,
    default_partitions: i32,
) -> &mut TopicState {
    topics
        .entry(name.clone())
        .or_insert_with(|| TopicState::new(name, default_partitions))
}
