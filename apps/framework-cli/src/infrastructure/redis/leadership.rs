use redis::aio::ConnectionManager;

use super::redis_client::RedisConfig;

/// Manager for distributed leadership and lock coordination.
///
/// This struct provides methods to acquire, verify, renew, and release
/// distributed locks across multiple service instances using Redis.
#[derive(Clone)]
pub struct LeadershipManager {
    /// Unique identifier for this service instance.
    pub instance_id: String,
    /// Redis configuration for connecting to the Redis server.
    pub redis_config: RedisConfig,
}

impl LeadershipManager {
    /// Creates a new LeadershipManager instance.
    ///
    /// # Parameters
    ///
    /// - `instance_id` - A unique identifier for this service instance
    /// - `config` - Redis configuration for connecting to the Redis server
    ///
    /// # Returns
    ///
    /// A new LeadershipManager instance configured with the provided
    /// parameters
    pub fn new(instance_id: String, config: RedisConfig) -> Self {
        LeadershipManager {
            instance_id,
            redis_config: config,
        }
    }

    /// Attempts to acquire a distributed lock.
    ///
    /// This method tries to acquire a lock with the following logic:
    /// - If the lock doesn't exist, it's created with this instance as the owner
    /// - If the lock exists and is owned by this instance, the TTL is refreshed
    /// - If the lock exists and is owned by another instance, acquisition fails
    ///
    /// The operation is performed atomically using a Lua script.
    ///
    /// # Parameters
    ///
    /// - `conn` - Redis connection manager
    /// - `lock_key` - Unique identifier for the lock
    /// - `ttl` - Time To Live in seconds for the lock
    ///
    /// # Returns
    ///
    /// - `(bool, bool)` - Tuple where the first element is true if the lock was acquired or already owned,
    ///   the second element is true if it was a new acquisition, false otherwise
    pub async fn attempt_lock(
        &self,
        mut conn: ConnectionManager,
        lock_key: &str,
        ttl: i64,
    ) -> (bool, bool) {
        let instance_id = &self.instance_id;
        let script = redis::Script::new(
            r#"
            local current = redis.call('GET', KEYS[1])
            if not current then
                redis.call('SET', KEYS[1], ARGV[1])
                redis.call('EXPIRE', KEYS[1], ARGV[2])
                return 2  -- New acquisition
            elseif current == ARGV[1] then
                redis.call('EXPIRE', KEYS[1], ARGV[2])
                return 1  -- Renewal
            else
                return 0  -- Failed to acquire
            end
            "#,
        );

        match script
            .key(lock_key)
            .arg(instance_id)
            .arg(ttl)
            .invoke_async::<i64>(&mut conn)
            .await
        {
            Ok(2) => {
                tracing::debug!(
                    "<RedisLeadership> Lock acquired: {} by instance {}",
                    lock_key,
                    instance_id
                );
                (true, true) // has_lock, is_new_acquisition
            }
            Ok(1) => {
                // Don't log renewals to reduce noise
                (true, false) // has_lock and not_new_acquisition
            }
            Ok(_) => {
                (false, false) // doesn't have lock and not new acquisition
            }
            Err(e) => {
                tracing::error!("<RedisLeadership> Error acquiring lock {}: {}", lock_key, e);
                (false, false) // doesn't have lock and not new acquisition
            }
        }
    }

    /// Renews an existing lock by extending its TTL.
    ///
    /// This method extends the TTL of a lock only if it's currently owned
    /// by the specified instance. The operation is performed atomically
    /// using a Lua script.
    ///
    /// # Parameters
    ///
    /// - `conn` - Redis connection manager
    /// - `lock_key` - Unique identifier for the lock
    /// - `instance_id` - The instance ID that should own the lock
    /// - `ttl` - New Time To Live in seconds for the lock
    ///
    /// # Returns
    ///
    /// - `anyhow::Result<bool>` - Ok(true) if the lock was renewed,
    ///   Ok(false) if not owned by this instance
    ///
    /// # Errors
    ///
    /// Returns an error if the Redis operation fails
    pub async fn renew_lock(
        &self,
        mut conn: ConnectionManager,
        lock_key: &str,
        instance_id: &str,
        ttl: i64,
    ) -> anyhow::Result<bool> {
        let script = redis::Script::new(
            r#"
            local current = redis.call('GET', KEYS[1])
            if current == ARGV[1] then
                redis.call('EXPIRE', KEYS[1], ARGV[2])
                return 1
            else
                return 0
            end
            "#,
        );

        match script
            .key(lock_key)
            .arg(instance_id)
            .arg(ttl)
            .invoke_async::<i64>(&mut conn)
            .await
        {
            Ok(1) => {
                tracing::trace!(
                    "<RedisLeadership> Lock renewed: {} for instance {}",
                    lock_key,
                    instance_id
                );
                Ok(true)
            }
            Ok(0) => {
                tracing::warn!(
                    "<RedisLeadership> Cannot renew lock {} - not owned by instance {}",
                    lock_key,
                    instance_id
                );
                Ok(false)
            }
            Ok(_) => {
                tracing::warn!(
                    "<RedisLeadership> Unexpected result while renewing lock {} for instance {}",
                    lock_key,
                    instance_id
                );
                Ok(false)
            }
            Err(e) => {
                tracing::error!("<RedisLeadership> Error renewing lock {}: {}", lock_key, e);
                Err(anyhow::anyhow!("Error renewing lock: {}", e))
            }
        }
    }

    /// Releases a lock if it's owned by the specified instance.
    ///
    /// This method deletes a lock only if it's currently owned by the
    /// specified instance. The operation is performed atomically using
    /// a Lua script.
    ///
    /// # Parameters
    ///
    /// - `conn` - Redis connection manager
    /// - `lock_key` - Unique identifier for the lock
    /// - `instance_id` - The instance ID that should own the lock
    ///
    /// # Returns
    ///
    /// - `anyhow::Result<()>` - Ok(()) if the operation was successful
    ///
    /// # Errors
    ///
    /// Returns an error if the Redis operation fails
    pub async fn release_lock(
        &self,
        mut conn: ConnectionManager,
        lock_key: &str,
        instance_id: &str,
    ) -> anyhow::Result<()> {
        let script = redis::Script::new(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then\n return redis.call('DEL', KEYS[1])\nelse\n return 0\nend"
        );
        let _result: () = script
            .key(lock_key)
            .arg(instance_id)
            .invoke_async(&mut conn)
            .await?;
        Ok(())
    }

    /// Checks if a lock is currently owned by the specified instance.
    ///
    /// This method verifies if a lock exists and is owned by the specified
    /// instance without modifying the lock. The operation is performed
    /// atomically using a Lua script.
    ///
    /// # Parameters
    ///
    /// - `conn` - Redis connection manager
    /// - `lock_key` - Unique identifier for the lock
    /// - `instance_id` - The instance ID to check ownership against
    ///
    /// # Returns
    ///
    /// - `anyhow::Result<bool>` - Ok(true) if the lock is owned by the
    ///   instance, Ok(false) otherwise
    ///
    /// # Errors
    ///
    /// Returns an error if the Redis operation fails
    pub async fn has_lock(
        &self,
        mut conn: ConnectionManager,
        lock_key: &str,
        instance_id: &str,
    ) -> anyhow::Result<bool> {
        let script = redis::Script::new(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then return 1 else return 0 end",
        );
        let result: i32 = script
            .key(lock_key)
            .arg(instance_id)
            .invoke_async::<i32>(&mut conn)
            .await?;
        Ok(result == 1)
    }
}
