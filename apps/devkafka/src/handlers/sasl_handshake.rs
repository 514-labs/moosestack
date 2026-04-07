use kafka_protocol::messages::SaslHandshakeResponse;
use kafka_protocol::protocol::StrBytes;

use crate::broker::Broker;

/// Handle SaslHandshake requests.
///
/// The dev broker does not require authentication. We advertise PLAIN as a
/// supported mechanism so that clients configured with SASL can proceed, but
/// no credentials are actually validated.
pub fn handle(
    _broker: &Broker,
    _request: kafka_protocol::messages::SaslHandshakeRequest,
    _api_version: i16,
) -> SaslHandshakeResponse {
    let mut response = SaslHandshakeResponse::default();
    response.error_code = 0;
    response.mechanisms = vec![StrBytes::from_static_str("PLAIN")];
    response
}
