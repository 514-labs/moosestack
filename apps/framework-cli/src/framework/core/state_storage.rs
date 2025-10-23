//! State storage abstraction for InfrastructureMap
//!
//! This module provides an abstraction over where Moose stores its infrastructure state.
//! State can be stored in Redis (traditional) or ClickHouse (for serverless/CLI-only deployments).

use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::olap::clickhouse::ConfiguredDBClient;
use crate::infrastructure::olap::clickhouse::{check_ready, create_client};
use crate::infrastructure::redis::redis_client::RedisClient;
use crate::project::Project;
use crate::utilities::machine_id::get_or_create_machine_id;
use anyhow::{Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use log::{debug, info, warn};
use protobuf::Message;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

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
}

/// Redis-based state storage
pub struct RedisStateStorage {
    client: Arc<RedisClient>,
}

impl RedisStateStorage {
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

    /// Try to acquire migration lock
    /// Must be manually released with release_migration_lock()
    /// Lock automatically expires after 5 minutes as a safety fallback
    pub async fn acquire_migration_lock(&self) -> Result<()> {
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

        if let Ok(Some(lock_json)) = cursor.next().await {
            // Lock exists - check if expired
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

        let insert_sql = format!(
            "INSERT INTO `{}`.`{}` (key, value) VALUES ('{}', '{}')",
            self.db_name,
            Self::STATE_TABLE,
            Self::LOCK_KEY,
            lock_json.replace('\'', "\\'")
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

    /// Release migration lock
    pub async fn release_migration_lock(&self) -> Result<()> {
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
            encoded_base64.replace('\'', "\\'")
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

        debug!("Loading infrastructure map from ClickHouse KeeperMap state table");

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
}

/// Builder for creating state storage based on project configuration.
///
/// Storage backend is determined by `state_config.storage` in moose.config.toml.
pub struct StateStorageBuilder<'a> {
    project: &'a Project,
    redis_client: Option<&'a Arc<RedisClient>>,
}

impl<'a> StateStorageBuilder<'a> {
    pub fn from_config(project: &'a Project) -> Self {
        Self {
            project,
            redis_client: None,
        }
    }

    pub fn redis_client(mut self, redis_client: Option<&'a Arc<RedisClient>>) -> Self {
        self.redis_client = redis_client;
        self
    }

    pub async fn build(self) -> Result<Box<dyn StateStorage>> {
        match self.project.state_config.storage.as_str() {
            "clickhouse" => {
                let client = create_client(self.project.clickhouse_config.clone());
                check_ready(&client).await?;
                Ok(Box::new(ClickHouseStateStorage::new(
                    client,
                    self.project.clickhouse_config.db_name.clone(),
                )))
            }
            "redis" => {
                let redis_client = self.redis_client
                    .ok_or_else(|| anyhow::anyhow!(
                        "Project configuration specifies Redis state storage (state_config.storage = \"redis\") \
                         but no Redis client was provided. Either provide a Redis client via .redis_client(Some(...)) \
                         or change state_config.storage to \"clickhouse\" in moose.config.toml"
                    ))?;
                Ok(Box::new(RedisStateStorage::new(redis_client.clone())))
            }
            _ => anyhow::bail!(
                "Unknown state storage backend '{}' in project configuration. \
                 Valid options are \"redis\" or \"clickhouse\"",
                self.project.state_config.storage
            ),
        }
    }
}
