use kafka_protocol::messages::describe_groups_response::{
    DescribeGroupsResponse, DescribedGroup, DescribedGroupMember,
};
use kafka_protocol::messages::DescribeGroupsRequest;
use kafka_protocol::protocol::StrBytes;

use crate::broker::Broker;

/// Handle DescribeGroups requests, returning detailed info for each requested group.
pub async fn handle(
    broker: &Broker,
    request: DescribeGroupsRequest,
    _api_version: i16,
) -> DescribeGroupsResponse {
    let coordinator = broker.groups.read().await;

    let groups = request
        .groups
        .iter()
        .map(|group_id| {
            match coordinator.groups.get(group_id) {
                Some(group) => {
                    let members = group
                        .members
                        .values()
                        .map(|m| {
                            let mut member = DescribedGroupMember::default();
                            member.member_id = m.member_id.clone();
                            member.client_id = m.client_id.clone();
                            member.client_host = m.client_host.clone();
                            member.member_metadata = m
                                .protocols
                                .first()
                                .map(|(_, d)| d.clone())
                                .unwrap_or_default();
                            member.member_assignment = m.assignment.clone();
                            member
                        })
                        .collect();

                    let mut described = DescribedGroup::default();
                    described.error_code = 0;
                    described.group_id = group_id.clone();
                    described.group_state = StrBytes::from_static_str(group.state.as_str());
                    described.protocol_type = group
                        .protocol_type
                        .clone()
                        .unwrap_or_else(|| StrBytes::from_static_str(""));
                    described.protocol_data = group
                        .protocol_name
                        .clone()
                        .unwrap_or_else(|| StrBytes::from_static_str(""));
                    described.members = members;
                    described
                }
                None => {
                    // Kafka returns state "Dead" for non-existent groups.
                    let mut described = DescribedGroup::default();
                    described.error_code = 0;
                    described.group_id = group_id.clone();
                    described.group_state = StrBytes::from_static_str("Dead");
                    described.protocol_type = StrBytes::from_static_str("");
                    described.protocol_data = StrBytes::from_static_str("");
                    described
                }
            }
        })
        .collect();

    let mut response = DescribeGroupsResponse::default();
    response.groups = groups;
    response
}
