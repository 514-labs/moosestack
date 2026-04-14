use std::time::Instant;

use bytes::Bytes;
use kafka_protocol::messages::join_group_response::{JoinGroupResponse, JoinGroupResponseMember};
use kafka_protocol::messages::JoinGroupRequest;
use kafka_protocol::protocol::StrBytes;

use crate::broker::Broker;
use crate::error;
use crate::groups::{GroupMember, GroupState};

/// Handle JoinGroup requests: generate member IDs, negotiate a common protocol,
/// elect a leader, and advance the group generation.
pub async fn handle(
    broker: &Broker,
    request: JoinGroupRequest,
    _api_version: i16,
) -> JoinGroupResponse {
    let mut response = JoinGroupResponse::default();
    let mut coordinator = broker.groups.write().await;

    let group = coordinator.get_or_create_group(request.group_id.clone());

    // Eagerly reap expired members before processing the join. Without this,
    // a dead leader lingers for up to session_timeout + reaper_interval. The
    // joining member wouldn't be elected leader and would receive an empty
    // partition assignment from SyncGroup, stalling consumption.
    let now = std::time::Instant::now();
    let expired: Vec<StrBytes> = group
        .members
        .iter()
        .filter(|(_, m)| {
            let timeout_ms = m.session_timeout_ms.max(0) as u128;
            now.duration_since(m.last_heartbeat).as_millis() > timeout_ms
        })
        .map(|(id, _)| id.clone())
        .collect();
    for id in expired {
        tracing::info!(group = %request.group_id.0, member = %id, "Reaping expired member during JoinGroup");
        group.remove_member(&id);
    }

    // Generate or reuse member_id
    let member_id = if request.member_id.is_empty() {
        StrBytes::from_string(format!("member-{}", uuid::Uuid::new_v4()))
    } else {
        request.member_id.clone()
    };

    // Build protocols list
    let protocols: Vec<(StrBytes, Bytes)> = request
        .protocols
        .iter()
        .map(|p| (p.name.clone(), p.metadata.clone()))
        .collect();

    // Clamp session timeout to at least 1s to prevent negative values from
    // wrapping to huge u128 values in the member reaper.
    let session_timeout = request.session_timeout_ms.max(1000);
    let rebalance_timeout = if request.rebalance_timeout_ms > 0 {
        request.rebalance_timeout_ms
    } else {
        session_timeout
    };

    // Add/update member
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

    // Set protocol type
    group.protocol_type = Some(request.protocol_type.clone());

    // Validate that all members share a common protocol. If not, roll back.
    if group.members.len() > 1 && group.choose_protocol().is_none() {
        group.remove_member(&member_id);
        response.error_code = error::INCONSISTENT_GROUP_PROTOCOL;
        return response;
    }

    // Elect leader if needed, or re-elect if the current leader is no longer a member
    // (e.g. it was reaped above but the leader_id wasn't cleared).
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

    // Choose protocol
    group.protocol_name = group.choose_protocol();

    // Advance generation only once per rebalance round. If the group is already
    // in CompletingRebalance (i.e. another member already triggered the bump in
    // this round), keep the same generation so all members see a consistent value.
    if group.state != GroupState::CompletingRebalance {
        group.generation_id += 1;
        group.state = GroupState::CompletingRebalance;
    }

    // Build response
    response.error_code = error::NONE;
    response.generation_id = group.generation_id;
    response.protocol_type = group.protocol_type.clone();
    response.protocol_name = group.protocol_name.clone();
    response.leader = group.leader_id.clone().unwrap_or_default();
    response.member_id = member_id.clone();

    // If this member is the leader, include all members
    if group.leader_id.as_ref() == Some(&member_id) {
        for (mid, m) in &group.members {
            let mut member_resp = JoinGroupResponseMember::default();
            member_resp.member_id = mid.clone();
            // Find metadata for chosen protocol
            if let Some(proto_name) = &group.protocol_name {
                if let Some((_, metadata)) = m.protocols.iter().find(|(n, _)| n == proto_name) {
                    member_resp.metadata = metadata.clone();
                }
            }
            response.members.push(member_resp);
        }
    }

    tracing::info!(
        group = %request.group_id.0,
        member = %member_id,
        generation = group.generation_id,
        leader = ?group.leader_id,
        "Member joined group"
    );

    response
}
