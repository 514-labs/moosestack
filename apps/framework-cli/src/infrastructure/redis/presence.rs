use redis::aio::ConnectionManager;
use redis::AsyncCommands;

/// Manager for service instance presence tracking.
///
/// This struct provides methods to register and maintain the presence
/// of a service instance in a distributed system using Redis TTL keys.
/// It is cloneable to allow sharing across multiple tasks.
#[derive(Clone)]
pub struct PresenceManager {
    /// Unique identifier for this service instance.
    pub instance_id: String,
    /// Prefix for Redis keys to prevent collisions.
    pub key_prefix: String,
}

impl PresenceManager {
    /// Creates a new PresenceManager instance.
    ///
    /// # Parameters
    ///
    /// - `instance_id` - A unique identifier for this service instance
    /// - `key_prefix` - Prefix for Redis keys to prevent collisions
    ///
    /// # Returns
    ///
    /// A new PresenceManager instance configured with the provided
    /// parameters
    pub fn new(instance_id: String, key_prefix: String) -> Self {
        PresenceManager {
            instance_id,
            key_prefix,
        }
    }

    /// Updates the presence of this instance in Redis.
    ///
    /// This method sets a key in Redis with the current time and a TTL.
    /// The key is in the format: `{key_prefix}::{instance_id}::presence`.
    ///
    /// # Arguments
    ///
    /// * `conn` - Redis connection to use for the operation
    ///
    /// # Returns
    ///
    /// * `anyhow::Result<()>` - Success or failure result
    pub async fn update_presence(&self, mut conn: ConnectionManager) -> anyhow::Result<()> {
        let key = format!("{}::{}::presence", self.key_prefix, self.instance_id);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        match conn.set_ex::<_, _, ()>(&key, now, 3).await {
            Ok(_) => {
                tracing::debug!(
                    "<RedisPresence> Updated presence for instance {}",
                    self.instance_id
                );
                Ok(())
            }
            Err(e) => {
                tracing::error!(
                    "<RedisPresence> Failed to update presence for instance {}: {}",
                    self.instance_id,
                    e
                );
                Err(anyhow::anyhow!("Failed to update presence: {}", e))
            }
        }
    }
}
