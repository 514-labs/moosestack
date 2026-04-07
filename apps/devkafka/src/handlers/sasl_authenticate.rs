use bytes::Bytes;
use kafka_protocol::messages::SaslAuthenticateResponse;

use crate::broker::Broker;

/// Handle SaslAuthenticate requests.
///
/// The dev broker accepts any credentials — authentication always succeeds.
/// This allows Kafka clients that send SASL handshake/authenticate as part
/// of their connection setup to proceed without error.
pub fn handle(
    _broker: &Broker,
    _request: kafka_protocol::messages::SaslAuthenticateRequest,
    _api_version: i16,
) -> SaslAuthenticateResponse {
    let mut response = SaslAuthenticateResponse::default();
    response.error_code = 0;
    response.auth_bytes = Bytes::new();
    response.session_lifetime_ms = 0;
    response
}
