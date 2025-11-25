//! State storage abstraction for InfrastructureMap
//!
//! This module provides an abstraction over where Moose stores its infrastructure state.
//! State can be stored in Redis (traditional) or ClickHouse (for serverless/CLI-only deployments).

use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::olap::clickhouse::ConfiguredDBClient;
use crate::infrastructure::olap::clickhouse::{check_ready, create_client};
use crate::infrastructure::redis::redis_client::RedisClient;
use crate::project::Project;
use crate::utilities::machine_id::get_or_create_machine_id;
use anyhow::{Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use protobuf::Message;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{debug, info, warn};

/// Lock data for migration coordination
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationLock {
    pub machine_id: String,
    pub started_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[async_trait]
pub trait StateStorage: Send + Sync {
    /// Store the infrastructure map
    async fn store_infrastructure_map(&self, infra_map: &InfrastructureMap) -> Result<()>;

    /// Load the infrastructure map
    async fn load_infrastructure_map(&self) -> Result<Option<InfrastructureMap>>;

    /// Try to acquire migration lock
    /// Must be manually released with release_migration_lock()
    /// Lock automatically expires after 5 minutes as a safety fallback
    async fn acquire_migration_lock(&self) -> Result<()>;

    /// Release migration lock
    async fn release_migration_lock(&self) -> Result<()>;
}

/// Redis-based state storage
pub struct RedisStateStorage {
    client: Arc<RedisClient>,
}

impl RedisStateStorage {
    const LOCK_KEY: &'static str = "migration_lock";
    const LOCK_TIMEOUT_SECS: i64 = 300; // 5 minutes

    pub fn new(client: Arc<RedisClient>) -> Self {
        Self { client }
    }
}

#[async_trait]
impl StateStorage for RedisStateStorage {
    async fn store_infrastructure_map(&self, infra_map: &InfrastructureMap) -> Result<()> {
        infra_map.store_in_redis(&self.client).await
    }

    async fn load_infrastructure_map(&self) -> Result<Option<InfrastructureMap>> {
        InfrastructureMap::load_from_last_redis_prefix(&self.client).await
    }

    async fn acquire_migration_lock(&self) -> Result<()> {
        // Use LeadershipManager's atomic lock acquisition
        // Add key_prefix for multi-tenancy isolation (different projects can migrate in parallel)
        let lock_key = self.client.service_prefix(&[Self::LOCK_KEY]);
        let (has_lock, is_new) = self
            .client
            .leadership_manager
            .attempt_lock(
                self.client.connection_manager.connection.clone(),
                &lock_key,
                Self::LOCK_TIMEOUT_SECS,
            )
            .await;

        if !has_lock {
            // Check if there's an existing lock to provide better error message
            let lock_value: Option<String> =
                self.client.get_with_service_prefix(Self::LOCK_KEY).await?;

            if lock_value.is_some() {
                anyhow::bail!(
                    "Migration already in progress. Lock expires automatically after {} seconds.",
                    Self::LOCK_TIMEOUT_SECS
                );
            } else {
                anyhow::bail!("Failed to acquire migration lock (race condition)");
            }
        }

        if is_new {
            info!(
                "Acquired migration lock (expires in {} seconds)",
                Self::LOCK_TIMEOUT_SECS
            );
        }

        Ok(())
    }

    async fn release_migration_lock(&self) -> Result<()> {
        // Use same prefixed key as acquire for multi-tenancy isolation
        let lock_key = self.client.service_prefix(&[Self::LOCK_KEY]);

        self.client
            .leadership_manager
            .release_lock(
                self.client.connection_manager.connection.clone(),
                &lock_key,
                &self.client.instance_id,
            )
            .await?;

        info!("Released migration lock {}", lock_key);
        Ok(())
    }
}

/// ClickHouse-based state storage (for serverless/CLI-only deployments)
pub struct ClickHouseStateStorage {
    client: ConfiguredDBClient,
    db_name: String,
}

impl ClickHouseStateStorage {
    const STATE_TABLE: &'static str = "_MOOSE_STATE";
    const LOCK_KEY: &'static str = "migration_lock";
    const LOCK_TIMEOUT_SECS: i64 = 300; // 5 minutes

    pub fn new(client: ConfiguredDBClient, db_name: String) -> Self {
        Self { client, db_name }
    }

    /// Ensure the state table exists using KeeperMap for strong consistency
    async fn ensure_state_table(&self) -> Result<()> {
        // Use KeeperMap for:
        // 1. Atomic lock operations (prevents concurrent migrations)
        // 2. Synchronous writes (no async_insert race conditions)
        // 3. Immediate read-after-write consistency
        // 4. Already configured in dev mode. Available in Clickhouse Cloud
        let create_table_sql = format!(
            r#"
            CREATE TABLE IF NOT EXISTS `{}`.`{}`
            (
                key String,
                value String,
                created_at DateTime DEFAULT now()
            )
            ENGINE = KeeperMap('/{}/{}')
            PRIMARY KEY key
            "#,
            self.db_name,
            Self::STATE_TABLE,
            self.db_name,
            Self::STATE_TABLE
        );

        debug!("Creating KeeperMap state table: {}", create_table_sql);

        self.client
            .client
            .query(&create_table_sql)
            .execute()
            .await
            .context("Failed to create state table")?;

        Ok(())
    }
}

#[async_trait]
impl StateStorage for ClickHouseStateStorage {
    async fn store_infrastructure_map(&self, infra_map: &InfrastructureMap) -> Result<()> {
        // Ensure table exists
        self.ensure_state_table().await?;

        // Serialize to protobuf
        let encoded: Vec<u8> = infra_map.to_proto().write_to_bytes()?;
        let encoded_base64 =
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &encoded);

        // Use timestamp-based key for history
        let timestamp_ms = Utc::now().timestamp_millis();
        let key = format!("infra_map_{}", timestamp_ms);

        // Insert with timestamp key (creates audit history)
        let insert_sql = format!(
            "INSERT INTO `{}`.`{}` (key, value) VALUES ('{}', '{}')",
            self.db_name,
            Self::STATE_TABLE,
            key,
            encoded_base64
        );

        debug!(
            "Storing infrastructure map in ClickHouse KeeperMap state table (key: {})",
            key
        );

        self.client
            .client
            .query(&insert_sql)
            .execute()
            .await
            .context("Failed to store infrastructure map in ClickHouse")?;

        info!("Stored infrastructure map in ClickHouse ({})", key);

        Ok(())
    }

    async fn load_infrastructure_map(&self) -> Result<Option<InfrastructureMap>> {
        // Ensure table exists first
        self.ensure_state_table().await?;

        // Query for the latest state by timestamp
        let query_sql = format!(
            r#"
            SELECT value
            FROM `{}`.`{}`
            WHERE key LIKE 'infra_map_%'
            ORDER BY created_at DESC
            LIMIT 1
            "#,
            self.db_name,
            Self::STATE_TABLE
        );

        info!("Loading infrastructure map from database: {}", self.db_name);

        let mut cursor = self
            .client
            .client
            .query(&query_sql)
            .fetch::<String>()
            .context("Failed to query state table")?;

        // Try to get the first row
        let value_str = match cursor.next().await {
            Ok(Some(value)) => value,
            Ok(None) => {
                debug!("No infrastructure map found in ClickHouse state table");
                return Ok(None);
            }
            Err(e) => {
                return Err(anyhow::anyhow!("Failed to fetch row: {}", e));
            }
        };

        // Decode from base64
        let encoded =
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &value_str)
                .context("Failed to decode base64 state value")?;

        // Deserialize from protobuf
        let infra_map = InfrastructureMap::from_proto(encoded)
            .context("Failed to deserialize infrastructure map from protobuf")?;

        info!("Loaded infrastructure map from ClickHouse");

        Ok(Some(infra_map))
    }

    async fn acquire_migration_lock(&self) -> Result<()> {
        self.ensure_state_table().await?;

        // Enable strict mode for this session - INSERT will fail if key exists (not overwrite)
        self.client
            .client
            .query("SET keeper_map_strict_mode = 1")
            .execute()
            .await
            .context("Failed to enable strict mode")?;

        // Check if lock exists
        let existing_lock_query = format!(
            "SELECT value FROM `{}`.`{}` WHERE key = '{}'",
            self.db_name,
            Self::STATE_TABLE,
            Self::LOCK_KEY
        );

        let mut cursor = self
            .client
            .client
            .query(&existing_lock_query)
            .fetch::<String>()
            .context("Failed to query for existing lock")?;

        if let Ok(Some(lock_json_base64)) = cursor.next().await {
            // Lock exists - check if expired
            // Base64 decode the lock data
            let lock_json_bytes = base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                lock_json_base64.as_bytes(),
            )
            .context("Failed to base64 decode lock data")?;
            let lock_json = String::from_utf8(lock_json_bytes)
                .context("Failed to convert lock data to UTF-8")?;

            let existing_lock: MigrationLock =
                serde_json::from_str(&lock_json).context("Failed to deserialize existing lock")?;

            if existing_lock.expires_at < Utc::now() {
                // Stale lock - delete it
                let delete_sql = format!(
                    "DELETE FROM `{}`.`{}` WHERE key = '{}'",
                    self.db_name,
                    Self::STATE_TABLE,
                    Self::LOCK_KEY
                );

                self.client
                    .client
                    .query(&delete_sql)
                    .execute()
                    .await
                    .context("Failed to delete stale lock")?;

                warn!(
                    "Deleted stale migration lock from machine {} (expired at {})",
                    existing_lock.machine_id, existing_lock.expires_at
                );
            } else {
                // Active lock held by someone else
                let time_remaining = existing_lock.expires_at - Utc::now();
                let minutes = time_remaining.num_minutes();
                let seconds = time_remaining.num_seconds() % 60;

                anyhow::bail!(
                    "Migration already in progress on machine {}. Started at {}. Expires in {}m {}s.",
                    existing_lock.machine_id,
                    existing_lock.started_at.format("%Y-%m-%d %H:%M:%S UTC"),
                    minutes,
                    seconds
                );
            }
        }

        // Try to acquire lock
        let lock_data = MigrationLock {
            machine_id: get_or_create_machine_id(),
            started_at: Utc::now(),
            expires_at: Utc::now() + Duration::seconds(Self::LOCK_TIMEOUT_SECS),
        };

        let lock_json =
            serde_json::to_string(&lock_data).context("Failed to serialize lock data")?;

        // Base64 encode to avoid SQL injection (no escaping needed for base64)
        let lock_json_base64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            lock_json.as_bytes(),
        );

        let insert_sql = format!(
            "INSERT INTO `{}`.`{}` (key, value) VALUES ('{}', '{}')",
            self.db_name,
            Self::STATE_TABLE,
            Self::LOCK_KEY,
            lock_json_base64
        );

        match self.client.client.query(&insert_sql).execute().await {
            Ok(_) => {
                info!(
                    "Acquired migration lock (expires in {} seconds)",
                    Self::LOCK_TIMEOUT_SECS
                );
                Ok(())
            }
            Err(e) => {
                // Race condition - someone else got the lock between our check and insert
                anyhow::bail!("Failed to acquire migration lock (race condition): {}", e)
            }
        }
    }

    async fn release_migration_lock(&self) -> Result<()> {
        let delete_sql = format!(
            "DELETE FROM `{}`.`{}` WHERE key = '{}'",
            self.db_name,
            Self::STATE_TABLE,
            Self::LOCK_KEY
        );

        self.client
            .client
            .query(&delete_sql)
            .execute()
            .await
            .context("Failed to release migration lock")?;

        info!("Released migration lock");
        Ok(())
    }
}

/// Builder for creating state storage based on project configuration.
///
/// Storage backend is determined by `state_config.storage` in moose.config.toml.
pub struct StateStorageBuilder<'a> {
    project: &'a Project,
    clickhouse_config: Option<ClickHouseConfig>,
    redis_client: Option<&'a Arc<RedisClient>>,
    redis_url: Option<String>,
}

impl<'a> StateStorageBuilder<'a> {
    pub fn from_config(project: &'a Project) -> Self {
        Self {
            project,
            clickhouse_config: None,
            redis_client: None,
            redis_url: None,
        }
    }

    /// Provide a ClickHouse config (for serverless migrations with remote ClickHouse)
    pub fn clickhouse_config(mut self, clickhouse_config: Option<ClickHouseConfig>) -> Self {
        self.clickhouse_config = clickhouse_config;
        self
    }

    /// Provide an existing Redis client (for moose dev/prod with background tasks)
    pub fn redis_client(mut self, redis_client: Option<&'a Arc<RedisClient>>) -> Self {
        self.redis_client = redis_client;
        self
    }

    /// Provide a Redis URL to create a new client (for serverless migrations)
    pub fn redis_url(mut self, redis_url: Option<String>) -> Self {
        self.redis_url = redis_url;
        self
    }

    pub async fn build(self) -> Result<Box<dyn StateStorage>> {
        match self.project.state_config.storage.as_str() {
            "clickhouse" => {
                let clickhouse_config = self.clickhouse_config.ok_or_else(|| {
                    anyhow::anyhow!(
                        "Internal error: ClickHouse state storage builder called without config. \
                         This should have been provided by the caller via .clickhouse_config(Some(...))."
                    )
                })?;

                let client = create_client(clickhouse_config.clone());
                check_ready(&client).await?;
                Ok(Box::new(ClickHouseStateStorage::new(
                    client,
                    clickhouse_config.db_name.clone(),
                )))
            }
            "redis" => {
                // Use provided client (for moose dev/prod with background tasks)
                if let Some(client) = self.redis_client {
                    return Ok(Box::new(RedisStateStorage::new(client.clone())));
                }

                // Otherwise, create from URL (for serverless migrations)
                let redis_url = self.redis_url.ok_or_else(|| {
                    anyhow::anyhow!(
                        "Internal error: Redis state storage builder called without URL. \
                         This should have been validated by the CLI layer."
                    )
                })?;

                use crate::infrastructure::redis::redis_client::{RedisClient, RedisConfig};
                use std::sync::Arc;

                let redis_config = RedisConfig {
                    url: redis_url,
                    key_prefix: self.project.redis_config.key_prefix.clone(),
                    ..Default::default()
                };
                let redis_client = Arc::new(
                    RedisClient::new("moose_state_storage".to_string(), redis_config).await?,
                );
                Ok(Box::new(RedisStateStorage::new(redis_client)))
            }
            _ => anyhow::bail!(
                "Unknown state storage backend '{}' in project configuration. \
                 Valid options are \"redis\" or \"clickhouse\"",
                self.project.state_config.storage
            ),
        }
    }
}
