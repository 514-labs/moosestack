use kafka_protocol::messages::init_producer_id_response::InitProducerIdResponse;
use kafka_protocol::messages::InitProducerIdRequest;

use crate::broker::Broker;

pub fn handle(
    broker: &Broker,
    _request: InitProducerIdRequest,
    _api_version: i16,
) -> InitProducerIdResponse {
    let mut response = InitProducerIdResponse::default();
    response.error_code = 0;
    response.producer_id = kafka_protocol::messages::ProducerId(broker.next_producer_id());
    response.producer_epoch = 0;
    response
}
