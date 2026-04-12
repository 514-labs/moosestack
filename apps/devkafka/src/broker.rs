use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use kafka_protocol::messages::{RequestKind, ResponseKind, TopicName};
use tokio::sync::RwLock;

use tokio_util::sync::CancellationToken;

use crate::error::BrokerError;
use crate::groups::GroupCoordinator;
use crate::handlers;
use crate::storage::TopicState;

/// Central state for the embedded Kafka broker.
///
/// Holds topic/partition storage, consumer group coordination, and broker
/// identity. All mutable state is behind `RwLock`s so that connections can
/// be served concurrently.
pub struct Broker {
    /// Kafka node identifier (always 1 for the single-node dev broker).
    pub node_id: i32,
    /// The host address the server listens on.
    #[allow(dead_code)]
    pub host: String,
    /// The host address advertised to clients in Metadata and FindCoordinator responses.
    /// When the listen address is `0.0.0.0` (all interfaces), we advertise `127.0.0.1`
    /// because `0.0.0.0` is not a valid address for clients to connect to.
    pub advertised_host: String,
    /// TCP port the broker listens on.
    pub port: u16,
    /// Unique cluster identifier, generated at startup.
    pub cluster_id: String,
    /// Number of partitions assigned to auto-created topics.
    pub default_partitions: i32,
    /// Topic name → topic storage (partitions with record batches).
    pub topics: Arc<RwLock<HashMap<TopicName, TopicState>>>,
    /// Consumer group coordination state (groups, committed offsets).
    pub groups: Arc<RwLock<GroupCoordinator>>,
    /// Monotonically increasing producer ID counter.
    pub next_producer_id: AtomicI64,
}

impl Broker {
    /// Create a new broker with the given listen address and partition defaults.
    pub fn new(host: String, port: u16, default_partitions: i32) -> Self {
        let advertised_host = if host == "0.0.0.0" {
            "127.0.0.1".to_string()
        } else {
            host.clone()
        };
        Self {
            node_id: 1,
            host,
            advertised_host,
            port,
            cluster_id: uuid::Uuid::new_v4().to_string(),
            default_partitions,
            topics: Arc::new(RwLock::new(HashMap::new())),
            groups: Arc::new(RwLock::new(GroupCoordinator::new())),
            next_producer_id: AtomicI64::new(1),
        }
    }

    /// Allocate the next unique producer ID.
    pub fn next_producer_id(&self) -> i64 {
        self.next_producer_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Dispatch a decoded Kafka request to the appropriate handler.
    pub async fn handle(
        &self,
        api_key: i16,
        api_version: i16,
        request: RequestKind,
    ) -> Result<ResponseKind, BrokerError> {
        match request {
            RequestKind::ApiVersions(req) => Ok(ResponseKind::ApiVersions(
                handlers::api_versions::handle(self, req, api_version),
            )),
            RequestKind::Metadata(req) => Ok(ResponseKind::Metadata(
                handlers::metadata::handle(self, req, api_version).await,
            )),
            RequestKind::CreateTopics(req) => Ok(ResponseKind::CreateTopics(
                handlers::create_topics::handle(self, req, api_version).await,
            )),
            RequestKind::DeleteTopics(req) => Ok(ResponseKind::DeleteTopics(
                handlers::delete_topics::handle(self, req, api_version).await,
            )),
            RequestKind::Produce(req) => Ok(ResponseKind::Produce(
                handlers::produce::handle(self, req, api_version).await,
            )),
            RequestKind::Fetch(req) => Ok(ResponseKind::Fetch(
                handlers::fetch::handle(self, req, api_version).await,
            )),
            RequestKind::ListOffsets(req) => Ok(ResponseKind::ListOffsets(
                handlers::list_offsets::handle(self, req, api_version).await,
            )),
            RequestKind::FindCoordinator(req) => Ok(ResponseKind::FindCoordinator(
                handlers::find_coordinator::handle(self, req, api_version),
            )),
            RequestKind::JoinGroup(req) => Ok(ResponseKind::JoinGroup(
                handlers::join_group::handle(self, req, api_version).await,
            )),
            RequestKind::SyncGroup(req) => Ok(ResponseKind::SyncGroup(
                handlers::sync_group::handle(self, req, api_version).await,
            )),
            RequestKind::Heartbeat(req) => Ok(ResponseKind::Heartbeat(
                handlers::heartbeat::handle(self, req, api_version).await,
            )),
            RequestKind::LeaveGroup(req) => Ok(ResponseKind::LeaveGroup(
                handlers::leave_group::handle(self, req, api_version).await,
            )),
            RequestKind::OffsetCommit(req) => Ok(ResponseKind::OffsetCommit(
                handlers::offset_commit::handle(self, req, api_version).await,
            )),
            RequestKind::OffsetFetch(req) => Ok(ResponseKind::OffsetFetch(
                handlers::offset_fetch::handle(self, req, api_version).await,
            )),
            RequestKind::InitProducerId(req) => Ok(ResponseKind::InitProducerId(
                handlers::init_producer_id::handle(self, req, api_version),
            )),
            RequestKind::DescribeGroups(req) => Ok(ResponseKind::DescribeGroups(
                handlers::describe_groups::handle(self, req, api_version).await,
            )),
            RequestKind::ListGroups(req) => Ok(ResponseKind::ListGroups(
                handlers::list_groups::handle(self, req, api_version).await,
            )),
            RequestKind::SaslHandshake(req) => Ok(ResponseKind::SaslHandshake(
                handlers::sasl_handshake::handle(self, req, api_version),
            )),
            RequestKind::SaslAuthenticate(req) => Ok(ResponseKind::SaslAuthenticate(
                handlers::sasl_authenticate::handle(self, req, api_version),
            )),
            _ => Err(BrokerError::UnsupportedApiKey {
                api_key,
                version: api_version,
            }),
        }
    }

    /// Spawn a background task that reaps expired group members every 5 seconds.
    ///
    /// Members with session timeouts shorter than 5 seconds may linger up to
    /// one sweep interval beyond their timeout. This is acceptable for a dev broker.
    pub fn spawn_reaper(self: &Arc<Self>, cancel: CancellationToken) {
        let groups = self.groups.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        groups.write().await.reap_expired_members();
                    }
                    _ = cancel.cancelled() => {
                        return;
                    }
                }
            }
        });
    }
}
