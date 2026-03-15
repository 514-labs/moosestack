use std::time::Instant;

use bytes::Bytes;
use kafka_protocol::messages::join_group_response::{JoinGroupResponse, JoinGroupResponseMember};
use kafka_protocol::messages::JoinGroupRequest;
use kafka_protocol::protocol::StrBytes;

use crate::broker::Broker;
use crate::groups::{GroupMember, GroupState};

pub async fn handle(
    broker: &Broker,
    request: JoinGroupRequest,
    _api_version: i16,
) -> JoinGroupResponse {
    let mut response = JoinGroupResponse::default();
    let mut coordinator = broker.groups.write().await;

    let group = coordinator.get_or_create_group(request.group_id.clone());

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

    let session_timeout = request.session_timeout_ms;
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

    // Elect leader if needed
    if group.leader_id.is_none() {
        group.leader_id = Some(member_id.clone());
    }

    // Choose protocol
    group.protocol_name = group.choose_protocol();

    // Advance generation
    group.generation_id += 1;
    group.state = GroupState::CompletingRebalance;

    // Build response
    response.error_code = 0;
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
