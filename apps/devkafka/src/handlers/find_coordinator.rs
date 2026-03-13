use kafka_protocol::messages::find_coordinator_response::FindCoordinatorResponse;
use kafka_protocol::messages::FindCoordinatorRequest;
use kafka_protocol::protocol::StrBytes;

use crate::broker::Broker;

pub fn handle(
    broker: &Broker,
    _request: FindCoordinatorRequest,
    _api_version: i16,
) -> FindCoordinatorResponse {
    let mut response = FindCoordinatorResponse::default();
    response.error_code = 0;
    response.node_id = broker.node_id.into();
    response.host = StrBytes::from_string(broker.advertised_host.clone());
    response.port = broker.port;
    response
}
