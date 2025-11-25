//! # ClickHouse Batch Inserter
//!
//! This module provides functionality for batched inserts into ClickHouse tables.
//! It handles:
//!
//! - Batching records for efficient insertion
//! - Tracking Kafka partition offsets for each batch
//! - Committing offsets after successful inserts
//! - Handling transient failures during insertion
//!
//! The primary components are:
//!
//! - `Batch`: Represents a collection of records to be inserted together
//! - `Inserter`: Manages batches and handles the insertion process
//!
//! ## Usage Example
//!
//! ```rust
//! use crate::infrastructure::olap::clickhouse::inserter::Inserter;
//! use crate::infrastructure::olap::clickhouse::client::ClickHouseClient;
//! use crate::infrastructure::olap::clickhouse::model::ClickHouseRecord;
//!
//! // Create a ClickHouse client
//! let client = ClickHouseClient::new("http://localhost:8123");
//!
//! // Create an inserter with batch size of 1000
//! let mut inserter = Inserter::new(
//!     client,
//!     1000,
//!     Box::new(|partition, offset| {
//!         // Commit the offset to Kafka
//!         Ok(())
//!     }),
//!     "my_table".to_string(),
//!     vec!["column1".to_string(), "column2".to_string()],
//! );
//!
//! // Insert records
//! let record = ClickHouseRecord::new();
//! inserter.insert(record, 0, 100);
//!
//! // Flush records to ClickHouse
//! inserter.flush().await;
//! ```

use crate::infrastructure::olap::clickhouse::client::ClickHouseClientTrait;
use crate::infrastructure::olap::clickhouse::model::ClickHouseRecord;
use std::collections::{HashMap, VecDeque};

use rdkafka::error::KafkaError;
use tracing::{info, warn};

/// Represents a Kafka partition identifier
type Partition = i32;
/// Represents a Kafka message offset
type Offset = i64;
/// Maps Kafka partitions to their highest offset in a batch
type PartitionOffsets = HashMap<Partition, Offset>;
/// Maps Kafka partitions to the number of messages from that partition in a batch
type PartitionSizes = HashMap<Partition, i64>;

/// Represents a batch of records to be inserted into ClickHouse.
///
/// A batch contains:
/// - A collection of ClickHouse records
/// - The highest offset for each Kafka partition in the batch
/// - The number of messages from each partition in the batch
#[derive(Default)]
pub struct Batch {
    /// Collection of ClickHouse records to be inserted
    pub records: Vec<ClickHouseRecord>,
    /// Maps partitions to their highest offset in this batch
    pub partition_offsets: PartitionOffsets,
    /// Maps partitions to the number of messages in this batch
    pub messages_sizes: PartitionSizes,
}

impl Batch {
    /// Updates the offset tracking for a partition.
    ///
    /// This method:
    /// 1. Updates the highest offset for the partition (if the new offset is higher)
    /// 2. Increments the message count for the partition
    ///
    /// # Arguments
    ///
    /// * `partition` - The Kafka partition ID
    /// * `offset` - The message offset in the partition
    fn update_offset(&mut self, partition: i32, offset: i64) {
        self.partition_offsets
            .entry(partition)
            .and_modify(|e| *e = (*e).max(offset))
            .or_insert(offset);

        self.messages_sizes
            .entry(partition)
            .and_modify(|e| *e += 1)
            .or_insert(1);
    }

    /// Formats partition offsets as a human-readable string.
    ///
    /// # Returns
    ///
    /// A string in the format "Partition 0: 100, Partition 1: 200, ..."
    fn offsets_to_string(&self) -> String {
        self.partition_offsets
            .iter()
            .map(|(partition, offset)| format!("Partition {partition}: {offset}"))
            .collect::<Vec<String>>()
            .join(", ")
    }

    /// Formats message sizes per partition as a human-readable string.
    ///
    /// # Returns
    ///
    /// A string in the format "Partition 0: 50, Partition 1: 75, ..."
    fn messages_sizes_to_string(&self) -> String {
        self.messages_sizes
            .iter()
            .map(|(partition, size)| format!("Partition {partition}: {size}"))
            .collect::<Vec<String>>()
            .join(", ")
    }
}

/// A callback function type for committing Kafka offsets.
///
/// This function is called after a successful batch insertion to commit
/// the offsets back to Kafka.
///
/// # Arguments
///
/// * `partition` - The Kafka partition ID
/// * `offset` - The offset to commit
///
/// # Returns
///
/// A Result indicating success or failure of the commit operation
pub type OffsetCommitCallback = Box<dyn Fn(i32, i64) -> Result<(), KafkaError> + Send + Sync>;

/// A queue of batches waiting to be inserted
pub type BatchQueue = VecDeque<Batch>;

/// Manages batched inserts into ClickHouse tables.
///
/// The Inserter:
/// 1. Collects records into batches of a specified size
/// 2. Inserts batches into ClickHouse when they reach the size limit or when flushed
/// 3. Tracks and commits Kafka offsets after successful inserts
/// 4. Handles transient failures during insertion
///
/// # Type Parameters
///
/// * `C` - A type that implements the ClickHouseClientTrait
pub struct Inserter<C: ClickHouseClientTrait + 'static> {
    /// Queue of batches waiting to be inserted
    queue: BatchQueue,
    /// Client for interacting with ClickHouse
    client: C,
    /// Maximum number of records in a batch
    batch_size: usize,
    /// Callback for committing offsets after successful insertion
    commit_callback: OffsetCommitCallback,
    /// Target ClickHouse table name
    table: String,
    /// Column names for the target table
    columns: Vec<String>,
}

impl<C: ClickHouseClientTrait + 'static> Inserter<C> {
    /// Creates a new Inserter.
    ///
    /// # Arguments
    ///
    /// * `client` - A ClickHouse client for performing inserts
    /// * `batch_size` - Maximum number of records in a batch
    /// * `commit_callback` - Function to call for committing offsets
    /// * `table` - Target ClickHouse table name
    /// * `columns` - Column names for the target table
    ///
    /// # Returns
    ///
    /// A new Inserter instance with an initial empty batch
    pub fn new(
        client: C,
        batch_size: usize,
        commit_callback: OffsetCommitCallback,
        table: String,
        columns: Vec<String>,
    ) -> Self {
        let queue = VecDeque::from([Batch::default()]);

        Self {
            queue,
            client,
            batch_size,
            commit_callback,
            table,
            columns,
        }
    }

    /// Returns the number of batches in the queue.
    ///
    /// # Returns
    ///
    /// The number of batches waiting to be inserted
    pub fn len(&self) -> usize {
        self.queue.len()
    }

    /// Checks if the batch queue is empty.
    ///
    /// # Returns
    ///
    /// `true` if there are no batches in the queue, `false` otherwise
    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    /// Inserts a record into the current batch.
    ///
    /// If the current batch is full (reached batch_size), a new batch is created.
    /// The partition and offset are tracked for later committing.
    ///
    /// # Arguments
    ///
    /// * `record` - The ClickHouse record to insert
    /// * `partition` - The Kafka partition the record came from
    /// * `offset` - The offset of the record in the Kafka partition
    pub fn insert(&mut self, record: ClickHouseRecord, partition: i32, offset: i64) {
        let current_batch = self.queue.back_mut();

        match current_batch {
            Some(batch) => {
                if batch.records.len() >= self.batch_size {
                    self.queue.push_back(Batch::default());
                    let new_batch = self.queue.back_mut().unwrap();
                    new_batch.records.push(record);
                    new_batch.update_offset(partition, offset);
                } else {
                    batch.records.push(record);
                    batch.update_offset(partition, offset);
                }
            }
            None => {
                self.queue.push_back(Batch::default());
                let new_batch = self.queue.back_mut().unwrap();
                new_batch.records.push(record);
                new_batch.update_offset(partition, offset);
            }
        }
    }

    /// Flushes the oldest batch in the queue to ClickHouse.
    ///
    /// This method:
    /// 1. Takes the first batch from the queue
    /// 2. Attempts to insert it into ClickHouse
    /// 3. On success, commits offsets and removes the batch from the queue
    /// 4. On failure, logs a warning and leaves the batch in the queue for retry
    ///
    /// If the queue is empty or the first batch has no records, this method does nothing.
    pub async fn flush(&mut self) {
        if self.queue.is_empty()
            || self
                .queue
                .front()
                .is_none_or(|batch| batch.records.is_empty())
        {
            return;
        }

        if let Some(batch) = self.queue.front() {
            match self
                .client
                .insert(&self.table, &self.columns, &batch.records)
                .await
            {
                Ok(_) => {
                    info!(
                        "Batch Insert records - table='{}';insert_sizes='{}';offsets='{}'",
                        self.table,
                        batch.messages_sizes_to_string(),
                        batch.offsets_to_string()
                    );
                    crate::cli::display::batch_inserted(batch.records.len(), &self.table);

                    for (partition, offset) in &batch.partition_offsets {
                        if let Err(err) = (self.commit_callback)(*partition, *offset) {
                            warn!(
                                "Error committing offset {} for partition {}: {:?}",
                                offset, partition, err
                            );
                        }
                    }

                    self.queue.pop_front();
                }
                Err(e) => {
                    warn!(
                        "Transient Failure - table='{}';insert_sizes='{}';offsets='{}';error='{}'",
                        self.table,
                        batch.messages_sizes_to_string(),
                        batch.offsets_to_string(),
                        e
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;

    use super::*;
    use crate::infrastructure::olap::clickhouse::model::ClickHouseValue;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    struct MockClickHouseClient {
        insert_calls: Arc<AtomicUsize>,
        should_fail: bool,
    }

    impl MockClickHouseClient {
        fn new(should_fail: bool) -> Self {
            Self {
                insert_calls: Arc::new(AtomicUsize::new(0)),
                should_fail,
            }
        }
    }

    #[async_trait]
    impl ClickHouseClientTrait for MockClickHouseClient {
        async fn insert(
            &self,
            _table: &str,
            _columns: &[String],
            _records: &[ClickHouseRecord],
        ) -> anyhow::Result<()> {
            self.insert_calls.fetch_add(1, Ordering::SeqCst);
            if self.should_fail {
                Err(anyhow::anyhow!("Mock insert error"))
            } else {
                Ok(())
            }
        }
    }

    fn create_test_record(value: i64) -> ClickHouseRecord {
        let mut record = ClickHouseRecord::new();
        record.insert("test".to_string(), ClickHouseValue::new_int_64(value));
        record
    }

    #[tokio::test]
    async fn test_batch_creation_and_size_limit() {
        let mock_client = MockClickHouseClient::new(false);
        let mut inserter = Inserter::new(
            mock_client,
            1,
            Box::new(|_, _| Ok(())),
            "test_table".to_string(),
            vec!["test".to_string()],
        );

        // Insert 2 records with batch size 1
        for i in 0..2 {
            inserter.insert(create_test_record(i as i64), 0, i as i64);
        }

        assert_eq!(inserter.queue.len(), 2, "Should have created two batches");

        let first_batch = inserter.queue.front().unwrap();
        assert_eq!(first_batch.records.len(), 1, "First batch should be full");

        let second_batch = inserter.queue.back().unwrap();
        assert_eq!(
            second_batch.records.len(),
            1,
            "Second batch should have one record"
        );
    }

    #[tokio::test]
    async fn test_successful_flush() {
        let mock_client = MockClickHouseClient::new(false);
        let insert_calls = mock_client.insert_calls.clone();

        let mut inserter = Inserter::new(
            mock_client,
            100,
            Box::new(|_, _| Ok(())),
            "test_table".to_string(),
            vec!["test".to_string()],
        );

        inserter.insert(create_test_record(1), 0, 100);
        inserter.insert(create_test_record(2), 1, 200);

        // Manually flush instead of waiting for interval
        inserter.flush().await;

        assert_eq!(
            insert_calls.load(Ordering::SeqCst),
            1,
            "Mock client should have been called once"
        );

        assert_eq!(
            inserter
                .queue
                .front()
                .unwrap_or(&Batch::default())
                .records
                .len(),
            0,
            "Batch should be empty after successful flush"
        );
    }

    #[tokio::test]
    async fn test_offset_tracking_per_partition() {
        let mock_client = MockClickHouseClient::new(false);
        let mut inserter = Inserter::new(
            mock_client,
            100,
            Box::new(|_, _| Ok(())),
            "test_table".to_string(),
            vec!["test".to_string()],
        );

        inserter.insert(create_test_record(1), 0, 100);
        inserter.insert(create_test_record(2), 1, 200);
        inserter.insert(create_test_record(3), 0, 150);
        inserter.insert(create_test_record(4), 1, 175);

        let batch = inserter.queue.front().unwrap();

        assert_eq!(
            *batch.partition_offsets.get(&0).unwrap(),
            150,
            "Should track highest offset for partition 0"
        );
        assert_eq!(
            *batch.partition_offsets.get(&1).unwrap(),
            200,
            "Should track highest offset for partition 1"
        );
    }
}
