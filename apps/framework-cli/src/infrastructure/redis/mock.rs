use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// An in-memory mock implementation of Redis client functionality.
///
/// This struct provides a fallback implementation when a Redis server is
/// unavailable or for testing purposes. It uses a thread-safe HashMap to
/// simulate Redis storage and implements simplified versions of the Redis
/// operations used by the client.
#[derive(Default, Clone, Debug)]
pub struct MockRedisClient {
    /// Thread-safe in-memory storage that simulates Redis.
    /// Using RwLock instead of Mutex to allow concurrent reads, which
    /// improves performance in read-heavy scenarios common in Redis
    /// usage patterns.
    pub store: Arc<RwLock<HashMap<String, String>>>,

    /// Thread-safe in-memory storage for message queues.
    /// Each queue is a vector of messages.
    pub queues: Arc<RwLock<HashMap<String, Vec<String>>>>,
}

impl MockRedisClient {
    /// Creates a new MockRedisClient instance with an empty storage.
    ///
    /// # Returns
    ///
    /// A new MockRedisClient instance with an initialized empty HashMap
    pub fn new() -> Self {
        Self {
            store: Arc::new(RwLock::new(HashMap::new())),
            queues: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Simulates updating the presence of a service instance.
    ///
    /// This method stores the presence information in the in-memory
    /// HashMap, mimicking the behavior of the real Redis presence update
    /// operation.
    ///
    /// # Parameters
    ///
    /// - `key` - The presence key for the instance
    /// - `value` - The timestamp value to store
    ///
    /// # Returns
    ///
    /// - `Result<()>` - Ok if the operation was successful
    pub async fn update_presence(&self, key: &str, value: u64) -> Result<()> {
        let mut store = self.store.write().await;
        store.insert(key.to_string(), value.to_string());
        Ok(())
    }

    /// Simulates attempting to acquire a distributed lock.
    ///
    /// This method checks if a lock exists and is owned by the specified
    /// instance. If the lock doesn't exist, it creates it with the
    /// specified instance as owner.
    ///
    /// # Parameters
    ///
    /// - `key` - The lock key
    /// - `instance_id` - The instance ID attempting to acquire the lock
    ///
    /// # Returns
    ///
    /// - `bool` - true if the lock was acquired or already owned, false
    ///   otherwise
    pub async fn attempt_lock(&self, key: &str, instance_id: &str) -> bool {
        let mut store = self.store.write().await;
        if let Some(existing) = store.get(key) {
            return existing == instance_id;
        }
        store.insert(key.to_string(), instance_id.to_string());
        true
    }

    /// Simulates renewing a distributed lock.
    ///
    /// This method checks if the lock exists and is owned by the specified
    /// instance. Unlike real Redis, it doesn't extend TTL as the mock
    /// doesn't implement expiration.
    ///
    /// # Parameters
    ///
    /// - `key` - The lock key
    /// - `instance_id` - The instance ID that should own the lock
    ///
    /// # Returns
    ///
    /// - `bool` - true if the lock exists and is owned by the specified
    ///   instance
    pub async fn renew_lock(&self, key: &str, instance_id: &str) -> bool {
        let store = self.store.read().await;
        if let Some(current) = store.get(key) {
            return current == instance_id;
        }
        false
    }

    /// Simulates releasing a distributed lock.
    ///
    /// This method removes the lock if it exists and is owned by the
    /// specified instance.
    ///
    /// # Parameters
    ///
    /// - `key` - The lock key
    /// - `instance_id` - The instance ID that should own the lock
    ///
    /// # Returns
    ///
    /// - `Result<()>` - Ok if the operation was successful
    pub async fn release_lock(&self, key: &str, instance_id: &str) -> Result<()> {
        let mut store = self.store.write().await;
        if let Some(current) = store.get(key) {
            if current == instance_id {
                store.remove(key);
            }
        }
        Ok(())
    }

    /// Posts a message to a mock queue.
    ///
    /// # Parameters
    ///
    /// * `queue` - The queue to post the message to
    /// * `message` - The message to post
    ///
    /// # Returns
    ///
    /// * `anyhow::Result<()>` - Success or failure result
    pub async fn post_queue_message(&self, queue: &str, message: &str) -> anyhow::Result<()> {
        let mut queues_map = self.queues.write().await;

        if !queues_map.contains_key(queue) {
            tracing::debug!("<RedisMock> Creating new queue: {}", queue);
            queues_map.insert(queue.to_string(), Vec::new());
        }

        if let Some(queue_vec) = queues_map.get_mut(queue) {
            queue_vec.push(message.to_string());
            tracing::debug!(
                "<RedisMock> Added message to queue {}, length now: {}",
                queue,
                queue_vec.len()
            );
        }

        Ok(())
    }

    /// Gets a message from a mock queue.
    ///
    /// # Parameters
    ///
    /// * `queue` - The queue to get the message from
    ///
    /// # Returns
    ///
    /// * `anyhow::Result<Option<String>>` - The message, or None if the queue is empty
    pub async fn get_queue_message(&self, queue: &str) -> anyhow::Result<Option<String>> {
        let mut queues_map = self.queues.write().await;

        if let Some(queue_vec) = queues_map.get_mut(queue) {
            if !queue_vec.is_empty() {
                let message = queue_vec.remove(0);
                tracing::debug!(
                    "<RedisMock> Retrieved message from queue {}, length now: {}",
                    queue,
                    queue_vec.len()
                );
                return Ok(Some(message));
            }
        } else {
            tracing::debug!("<RedisMock> Queue {} does not exist", queue);
        }

        Ok(None)
    }
}
