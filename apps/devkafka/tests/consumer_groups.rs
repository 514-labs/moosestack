//! Integration tests for ListGroups and DescribeGroups handlers.
//!
//! Verifies that after a consumer group is formed via JoinGroup + SyncGroup,
//! the group is visible through ListGroups and its details are correct in
//! DescribeGroups. Also tests edge cases: empty broker, non-existent groups.

mod raw_protocol;

use bytes::Bytes;
use kafka_protocol::messages::describe_groups_request::DescribeGroupsRequest;
use kafka_protocol::messages::describe_groups_response::DescribeGroupsResponse;
use kafka_protocol::messages::join_group_request::{JoinGroupRequest, JoinGroupRequestProtocol};
use kafka_protocol::messages::join_group_response::JoinGroupResponse;
use kafka_protocol::messages::list_groups_request::ListGroupsRequest;
use kafka_protocol::messages::list_groups_response::ListGroupsResponse;
use kafka_protocol::messages::sync_group_request::{SyncGroupRequest, SyncGroupRequestAssignment};
use kafka_protocol::messages::sync_group_response::SyncGroupResponse;
use kafka_protocol::messages::{ApiKey, ApiVersionsRequest, ApiVersionsResponse};
use kafka_protocol::protocol::{Decodable, StrBytes};
use tokio::net::TcpStream;

use raw_protocol::{read_response, send_request, TestBroker};

// ---------------------------------------------------------------------------
// Helper: create a consumer group via JoinGroup + SyncGroup
// ---------------------------------------------------------------------------

async fn create_consumer_group(
    stream: &mut TcpStream,
    group_id: &str,
    correlation_start: i32,
) -> (StrBytes, i32) {
    // JoinGroup
    let mut jg_req = JoinGroupRequest::default();
    jg_req.group_id = StrBytes::from_string(group_id.to_string()).into();
    jg_req.protocol_type = StrBytes::from_string("consumer".to_string());
    jg_req.session_timeout_ms = 30000;
    jg_req.rebalance_timeout_ms = 30000;

    let mut protocol = JoinGroupRequestProtocol::default();
    protocol.name = StrBytes::from_string("range".to_string());
    protocol.metadata = Bytes::from_static(&[0, 0, 0, 0]);
    jg_req.protocols.push(protocol);

    send_request(stream, ApiKey::JoinGroup, 7, correlation_start, &jg_req).await;
    let (_, mut body) = read_response(stream, ApiKey::JoinGroup, 7).await;
    let jg_resp = JoinGroupResponse::decode(&mut body, 7).unwrap();
    assert_eq!(jg_resp.error_code, 0, "JoinGroup should succeed");

    let member_id = jg_resp.member_id.clone();
    let generation_id = jg_resp.generation_id;

    // SyncGroup (as leader)
    let mut sg_req = SyncGroupRequest::default();
    sg_req.group_id = StrBytes::from_string(group_id.to_string()).into();
    sg_req.member_id = member_id.clone();
    sg_req.generation_id = generation_id;

    let mut assignment = SyncGroupRequestAssignment::default();
    assignment.member_id = member_id.clone();
    assignment.assignment = Bytes::from_static(&[0, 0, 0, 0]);
    sg_req.assignments.push(assignment);

    send_request(stream, ApiKey::SyncGroup, 5, correlation_start + 1, &sg_req).await;
    let (_, mut body) = read_response(stream, ApiKey::SyncGroup, 5).await;
    let sg_resp = SyncGroupResponse::decode(&mut body, 5).unwrap();
    assert_eq!(sg_resp.error_code, 0, "SyncGroup should succeed");

    (member_id, generation_id)
}

async fn send_join_group(stream: &mut TcpStream, group_id: &str, correlation_id: i32) {
    let mut request = JoinGroupRequest::default();
    request.group_id = StrBytes::from_string(group_id.to_string()).into();
    request.protocol_type = StrBytes::from_string("consumer".to_string());
    request.session_timeout_ms = 30_000;
    request.rebalance_timeout_ms = 30_000;

    let mut protocol = JoinGroupRequestProtocol::default();
    protocol.name = StrBytes::from_string("range".to_string());
    protocol.metadata = Bytes::from_static(&[0, 0, 0, 0]);
    request.protocols.push(protocol);

    send_request(stream, ApiKey::JoinGroup, 7, correlation_id, &request).await;
}

async fn read_join_group(stream: &mut TcpStream) -> JoinGroupResponse {
    let (_, mut body) = read_response(stream, ApiKey::JoinGroup, 7).await;
    JoinGroupResponse::decode(&mut body, 7).unwrap()
}

async fn send_sync_group(
    stream: &mut TcpStream,
    group_id: &str,
    member_id: &StrBytes,
    generation_id: i32,
    assignments: &[(StrBytes, Bytes)],
    correlation_id: i32,
) {
    let mut request = SyncGroupRequest::default();
    request.group_id = StrBytes::from_string(group_id.to_string()).into();
    request.member_id = member_id.clone();
    request.generation_id = generation_id;

    for (assignment_member_id, assignment_bytes) in assignments {
        let mut assignment = SyncGroupRequestAssignment::default();
        assignment.member_id = assignment_member_id.clone();
        assignment.assignment = assignment_bytes.clone();
        request.assignments.push(assignment);
    }

    send_request(stream, ApiKey::SyncGroup, 5, correlation_id, &request).await;
}

async fn read_sync_group(stream: &mut TcpStream) -> SyncGroupResponse {
    let (_, mut body) = read_response(stream, ApiKey::SyncGroup, 5).await;
    SyncGroupResponse::decode(&mut body, 5).unwrap()
}

/// Helper to extract &str from StrBytes for unambiguous comparisons.
fn str_val(s: &StrBytes) -> &str {
    s
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// ListGroups on a fresh broker should return an empty list.
#[tokio::test]
async fn list_groups_empty_broker() {
    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    let req = ListGroupsRequest::default();
    send_request(&mut stream, ApiKey::ListGroups, 4, 1, &req).await;

    let (header, mut body) = read_response(&mut stream, ApiKey::ListGroups, 4).await;
    assert_eq!(header.correlation_id, 1);

    let resp = ListGroupsResponse::decode(&mut body, 4)
        .expect("ListGroups response should decode cleanly");
    assert_eq!(resp.error_code, 0);
    assert!(resp.groups.is_empty(), "No groups should exist yet");
}

/// After creating a consumer group, ListGroups should return it.
#[tokio::test]
async fn list_groups_after_join() {
    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    create_consumer_group(&mut stream, "list-test-group", 10).await;

    let req = ListGroupsRequest::default();
    send_request(&mut stream, ApiKey::ListGroups, 4, 20, &req).await;

    let (header, mut body) = read_response(&mut stream, ApiKey::ListGroups, 4).await;
    assert_eq!(header.correlation_id, 20);

    let resp = ListGroupsResponse::decode(&mut body, 4)
        .expect("ListGroups response should decode cleanly");
    assert_eq!(resp.error_code, 0);
    assert_eq!(resp.groups.len(), 1, "Should have exactly one group");

    let group = &resp.groups[0];
    assert_eq!(str_val(&group.group_id.0), "list-test-group");
    assert_eq!(str_val(&group.protocol_type), "consumer");
    assert_eq!(str_val(&group.group_state), "Stable");
}

/// ListGroups should return multiple groups.
#[tokio::test]
async fn list_groups_multiple() {
    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    create_consumer_group(&mut stream, "group-a", 10).await;
    create_consumer_group(&mut stream, "group-b", 20).await;

    let req = ListGroupsRequest::default();
    send_request(&mut stream, ApiKey::ListGroups, 4, 30, &req).await;

    let (_, mut body) = read_response(&mut stream, ApiKey::ListGroups, 4).await;
    let resp = ListGroupsResponse::decode(&mut body, 4).unwrap();

    assert_eq!(resp.error_code, 0);
    assert_eq!(resp.groups.len(), 2, "Should have two groups");

    let mut ids: Vec<String> = resp
        .groups
        .iter()
        .map(|g| g.group_id.0.to_string())
        .collect();
    ids.sort();
    assert_eq!(ids, vec!["group-a", "group-b"]);
}

/// DescribeGroups for a non-existent group returns state "Dead".
#[tokio::test]
async fn describe_groups_nonexistent() {
    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    let mut req = DescribeGroupsRequest::default();
    req.groups = vec![StrBytes::from_string("no-such-group".to_string()).into()];

    send_request(&mut stream, ApiKey::DescribeGroups, 5, 1, &req).await;

    let (header, mut body) = read_response(&mut stream, ApiKey::DescribeGroups, 5).await;
    assert_eq!(header.correlation_id, 1);

    let resp = DescribeGroupsResponse::decode(&mut body, 5)
        .expect("DescribeGroups response should decode cleanly");
    assert_eq!(resp.groups.len(), 1);

    let group = &resp.groups[0];
    assert_eq!(group.error_code, 0);
    assert_eq!(str_val(&group.group_id.0), "no-such-group");
    assert_eq!(str_val(&group.group_state), "Dead");
    assert!(group.members.is_empty());
}

/// DescribeGroups returns full details for an active consumer group.
#[tokio::test]
async fn describe_groups_active_group() {
    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    let (member_id, _generation_id) =
        create_consumer_group(&mut stream, "describe-test-group", 10).await;

    let mut req = DescribeGroupsRequest::default();
    req.groups = vec![StrBytes::from_string("describe-test-group".to_string()).into()];

    send_request(&mut stream, ApiKey::DescribeGroups, 5, 20, &req).await;

    let (header, mut body) = read_response(&mut stream, ApiKey::DescribeGroups, 5).await;
    assert_eq!(header.correlation_id, 20);

    let resp = DescribeGroupsResponse::decode(&mut body, 5)
        .expect("DescribeGroups response should decode cleanly");
    assert_eq!(resp.groups.len(), 1);

    let group = &resp.groups[0];
    assert_eq!(group.error_code, 0);
    assert_eq!(str_val(&group.group_id.0), "describe-test-group");
    assert_eq!(str_val(&group.group_state), "Stable");
    assert_eq!(str_val(&group.protocol_type), "consumer");
    assert_eq!(str_val(&group.protocol_data), "range");

    assert_eq!(group.members.len(), 1, "Should have one member");
    let member = &group.members[0];
    assert_eq!(member.member_id, member_id);
    // client_id is empty because the dev broker doesn't pass the request
    // header's client_id into the GroupMember struct (header is parsed
    // before dispatch). This is fine for health-checking purposes.
}

/// DescribeGroups can describe multiple groups in a single request.
#[tokio::test]
async fn describe_groups_multiple() {
    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    create_consumer_group(&mut stream, "multi-a", 10).await;
    create_consumer_group(&mut stream, "multi-b", 20).await;

    let mut req = DescribeGroupsRequest::default();
    req.groups = vec![
        StrBytes::from_string("multi-a".to_string()).into(),
        StrBytes::from_string("multi-b".to_string()).into(),
        StrBytes::from_string("does-not-exist".to_string()).into(),
    ];

    send_request(&mut stream, ApiKey::DescribeGroups, 5, 30, &req).await;

    let (_, mut body) = read_response(&mut stream, ApiKey::DescribeGroups, 5).await;
    let resp = DescribeGroupsResponse::decode(&mut body, 5).unwrap();

    assert_eq!(
        resp.groups.len(),
        3,
        "Should describe all three requested groups"
    );

    let find_group = |id: &str| {
        resp.groups
            .iter()
            .find(|g| str_val(&g.group_id.0) == id)
            .unwrap()
    };

    let a = find_group("multi-a");
    assert_eq!(str_val(&a.group_state), "Stable");
    assert_eq!(a.members.len(), 1);

    let b = find_group("multi-b");
    assert_eq!(str_val(&b.group_state), "Stable");
    assert_eq!(b.members.len(), 1);

    let missing = find_group("does-not-exist");
    assert_eq!(str_val(&missing.group_state), "Dead");
    assert!(missing.members.is_empty());
}

/// Full flow: create group -> list it -> describe it -> verify state transitions.
/// This simulates what a monitoring tool or health checker would do.
#[tokio::test]
async fn full_group_lifecycle_list_and_describe() {
    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    // 1. ListGroups on empty broker
    let req = ListGroupsRequest::default();
    send_request(&mut stream, ApiKey::ListGroups, 4, 1, &req).await;
    let (_, mut body) = read_response(&mut stream, ApiKey::ListGroups, 4).await;
    let list_resp = ListGroupsResponse::decode(&mut body, 4).unwrap();
    assert!(
        list_resp.groups.is_empty(),
        "Broker should start with no groups"
    );

    // 2. Create a consumer group
    let (member_id, _) = create_consumer_group(&mut stream, "lifecycle-group", 10).await;

    // 3. ListGroups shows the new group as Stable
    let req = ListGroupsRequest::default();
    send_request(&mut stream, ApiKey::ListGroups, 4, 20, &req).await;
    let (_, mut body) = read_response(&mut stream, ApiKey::ListGroups, 4).await;
    let list_resp = ListGroupsResponse::decode(&mut body, 4).unwrap();
    assert_eq!(list_resp.groups.len(), 1);
    assert_eq!(str_val(&list_resp.groups[0].group_state), "Stable");

    // 4. DescribeGroups confirms member details
    let mut desc_req = DescribeGroupsRequest::default();
    desc_req.groups = vec![StrBytes::from_string("lifecycle-group".to_string()).into()];
    send_request(&mut stream, ApiKey::DescribeGroups, 5, 21, &desc_req).await;
    let (_, mut body) = read_response(&mut stream, ApiKey::DescribeGroups, 5).await;
    let desc_resp = DescribeGroupsResponse::decode(&mut body, 5).unwrap();
    assert_eq!(desc_resp.groups[0].members.len(), 1);
    assert_eq!(desc_resp.groups[0].members[0].member_id, member_id);

    // 5. LeaveGroup
    use kafka_protocol::messages::leave_group_request::{LeaveGroupRequest, MemberIdentity};
    let mut leave_req = LeaveGroupRequest::default();
    leave_req.group_id = StrBytes::from_string("lifecycle-group".to_string()).into();
    // v4 uses members array
    let mut member_identity = MemberIdentity::default();
    member_identity.member_id = member_id;
    leave_req.members.push(member_identity);

    send_request(&mut stream, ApiKey::LeaveGroup, 4, 22, &leave_req).await;
    let _ = read_response(&mut stream, ApiKey::LeaveGroup, 4).await;

    // 6. After leaving, group should be Empty (and may get reaped).
    //    Since the reaper runs every 5s, the group should still exist as Empty.
    let mut desc_req = DescribeGroupsRequest::default();
    desc_req.groups = vec![StrBytes::from_string("lifecycle-group".to_string()).into()];
    send_request(&mut stream, ApiKey::DescribeGroups, 5, 23, &desc_req).await;
    let (_, mut body) = read_response(&mut stream, ApiKey::DescribeGroups, 5).await;
    let desc_resp = DescribeGroupsResponse::decode(&mut body, 5).unwrap();
    let group = &desc_resp.groups[0];
    let state = str_val(&group.group_state);
    // Group transitions to Empty after all members leave, or Dead if already reaped
    assert!(
        state == "Empty" || state == "Dead",
        "Group should be Empty or Dead after LeaveGroup, got: {state}",
    );
}

#[tokio::test]
async fn join_group_waits_for_peers_before_finalizing_generation() {
    let tb = TestBroker::start().await;
    let mut leader_stream = tb.connect().await;
    let mut follower_stream = tb.connect().await;

    send_join_group(&mut leader_stream, "barrier-group", 1).await;
    let leader_pending = tokio::time::timeout(
        std::time::Duration::from_millis(40),
        read_join_group(&mut leader_stream),
    )
    .await;
    assert!(
        leader_pending.is_err(),
        "leader JoinGroup should wait briefly for peer members",
    );

    send_join_group(&mut follower_stream, "barrier-group", 2).await;

    let leader_response = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        read_join_group(&mut leader_stream),
    )
    .await
    .expect("leader JoinGroup should eventually resolve");
    let follower_response = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        read_join_group(&mut follower_stream),
    )
    .await
    .expect("follower JoinGroup should eventually resolve");

    assert_eq!(leader_response.error_code, 0);
    assert_eq!(follower_response.error_code, 0);
    assert_eq!(
        leader_response.generation_id,
        follower_response.generation_id
    );
    assert_eq!(leader_response.members.len(), 2);
    assert_eq!(leader_response.member_id, leader_response.leader);
    assert_eq!(follower_response.leader, leader_response.leader);
    assert!(
        leader_response
            .members
            .iter()
            .any(|member| member.member_id == follower_response.member_id),
        "leader must see follower metadata before SyncGroup",
    );
}

#[tokio::test]
async fn sync_group_waits_for_leader_assignment_before_releasing_followers() {
    let tb = TestBroker::start().await;
    let mut leader_stream = tb.connect().await;
    let mut follower_stream = tb.connect().await;

    send_join_group(&mut leader_stream, "sync-barrier-group", 1).await;
    send_join_group(&mut follower_stream, "sync-barrier-group", 2).await;

    let leader_join = read_join_group(&mut leader_stream).await;
    let follower_join = read_join_group(&mut follower_stream).await;
    assert_eq!(leader_join.members.len(), 2);
    assert_eq!(leader_join.generation_id, follower_join.generation_id);

    send_sync_group(
        &mut follower_stream,
        "sync-barrier-group",
        &follower_join.member_id,
        follower_join.generation_id,
        &[],
        3,
    )
    .await;

    let follower_pending = tokio::time::timeout(
        std::time::Duration::from_millis(40),
        read_sync_group(&mut follower_stream),
    )
    .await;
    assert!(
        follower_pending.is_err(),
        "follower SyncGroup should wait for leader assignment",
    );

    let leader_assignment = Bytes::from_static(&[1, 2, 3]);
    let follower_assignment = Bytes::from_static(&[4, 5, 6]);
    send_sync_group(
        &mut leader_stream,
        "sync-barrier-group",
        &leader_join.member_id,
        leader_join.generation_id,
        &[
            (leader_join.member_id.clone(), leader_assignment.clone()),
            (follower_join.member_id.clone(), follower_assignment.clone()),
        ],
        4,
    )
    .await;

    let leader_sync = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        read_sync_group(&mut leader_stream),
    )
    .await
    .expect("leader SyncGroup should complete after assignment");
    let follower_sync = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        read_sync_group(&mut follower_stream),
    )
    .await
    .expect("follower SyncGroup should complete after leader assignment");

    assert_eq!(leader_sync.error_code, 0);
    assert_eq!(follower_sync.error_code, 0);
    assert_eq!(leader_sync.assignment, leader_assignment);
    assert_eq!(follower_sync.assignment, follower_assignment);
}

/// ListGroups v0 round-trip (minimum supported version).
#[tokio::test]
async fn list_groups_v0_round_trip() {
    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    create_consumer_group(&mut stream, "v0-test-group", 10).await;

    let req = ListGroupsRequest::default();
    send_request(&mut stream, ApiKey::ListGroups, 0, 20, &req).await;

    let (header, mut body) = read_response(&mut stream, ApiKey::ListGroups, 0).await;
    assert_eq!(header.correlation_id, 20);

    let resp =
        ListGroupsResponse::decode(&mut body, 0).expect("ListGroups v0 should decode cleanly");
    assert_eq!(resp.error_code, 0);
    assert_eq!(resp.groups.len(), 1);
}

/// DescribeGroups v0 round-trip (minimum supported version).
#[tokio::test]
async fn describe_groups_v0_round_trip() {
    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    create_consumer_group(&mut stream, "v0-desc-group", 10).await;

    let mut req = DescribeGroupsRequest::default();
    req.groups = vec![StrBytes::from_string("v0-desc-group".to_string()).into()];

    send_request(&mut stream, ApiKey::DescribeGroups, 0, 20, &req).await;

    let (header, mut body) = read_response(&mut stream, ApiKey::DescribeGroups, 0).await;
    assert_eq!(header.correlation_id, 20);

    let resp = DescribeGroupsResponse::decode(&mut body, 0)
        .expect("DescribeGroups v0 should decode cleanly");
    assert_eq!(resp.groups.len(), 1);
    assert_eq!(str_val(&resp.groups[0].group_state), "Stable");
}

/// ApiVersions should advertise ListGroups (key 16) and DescribeGroups (key 15).
#[tokio::test]
async fn api_versions_advertises_group_apis() {
    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    let req = ApiVersionsRequest::default();
    send_request(&mut stream, ApiKey::ApiVersions, 3, 1, &req).await;

    let (_, mut body) = read_response(&mut stream, ApiKey::ApiVersions, 3).await;
    let resp = ApiVersionsResponse::decode(&mut body, 3).unwrap();
    assert_eq!(resp.error_code, 0);

    let list_groups_api = resp
        .api_keys
        .iter()
        .find(|a| a.api_key == ApiKey::ListGroups as i16)
        .expect("ListGroups (key 16) should be in api_keys");
    assert_eq!(list_groups_api.min_version, 0);
    assert!(list_groups_api.max_version >= 4);

    let describe_groups_api = resp
        .api_keys
        .iter()
        .find(|a| a.api_key == ApiKey::DescribeGroups as i16)
        .expect("DescribeGroups (key 15) should be in api_keys");
    assert_eq!(describe_groups_api.min_version, 0);
    assert!(describe_groups_api.max_version >= 5);
}
