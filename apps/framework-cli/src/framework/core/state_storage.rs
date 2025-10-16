//! State storage abstraction for InfrastructureMap
//!
//! This module provides an abstraction over where Moose stores its infrastructure state.
//! State can be stored in Redis (traditional) or ClickHouse (for serverless/CLI-only deployments).

use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::infrastructure::olap::clickhouse::ConfiguredDBClient;
use crate::infrastructure::olap::clickhouse::{check_ready, create_client};
use crate::infrastructure::redis::redis_client::RedisClient;
use crate::project::Project;
use anyhow::{Context, Result};
use async_trait::async_trait;
use log::{debug, info};
use protobuf::Message;
use std::sync::Arc;

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
    const STATE_KEY: &'static str = "infrastructure_map";

    pub fn new(client: ConfiguredDBClient, db_name: String) -> Self {
        Self { client, db_name }
    }

    /// Ensure the state table exists
    async fn ensure_state_table(&self) -> Result<()> {
        let create_table_sql = format!(
            r#"
            CREATE TABLE IF NOT EXISTS `{}`.`{}`
            (
                key String,
                value String,
                updated_at DateTime DEFAULT now()
            )
            ENGINE = ReplacingMergeTree(updated_at)
            ORDER BY key
            "#,
            self.db_name,
            Self::STATE_TABLE
        );

        debug!("Creating state table: {}", create_table_sql);

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

        // Insert or update the state
        let insert_sql = format!(
            r#"
            INSERT INTO `{}`.`{}`
            (key, value, updated_at)
            VALUES ('{}', '{}', now())
            "#,
            self.db_name,
            Self::STATE_TABLE,
            Self::STATE_KEY,
            encoded_base64
        );

        debug!("Storing infrastructure map in ClickHouse state table");

        self.client
            .client
            .query(&insert_sql)
            .execute()
            .await
            .context("Failed to store infrastructure map in ClickHouse")?;

        info!("✓ Stored infrastructure map in ClickHouse");

        Ok(())
    }

    async fn load_infrastructure_map(&self) -> Result<Option<InfrastructureMap>> {
        // Ensure table exists first
        self.ensure_state_table().await?;

        // Query for the latest state
        let query_sql = format!(
            r#"
            SELECT value
            FROM `{}`.`{}`
            WHERE key = '{}'
            ORDER BY updated_at DESC
            LIMIT 1
            "#,
            self.db_name,
            Self::STATE_TABLE,
            Self::STATE_KEY
        );

        debug!("Loading infrastructure map from ClickHouse state table");

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

        info!("✓ Loaded infrastructure map from ClickHouse");

        Ok(Some(infra_map))
    }
}

/// Creates the appropriate state storage implementation based on project configuration
pub async fn create_state_storage(
    project: &Project,
    redis_client: &Arc<RedisClient>,
) -> Result<Box<dyn StateStorage>> {
    match project.state_config.storage.as_str() {
        "clickhouse" => {
            let client = create_client(project.clickhouse_config.clone());
            check_ready(&client).await?;
            Ok(Box::new(ClickHouseStateStorage::new(
                client,
                project.clickhouse_config.db_name.clone(),
            )))
        }
        _ => Ok(Box::new(RedisStateStorage::new(redis_client.clone()))),
    }
}
