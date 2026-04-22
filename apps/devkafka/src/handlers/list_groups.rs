use kafka_protocol::messages::list_groups_response::{ListGroupsResponse, ListedGroup};
use kafka_protocol::messages::ListGroupsRequest;
use kafka_protocol::protocol::StrBytes;

use crate::broker::Broker;

/// Handle ListGroups requests, returning all known consumer groups.
pub async fn handle(
    broker: &Broker,
    _request: ListGroupsRequest,
    _api_version: i16,
) -> ListGroupsResponse {
    let coordinator = broker.groups.read().await;

    let groups = coordinator
        .groups
        .values()
        .map(|group| {
            let mut listed = ListedGroup::default();
            listed.group_id = group.group_id.clone();
            listed.protocol_type = group
                .protocol_type
                .clone()
                .unwrap_or_else(|| StrBytes::from_static_str(""));
            listed.group_state = StrBytes::from_static_str(group.state.as_str());
            listed
        })
        .collect();

    let mut response = ListGroupsResponse::default();
    response.error_code = 0;
    response.groups = groups;
    response
}
