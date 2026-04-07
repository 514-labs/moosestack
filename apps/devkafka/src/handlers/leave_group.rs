use kafka_protocol::messages::leave_group_response::{LeaveGroupResponse, MemberResponse};
use kafka_protocol::messages::LeaveGroupRequest;

use crate::broker::Broker;

pub async fn handle(
    broker: &Broker,
    request: LeaveGroupRequest,
    api_version: i16,
) -> LeaveGroupResponse {
    let mut response = LeaveGroupResponse::default();
    let mut coordinator = broker.groups.write().await;

    let group = match coordinator.groups.get_mut(&request.group_id) {
        Some(g) => g,
        None => {
            response.error_code = 25; // UNKNOWN_MEMBER_ID
            return response;
        }
    };

    // v3+ uses members list, older versions use member_id field
    if api_version >= 3 {
        for member in &request.members {
            let mut member_resp = MemberResponse::default();
            member_resp.member_id = member.member_id.clone();
            if group.members.contains_key(&member.member_id) {
                group.remove_member(&member.member_id);
                member_resp.error_code = 0;
                tracing::info!(group = %request.group_id.0, member = %member.member_id, "Member left group");
            } else {
                member_resp.error_code = 25; // UNKNOWN_MEMBER_ID
            }
            response.members.push(member_resp);
        }
        response.error_code = 0;
    } else if group.members.contains_key(&request.member_id) {
        group.remove_member(&request.member_id);
        response.error_code = 0;
        tracing::info!(group = %request.group_id.0, member = %request.member_id, "Member left group");
    } else {
        response.error_code = 25;
    }

    response
}
