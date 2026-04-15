use std::time::Instant;

use bytes::Bytes;
use kafka_protocol::messages::join_group_response::{JoinGroupResponse, JoinGroupResponseMember};
use kafka_protocol::messages::JoinGroupRequest;
use kafka_protocol::protocol::StrBytes;

use crate::broker::Broker;
use crate::error;
use crate::groups::{GroupMember, GroupState};

const JOIN_GROUP_QUIET_PERIOD_MS: u64 = 75;

fn build_join_group_response(
    group: &crate::groups::ConsumerGroup,
    member_id: &StrBytes,
) -> JoinGroupResponse {
    let mut response = JoinGroupResponse::default();
    response.error_code = error::NONE;
    response.generation_id = group.generation_id;
    response.protocol_type = group.protocol_type.clone();
    response.protocol_name = group.protocol_name.clone();
    response.leader = group.leader_id.clone().unwrap_or_default();
    response.member_id = member_id.clone();

    if group.leader_id.as_ref() == Some(member_id) {
        for (mid, member) in &group.members {
            let mut member_resp = JoinGroupResponseMember::default();
            member_resp.member_id = mid.clone();
            if let Some(protocol_name) = &group.protocol_name {
                if let Some((_, metadata)) = member
                    .protocols
                    .iter()
                    .find(|(name, _)| name == protocol_name)
                {
                    member_resp.metadata = metadata.clone();
                }
            }
            response.members.push(member_resp);
        }
    }

    response
}

/// Handle JoinGroup requests: generate member IDs, negotiate a common protocol,
/// elect a leader, and advance the group generation.
pub async fn handle(
    broker: &Broker,
    request: JoinGroupRequest,
    _api_version: i16,
) -> JoinGroupResponse {
    let now = std::time::Instant::now();
    let member_id;
    let mut updates;

    {
        let mut coordinator = broker.groups.write().await;
        let group = coordinator.get_or_create_group(request.group_id.clone());

        // Eagerly reap expired members before processing the join. Without this,
        // a dead leader lingers for up to session_timeout + reaper_interval. The
        // joining member wouldn't be elected leader and would receive an empty
        // partition assignment from SyncGroup, stalling consumption.
        group.reap_expired_members(now, "join_group");

        member_id = if request.member_id.is_empty() {
            StrBytes::from_string(format!("member-{}", uuid::Uuid::new_v4()))
        } else {
            request.member_id.clone()
        };

        let protocols: Vec<(StrBytes, Bytes)> = request
            .protocols
            .iter()
            .map(|p| (p.name.clone(), p.metadata.clone()))
            .collect();

        let session_timeout = request.session_timeout_ms.max(1000);
        let rebalance_timeout = if request.rebalance_timeout_ms > 0 {
            request.rebalance_timeout_ms
        } else {
            session_timeout
        };

        let member = GroupMember {
            member_id: member_id.clone(),
            client_id: StrBytes::from_static_str(""),
            client_host: StrBytes::from_static_str(""),
            protocol_type: request.protocol_type.clone(),
            protocols,
            assignment: Bytes::new(),
            session_timeout_ms: session_timeout,
            rebalance_timeout_ms: rebalance_timeout,
            last_heartbeat: Instant::now(),
        };
        group.members.insert(member_id.clone(), member);
        group.protocol_type = Some(request.protocol_type.clone());

        if group.members.len() > 1 && group.choose_protocol().is_none() {
            group.remove_member(&member_id, now);
            let mut response = JoinGroupResponse::default();
            response.error_code = error::INCONSISTENT_GROUP_PROTOCOL;
            return response;
        }

        if group.leader_id.is_none()
            || !group.members.contains_key(
                group
                    .leader_id
                    .as_ref()
                    .map_or(&member_id, |leader_id| leader_id),
            )
        {
            group.leader_id = Some(member_id.clone());
        }

        group.prepare_rebalance(now, rebalance_timeout);
        updates = group.state_updates.subscribe();
    }

    let quiet_period = std::time::Duration::from_millis(JOIN_GROUP_QUIET_PERIOD_MS);

    loop {
        let wait_duration = {
            let mut coordinator = broker.groups.write().await;
            let group = match coordinator.groups.get_mut(&request.group_id) {
                Some(group) => group,
                None => {
                    let mut response = JoinGroupResponse::default();
                    response.error_code = error::NOT_COORDINATOR;
                    return response;
                }
            };

            if !group.members.contains_key(&member_id) {
                let mut response = JoinGroupResponse::default();
                response.error_code = error::UNKNOWN_MEMBER_ID;
                return response;
            }

            let now = Instant::now();
            if group.should_finalize_rebalance(now, quiet_period) {
                group.finalize_rebalance();
            }

            if group.state == GroupState::CompletingRebalance {
                tracing::info!(
                    group = %request.group_id.0,
                    member = %member_id,
                    generation = group.generation_id,
                    leader = ?group.leader_id,
                    "Member joined group"
                );
                return build_join_group_response(group, &member_id);
            }

            group.rebalance_wait_duration(now, quiet_period)
        };

        let _ = tokio::time::timeout(wait_duration, updates.changed()).await;
    }
}
