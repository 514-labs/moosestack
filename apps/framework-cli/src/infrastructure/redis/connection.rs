use redis::aio::ConnectionManager;
use redis::{Client, RedisError};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::time;

use super::redis_client::RedisConfig;

/// Represents the possible states of a Redis connection.
///
/// This enum is used to track and communicate the current state of the
/// connection to Redis, which is useful for monitoring and diagnostics.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ConnectionState {
    /// The connection to Redis is established and operational.
    Connected,
    /// The connection to Redis has been lost or closed.
    Disconnected,
    /// The system is currently attempting to reestablish a lost connection.
    Reconnecting,
}

/// A thread-safe wrapper around Redis ConnectionManager.
///
/// This struct provides a wrapper around the Redis ConnectionManager that
/// ensures thread safety and adds features like connection health
/// monitoring and automatic reconnection with exponential backoff.
#[derive(Clone)]
pub struct ConnectionManagerWrapper {
    /// The main connection used for regular Redis commands.
    pub connection: ConnectionManager,
    /// A separate connection dedicated to pub/sub operations.
    pub pub_sub: ConnectionManager,
    /// Client used to create new connections
    client: Arc<Client>,
    /// Atomic flag indicating the connection state.
    pub state: Arc<AtomicBool>, // true = connected
}

impl ConnectionManagerWrapper {
    /// Creates a new ConnectionManagerWrapper with the provided
    /// Redis client.
    ///
    /// This method establishes two separate connections to Redis:
    /// 1. A main connection for regular Redis commands
    /// 2. A dedicated connection for pub/sub operations
    ///
    /// Both connections are directly cloneable, leveraging ConnectionManager's
    /// internal thread safety. The connection state is initially set to connected (true).
    ///
    /// # Parameters
    ///
    /// - `client` - A reference to a Redis Client instance used to establish connections
    ///
    /// # Returns
    ///
    /// - `Result<Self, RedisError>` - A new ConnectionManagerWrapper or a
    ///   Redis error
    ///
    /// # Errors
    ///
    /// This method will return an error if it fails to establish either
    /// connection to Redis.
    pub async fn new(client: &Client) -> Result<Self, RedisError> {
        // Create connection manager for normal operations
        let conn = Self::create_connection_with_retry(client).await?;
        let pub_sub_conn = Self::create_connection_with_retry(client).await?;

        Ok(ConnectionManagerWrapper {
            connection: conn,
            pub_sub: pub_sub_conn,
            client: Arc::new(client.clone()),
            state: Arc::new(AtomicBool::new(true)),
        })
    }

    /// Creates a new ConnectionManager with retry logic.
    ///
    /// This helper method attempts to create a new connection with retry logic
    /// to handle transient connection failures.
    ///
    /// # Parameters
    ///
    /// - `client` - A reference to a Redis Client instance
    ///
    /// # Returns
    ///
    /// - `Result<ConnectionManager, RedisError>` - A new ConnectionManager or an error
    async fn create_connection_with_retry(
        client: &Client,
    ) -> Result<ConnectionManager, RedisError> {
        let mut attempts = 0;
        let max_attempts = 3;
        let mut last_error = None;

        while attempts < max_attempts {
            match time::timeout(Duration::from_secs(5), client.get_connection_manager()).await {
                Ok(Ok(conn)) => return Ok(conn),
                Ok(Err(e)) => {
                    tracing::warn!(
                        "<RedisConnection> Failed to create Redis connection (attempt {}/{}): {}",
                        attempts + 1,
                        max_attempts,
                        e
                    );
                    last_error = Some(e);
                }
                Err(_) => {
                    tracing::warn!(
                        "<RedisConnection> Timeout creating Redis connection (attempt {}/{})",
                        attempts + 1,
                        max_attempts
                    );
                }
            }

            attempts += 1;
            if attempts < max_attempts {
                time::sleep(Duration::from_secs(1)).await;
            }
        }

        Err(last_error.unwrap_or_else(|| {
            RedisError::from(std::io::Error::new(
                std::io::ErrorKind::ConnectionAborted,
                "Failed to establish Redis connection after multiple attempts",
            ))
        }))
    }

    /// Gets a fresh connection, either by cloning the existing one or creating a new one.
    ///
    /// This method is used to get a connection for operations, with built-in
    /// recovery if the connection state is not healthy.
    ///
    /// # Returns
    ///
    /// - `ConnectionManager` - A Redis connection manager ready for operations
    pub async fn get_connection(&self) -> ConnectionManager {
        if self.state.load(Ordering::SeqCst) {
            self.connection.clone()
        } else {
            match Self::create_connection_with_retry(&self.client).await {
                Ok(conn) => conn,
                Err(_) => self.connection.clone(), // Fall back to existing connection
            }
        }
    }

    /// Gets a fresh pub_sub connection, either by cloning the existing one or creating a new one.
    ///
    /// # Returns
    ///
    /// - `ConnectionManager` - A Redis connection manager for pub/sub operations
    pub async fn get_pubsub_connection(&self) -> ConnectionManager {
        if self.state.load(Ordering::SeqCst) {
            self.pub_sub.clone()
        } else {
            match Self::create_connection_with_retry(&self.client).await {
                Ok(conn) => conn,
                Err(_) => self.pub_sub.clone(), // Fall back to existing connection
            }
        }
    }

    /// Checks the health of the Redis connection by sending a PING command.
    ///
    /// This method attempts to send a PING command to Redis with a timeout
    /// of 2 seconds. If the PING succeeds, it returns true. If it fails or
    /// times out, it updates the connection state to disconnected (false)
    /// and returns false.
    ///
    /// # Returns
    ///
    /// - `bool` - true if the connection is healthy, false otherwise
    pub async fn ping(&mut self) -> bool {
        // Get a fresh connection by cloning the existing one
        let mut conn = self.connection.clone();

        // Try to ping with connection using cmd() method
        let cmd = redis::cmd("PING");
        let ping_future = cmd.query_async::<String>(&mut conn);
        let timeout_future = time::timeout(Duration::from_secs(2), ping_future);

        match timeout_future.await {
            Ok(Ok(_response)) => true,
            Ok(Err(e)) => {
                tracing::warn!("<RedisConnection> Redis ping failed: {:?}", e);
                self.state.store(false, Ordering::SeqCst);
                false
            }
            Err(e) => {
                tracing::warn!("<RedisConnection> Redis ping timed out: {:?}", e);
                self.state.store(false, Ordering::SeqCst);
                false
            }
        }
    }

    /// Attempts to reconnect to Redis with exponential backoff.
    ///
    /// This method is called when a connection failure is detected. It
    /// attempts to reestablish the connection with an exponential backoff
    /// strategy:
    ///
    /// 1. Initial backoff of 5 seconds
    /// 2. Doubles the backoff time after each failed attempt
    /// 3. Caps the maximum backoff at 60 seconds
    ///
    /// Once a connection is successfully established, it updates the
    /// connection state to connected (true) and returns.
    ///
    /// # Parameters
    ///
    /// - `config` - A reference to the Redis configuration
    pub async fn attempt_reconnection(&mut self, config: &RedisConfig) {
        let mut backoff = 5;
        while !self.state.load(Ordering::SeqCst) {
            tracing::info!(
                "<RedisConnection> Attempting to reconnect to Redis at {} (backoff: {}s)",
                config.effective_url(),
                backoff
            );
            time::sleep(Duration::from_secs(backoff)).await;

            // Attempt to create a new client and connections
            let client_result = Client::open(config.effective_url());
            match client_result {
                Ok(client) => {
                    // Try to create both connections
                    match Self::create_connection_with_retry(&client).await {
                        Ok(new_conn) => {
                            self.connection = new_conn;

                            // Try to get a new pub_sub connection as well
                            match Self::create_connection_with_retry(&client).await {
                                Ok(new_pubsub) => {
                                    self.pub_sub = new_pubsub;
                                    // Store the new client for future connection creation
                                    self.client = Arc::new(client);
                                    tracing::info!("<RedisConnection> Successfully reconnected both Redis connections");
                                }
                                Err(e) => {
                                    tracing::warn!("<RedisConnection> Reconnected main connection but failed to reconnect pub_sub: {}", e);
                                    // Still mark as reconnected since the main connection succeeded
                                }
                            }

                            self.state.store(true, Ordering::SeqCst);
                            break;
                        }
                        Err(err) => {
                            tracing::warn!("<RedisConnection> Failed to reconnect to Redis: {}", err);
                            backoff = std::cmp::min(backoff * 2, 60);
                        }
                    }
                }
                Err(err) => {
                    tracing::warn!(
                        "<RedisConnection> Failed to create Redis client for reconnection: {}",
                        err
                    );
                    backoff = std::cmp::min(backoff * 2, 60);
                }
            }
        }
    }

    /// Gracefully shuts down Redis connections by sending QUIT commands.
    ///
    /// This method should be called as part of the application shutdown sequence
    /// to ensure Redis connections are properly terminated.
    pub async fn shutdown(&self) {
        tracing::info!("<RedisConnection> Shutting down Redis connections");

        // Send QUIT command to both connection managers
        let mut conn = self.connection.clone();
        let mut pub_sub = self.pub_sub.clone();

        let _ = redis::cmd("QUIT").query_async::<()>(&mut conn).await;
        let _ = redis::cmd("QUIT").query_async::<()>(&mut pub_sub).await;

        // Mark the connection as disconnected
        self.state.store(false, Ordering::SeqCst);

        tracing::info!("<RedisConnection> Redis connections shutdown complete");
    }
}
