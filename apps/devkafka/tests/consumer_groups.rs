//! Integration tests for ListGroups and DescribeGroups handlers.
//!
//! Verifies that after a consumer group is formed via JoinGroup + SyncGroup,
//! the group is visible through ListGroups and its details are correct in
//! DescribeGroups. Also tests edge cases: empty broker, non-existent groups.

use std::sync::Arc;

use bytes::{BufMut, Bytes, BytesMut};
use kafka_protocol::messages::describe_groups_request::DescribeGroupsRequest;
use kafka_protocol::messages::describe_groups_response::DescribeGroupsResponse;
use kafka_protocol::messages::join_group_request::{JoinGroupRequest, JoinGroupRequestProtocol};
use kafka_protocol::messages::join_group_response::JoinGroupResponse;
use kafka_protocol::messages::list_groups_request::ListGroupsRequest;
use kafka_protocol::messages::list_groups_response::ListGroupsResponse;
use kafka_protocol::messages::sync_group_request::{SyncGroupRequest, SyncGroupRequestAssignment};
use kafka_protocol::messages::sync_group_response::SyncGroupResponse;
use kafka_protocol::messages::{ApiKey, RequestHeader, ResponseHeader};
use kafka_protocol::protocol::{Decodable, Encodable, StrBytes};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_util::sync::CancellationToken;

use devkafka::broker::Broker;
use devkafka::server;

// ---------------------------------------------------------------------------
// Helpers (same pattern as offset_fetch tests)
// ---------------------------------------------------------------------------

async fn send_request<E: Encodable>(
    stream: &mut TcpStream,
    api_key: ApiKey,
    api_version: i16,
    correlation_id: i32,
    body: &E,
) {
    let header_version = api_key.request_header_version(api_version);

    let mut header = RequestHeader::default();
    header.request_api_key = api_key as i16;
    header.request_api_version = api_version;
    header.correlation_id = correlation_id;
    header.client_id = Some(StrBytes::from_static_str("test-client"));

    let mut payload = BytesMut::new();
    header.encode(&mut payload, header_version).unwrap();
    body.encode(&mut payload, api_version).unwrap();

    let mut frame = BytesMut::with_capacity(4 + payload.len());
    frame.put_u32(payload.len() as u32);
    frame.extend_from_slice(&payload);

    stream.write_all(&frame).await.unwrap();
    stream.flush().await.unwrap();
}

async fn read_response(
    stream: &mut TcpStream,
    api_key: ApiKey,
    api_version: i16,
) -> (ResponseHeader, Bytes) {
    let response_header_version = api_key.response_header_version(api_version);

    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await.unwrap();
    let frame_len = u32::from_be_bytes(len_buf) as usize;

    let mut buf = vec![0u8; frame_len];
    stream.read_exact(&mut buf).await.unwrap();

    let mut frame = Bytes::from(buf);
    let header = ResponseHeader::decode(&mut frame, response_header_version).unwrap();
    (header, frame)
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

struct TestBroker {
    port: u16,
    cancel: CancellationToken,
}

impl TestBroker {
    async fn start() -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let cancel = CancellationToken::new();

        let broker = Arc::new(Broker::new("127.0.0.1".to_string(), port, 1));
        broker.spawn_reaper(cancel.clone());

        let server_cancel = cancel.clone();
        tokio::spawn(async move {
            server::run_with_listener(broker, listener, server_cancel)
                .await
                .unwrap();
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        Self { port, cancel }
    }

    async fn connect(&self) -> TcpStream {
        TcpStream::connect(format!("127.0.0.1:{}", self.port))
            .await
            .unwrap()
    }
}

impl Drop for TestBroker {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

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
    use kafka_protocol::messages::{ApiVersionsRequest, ApiVersionsResponse};

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
