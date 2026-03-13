use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use kafka_protocol::messages::{RequestKind, ResponseKind, TopicName};
use tokio::sync::RwLock;

use crate::error::BrokerError;
use crate::groups::GroupCoordinator;
use crate::handlers;
use crate::storage::TopicState;

pub struct Broker {
    pub node_id: i32,
    #[allow(dead_code)]
    pub host: String,
    /// The host address advertised to clients in Metadata and FindCoordinator responses.
    /// When the listen address is `0.0.0.0` (all interfaces), we advertise `127.0.0.1`
    /// because `0.0.0.0` is not a valid address for clients to connect to.
    pub advertised_host: String,
    pub port: i32,
    pub cluster_id: String,
    pub default_partitions: i32,
    pub topics: Arc<RwLock<HashMap<TopicName, TopicState>>>,
    pub groups: Arc<RwLock<GroupCoordinator>>,
    pub next_producer_id: AtomicI64,
}

impl Broker {
    pub fn new(host: String, port: i32, default_partitions: i32) -> Self {
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

    pub fn next_producer_id(&self) -> i64 {
        self.next_producer_id.fetch_add(1, Ordering::Relaxed)
    }

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
            _ => Err(BrokerError::UnsupportedVersion {
                api_key,
                version: api_version,
            }),
        }
    }

    pub fn spawn_reaper(self: &Arc<Self>) {
        let groups = self.groups.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
            loop {
                interval.tick().await;
                groups.write().await.reap_expired_members();
            }
        });
    }
}
