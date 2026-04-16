use kafka_protocol::messages::sync_group_response::SyncGroupResponse;
use kafka_protocol::messages::SyncGroupRequest;

use crate::broker::Broker;
use crate::error;
use crate::groups::GroupState;

fn build_sync_group_response(
    group: &crate::groups::ConsumerGroup,
    member_id: &kafka_protocol::protocol::StrBytes,
) -> SyncGroupResponse {
    let mut response = SyncGroupResponse::default();
    response.error_code = error::NONE;
    response.protocol_type = group.protocol_type.clone();
    response.protocol_name = group.protocol_name.clone();
    if let Some(member) = group.members.get(member_id) {
        response.assignment = member.assignment.clone();
    }
    response
}

/// Handle SyncGroup requests, distributing partition assignments from the leader
/// to all group members.
pub async fn handle(
    broker: &Broker,
    request: SyncGroupRequest,
    _api_version: i16,
) -> SyncGroupResponse {
    let deadline = {
        let coordinator = broker.groups.read().await;
        let group = match coordinator.groups.get(&request.group_id) {
            Some(group) => group,
            None => {
                let mut response = SyncGroupResponse::default();
                response.error_code = error::NOT_COORDINATOR;
                return response;
            }
        };

        let member = match group.members.get(&request.member_id) {
            Some(member) => member,
            None => {
                let mut response = SyncGroupResponse::default();
                response.error_code = error::UNKNOWN_MEMBER_ID;
                return response;
            }
        };

        if request.generation_id != group.generation_id {
            let mut response = SyncGroupResponse::default();
            response.error_code = error::ILLEGAL_GENERATION;
            return response;
        }

        std::time::Instant::now()
            + std::time::Duration::from_millis(member.rebalance_timeout_ms.max(1000) as u64)
    };

    let mut updates = {
        let coordinator = broker.groups.read().await;
        match coordinator.groups.get(&request.group_id) {
            Some(group) => group.state_updates.subscribe(),
            None => {
                let mut response = SyncGroupResponse::default();
                response.error_code = error::NOT_COORDINATOR;
                return response;
            }
        }
    };

    loop {
        let wait_duration = {
            let mut coordinator = broker.groups.write().await;
            let group = match coordinator.groups.get_mut(&request.group_id) {
                Some(group) => group,
                None => {
                    let mut response = SyncGroupResponse::default();
                    response.error_code = error::NOT_COORDINATOR;
                    return response;
                }
            };

            if !group.members.contains_key(&request.member_id) {
                let mut response = SyncGroupResponse::default();
                response.error_code = error::UNKNOWN_MEMBER_ID;
                return response;
            }

            if request.generation_id != group.generation_id {
                let mut response = SyncGroupResponse::default();
                response.error_code = error::ILLEGAL_GENERATION;
                return response;
            }

            if group.leader_id.as_ref() == Some(&request.member_id) {
                for member in group.members.values_mut() {
                    member.assignment = Default::default();
                }
                for assignment in &request.assignments {
                    if let Some(member) = group.members.get_mut(&assignment.member_id) {
                        member.assignment = assignment.assignment.clone();
                    }
                }
                group.mark_stable();
                return build_sync_group_response(group, &request.member_id);
            }

            if group.state == GroupState::Stable {
                return build_sync_group_response(group, &request.member_id);
            }

            let now = std::time::Instant::now();
            if now >= deadline {
                let mut response = SyncGroupResponse::default();
                response.error_code = error::REBALANCE_IN_PROGRESS;
                return response;
            }

            deadline.saturating_duration_since(now)
        };

        let _ = tokio::time::timeout(wait_duration, updates.changed()).await;
    }
}
