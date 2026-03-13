use kafka_protocol::messages::api_versions_response::{ApiVersion, ApiVersionsResponse};

use crate::broker::Broker;

pub fn handle(
    _broker: &Broker,
    _request: kafka_protocol::messages::ApiVersionsRequest,
    _api_version: i16,
) -> ApiVersionsResponse {
    let mut response = ApiVersionsResponse::default();
    response.error_code = 0;

    let apis: Vec<(i16, i16, i16)> = vec![
        (0, 3, 9),  // Produce
        (1, 4, 13), // Fetch
        (2, 0, 7),  // ListOffsets
        (3, 1, 12), // Metadata
        (8, 2, 8),  // OffsetCommit
        (9, 1, 8),  // OffsetFetch
        (10, 0, 4), // FindCoordinator
        (11, 0, 9), // JoinGroup
        (12, 0, 4), // Heartbeat
        (13, 0, 5), // LeaveGroup
        (14, 0, 5), // SyncGroup
        (18, 0, 3), // ApiVersions
        (19, 0, 7), // CreateTopics
        (20, 0, 6), // DeleteTopics
        (22, 0, 4), // InitProducerId
    ];

    for (key, min_ver, max_ver) in apis {
        let mut api_version = ApiVersion::default();
        api_version.api_key = key;
        api_version.min_version = min_ver;
        api_version.max_version = max_ver;
        response.api_keys.push(api_version);
    }

    response
}
