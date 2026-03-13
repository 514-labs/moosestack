use kafka_protocol::messages::sync_group_response::SyncGroupResponse;
use kafka_protocol::messages::SyncGroupRequest;

use crate::broker::Broker;
use crate::groups::GroupState;

pub async fn handle(
    broker: &Broker,
    request: SyncGroupRequest,
    _api_version: i16,
) -> SyncGroupResponse {
    let mut response = SyncGroupResponse::default();
    let mut coordinator = broker.groups.write().await;

    let group = match coordinator.groups.get_mut(&request.group_id) {
        Some(g) => g,
        None => {
            response.error_code = 25; // UNKNOWN_MEMBER_ID (group not found)
            return response;
        }
    };

    if !group.members.contains_key(&request.member_id) {
        response.error_code = 25; // UNKNOWN_MEMBER_ID
        return response;
    }

    if request.generation_id != group.generation_id {
        response.error_code = 22; // ILLEGAL_GENERATION
        return response;
    }

    // If the requester is the leader, store assignments for all members
    if group.leader_id.as_ref() == Some(&request.member_id) {
        for assignment in &request.assignments {
            if let Some(member) = group.members.get_mut(&assignment.member_id) {
                member.assignment = assignment.assignment.clone();
            }
        }
        group.state = GroupState::Stable;
    }

    // Return this member's assignment
    if let Some(member) = group.members.get(&request.member_id) {
        response.assignment = member.assignment.clone();
    }

    response.error_code = 0;
    response.protocol_type = group.protocol_type.clone();
    response.protocol_name = group.protocol_name.clone();

    response
}
