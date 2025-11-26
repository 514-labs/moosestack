use redis::aio::ConnectionManager;
use redis::AsyncCommands;

/// Manager for pub/sub messaging between service instances.
///
/// This struct provides methods to publish messages to specific instances
/// or broadcast messages to all instances using Redis pub/sub channels.
#[derive(Clone)]
pub struct MessagingManager {
    /// Prefix for Redis keys and channels to prevent collisions.
    pub key_prefix: String,
}

impl MessagingManager {
    /// Creates a new MessagingManager instance.
    ///
    /// # Parameters
    ///
    /// - `key_prefix` - Prefix for Redis keys and channels to prevent
    ///   collisions
    ///
    /// # Returns
    ///
    /// A new MessagingManager instance configured with the provided key
    /// prefix
    pub fn new(key_prefix: String) -> Self {
        MessagingManager { key_prefix }
    }

    /// Generates the Redis channel name for a specific target.
    ///
    /// This method formats the channel name using the pattern:
    /// `{key_prefix}::{target}::msgchannel`
    ///
    /// The target can be:
    /// - An instance ID for direct messaging
    /// - "msgchannel" for broadcast messaging
    ///
    /// # Parameters
    ///
    /// - `target` - The target identifier (instance ID or "msgchannel")
    ///
    /// # Returns
    ///
    /// A string containing the formatted channel name
    pub fn channel_for(&self, target: &str) -> String {
        format!("{}::{}::msgchannel", self.key_prefix, target)
    }

    /// Publishes a message to a Redis pub/sub channel.
    ///
    /// This method sends a message to the specified target channel.
    /// The target can be an instance ID for direct messaging or
    /// a broadcast channel identifier for sending to all instances.
    ///
    /// # Parameters
    ///
    /// - `conn` - Redis connection manager
    /// - `target` - The target identifier (instance ID or channel name)
    /// - `message` - The message content to publish
    ///
    /// # Returns
    ///
    /// - `anyhow::Result<()>` - Ok(()) if the operation was successful
    ///
    /// # Errors
    ///
    /// Returns an error if the Redis publish operation fails
    pub async fn publish_message(
        &self,
        mut conn: ConnectionManager,
        target: &str,
        message: &str,
    ) -> anyhow::Result<()> {
        let channel = self.channel_for(target);

        match conn.publish::<_, _, ()>(&channel, message).await {
            Ok(_) => {
                tracing::debug!("<RedisMessaging> Message published to channel {}", channel);
                Ok(())
            }
            Err(e) => {
                tracing::error!(
                    "<RedisMessaging> Failed to publish message to channel {}: {}",
                    channel,
                    e
                );
                Err(anyhow::anyhow!("Failed to publish message: {}", e))
            }
        }
    }
}
