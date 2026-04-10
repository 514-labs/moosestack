use std::time::Instant;

use kafka_protocol::messages::heartbeat_response::HeartbeatResponse;
use kafka_protocol::messages::HeartbeatRequest;

use crate::broker::Broker;
use crate::error;

/// Handle Heartbeat requests, updating member liveness in consumer groups.
pub async fn handle(
    broker: &Broker,
    request: HeartbeatRequest,
    _api_version: i16,
) -> HeartbeatResponse {
    let mut response = HeartbeatResponse::default();
    let mut coordinator = broker.groups.write().await;

    let group = match coordinator.groups.get_mut(&request.group_id) {
        Some(g) => g,
        None => {
            response.error_code = error::NOT_COORDINATOR;
            return response;
        }
    };

    if request.generation_id != group.generation_id {
        response.error_code = error::ILLEGAL_GENERATION;
        return response;
    }

    match group.members.get_mut(&request.member_id) {
        Some(member) => {
            member.last_heartbeat = Instant::now();
            response.error_code = error::NONE;
        }
        None => {
            response.error_code = error::UNKNOWN_MEMBER_ID;
        }
    }

    response
}
