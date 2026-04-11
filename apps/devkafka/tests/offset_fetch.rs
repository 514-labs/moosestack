//! Integration tests for the OffsetFetch handler.
//!
//! Reproduces ENG-2727: when a client sends OffsetFetch at the versions
//! devkafka advertises, the response must round-trip correctly through the
//! kafka-protocol codec.  The bug manifests as a "read buffer underflow"
//! on the client side because the response is encoded for the wrong wire
//! format when api_version >= 8 (groups-based layout vs topic-based).

use std::sync::Arc;

use bytes::{BufMut, Bytes, BytesMut};
use kafka_protocol::messages::offset_commit_request::{
    OffsetCommitRequest, OffsetCommitRequestPartition, OffsetCommitRequestTopic,
};
use kafka_protocol::messages::offset_fetch_request::{
    OffsetFetchRequest, OffsetFetchRequestGroup, OffsetFetchRequestTopic, OffsetFetchRequestTopics,
};
use kafka_protocol::messages::offset_fetch_response::OffsetFetchResponse;
use kafka_protocol::messages::{
    ApiKey, ApiVersionsRequest, ApiVersionsResponse, RequestHeader, ResponseHeader,
};
use kafka_protocol::protocol::{Decodable, Encodable, StrBytes};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_util::sync::CancellationToken;

use devkafka::broker::Broker;
use devkafka::server;

// ---------------------------------------------------------------------------
// Helpers
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
// Helper: commit an offset so we have something to fetch
// ---------------------------------------------------------------------------

async fn commit_offset(
    stream: &mut TcpStream,
    group: &str,
    topic: &str,
    partition: i32,
    offset: i64,
) {
    let api_version: i16 = 8;
    let mut req = OffsetCommitRequest::default();
    req.group_id = StrBytes::from_string(group.to_string()).into();

    let mut topic_req = OffsetCommitRequestTopic::default();
    topic_req.name = StrBytes::from_string(topic.to_string()).into();

    let mut part_req = OffsetCommitRequestPartition::default();
    part_req.partition_index = partition;
    part_req.committed_offset = offset;
    topic_req.partitions.push(part_req);
    req.topics.push(topic_req);

    send_request(stream, ApiKey::OffsetCommit, api_version, 100, &req).await;
    let _ = read_response(stream, ApiKey::OffsetCommit, api_version).await;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn api_versions_advertises_offset_fetch() {
    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    let req = ApiVersionsRequest::default();
    send_request(&mut stream, ApiKey::ApiVersions, 3, 1, &req).await;

    let (header, mut body) = read_response(&mut stream, ApiKey::ApiVersions, 3).await;
    assert_eq!(header.correlation_id, 1);

    let resp = ApiVersionsResponse::decode(&mut body, 3).unwrap();
    assert_eq!(resp.error_code, 0);

    let offset_fetch_api = resp
        .api_keys
        .iter()
        .find(|a| a.api_key == ApiKey::OffsetFetch as i16)
        .expect("OffsetFetch should be in api_keys");

    assert!(
        offset_fetch_api.max_version >= 7,
        "OffsetFetch max_version should be >= 7, got {}",
        offset_fetch_api.max_version
    );
}

/// OffsetFetch v7 (topic-based format) should round-trip correctly.
#[tokio::test]
async fn offset_fetch_v7_round_trip() {
    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    commit_offset(&mut stream, "test-group", "test-topic", 0, 42).await;

    let api_version: i16 = 7;
    let mut req = OffsetFetchRequest::default();
    req.group_id = StrBytes::from_string("test-group".to_string()).into();

    let mut topic = OffsetFetchRequestTopic::default();
    topic.name = StrBytes::from_string("test-topic".to_string()).into();
    topic.partition_indexes = vec![0];
    req.topics = Some(vec![topic]);

    send_request(&mut stream, ApiKey::OffsetFetch, api_version, 2, &req).await;

    let (header, mut body) = read_response(&mut stream, ApiKey::OffsetFetch, api_version).await;
    assert_eq!(header.correlation_id, 2);

    let resp = OffsetFetchResponse::decode(&mut body, api_version)
        .expect("OffsetFetch v7 response should decode cleanly");

    assert_eq!(resp.error_code, 0);
    assert_eq!(resp.topics.len(), 1);
    assert_eq!(resp.topics[0].partitions.len(), 1);
    assert_eq!(resp.topics[0].partitions[0].committed_offset, 42);
}

/// OffsetFetch v8 (groups-based format) — reproduces the ENG-2727 "read
/// buffer underflow".
///
/// v8 uses `groups[]` instead of `group_id + topics[]`. The handler must
/// populate `response.groups` so the v8 encoder has the right data.
#[tokio::test]
async fn offset_fetch_v8_round_trip() {
    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    commit_offset(&mut stream, "test-group-v8", "test-topic", 0, 99).await;

    let api_version: i16 = 8;
    let mut req = OffsetFetchRequest::default();

    let mut group = OffsetFetchRequestGroup::default();
    group.group_id = StrBytes::from_string("test-group-v8".to_string()).into();

    let mut topic = OffsetFetchRequestTopics::default();
    topic.name = StrBytes::from_string("test-topic".to_string()).into();
    topic.partition_indexes = vec![0];
    group.topics = Some(vec![topic]);
    req.groups = vec![group];

    send_request(&mut stream, ApiKey::OffsetFetch, api_version, 3, &req).await;

    let (header, mut body) = read_response(&mut stream, ApiKey::OffsetFetch, api_version).await;
    assert_eq!(header.correlation_id, 3);

    // This decode fails before the fix — "read buffer underflow"
    let resp = OffsetFetchResponse::decode(&mut body, api_version)
        .expect("OffsetFetch v8 response should decode cleanly");

    // v8 uses groups[] instead of topics[]
    assert_eq!(resp.groups.len(), 1, "should have 1 group in response");
    let group_resp = &resp.groups[0];
    assert_eq!(group_resp.topics.len(), 1, "should have 1 topic in group");
    assert_eq!(
        group_resp.topics[0].partitions.len(),
        1,
        "should have 1 partition"
    );
    assert_eq!(
        group_resp.topics[0].partitions[0].committed_offset, 99,
        "committed offset should be 99"
    );
}

/// OffsetFetch v7 returns -1 for uncommitted partitions.
#[tokio::test]
async fn offset_fetch_v7_uncommitted_returns_minus_one() {
    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    let api_version: i16 = 7;
    let mut req = OffsetFetchRequest::default();
    req.group_id = StrBytes::from_string("empty-group".to_string()).into();

    let mut topic = OffsetFetchRequestTopic::default();
    topic.name = StrBytes::from_string("no-such-topic".to_string()).into();
    topic.partition_indexes = vec![0];
    req.topics = Some(vec![topic]);

    send_request(&mut stream, ApiKey::OffsetFetch, api_version, 4, &req).await;

    let (_, mut body) = read_response(&mut stream, ApiKey::OffsetFetch, api_version).await;
    let resp = OffsetFetchResponse::decode(&mut body, api_version)
        .expect("OffsetFetch v7 response should decode");

    assert_eq!(resp.topics.len(), 1);
    assert_eq!(resp.topics[0].partitions[0].committed_offset, -1);
}

/// Full consumer flow: FindCoordinator → JoinGroup → SyncGroup → OffsetFetch.
/// Simulates what the moose streaming function runner does.
#[tokio::test]
async fn full_consumer_group_flow_with_offset_fetch() {
    use kafka_protocol::messages::find_coordinator_request::FindCoordinatorRequest;
    use kafka_protocol::messages::find_coordinator_response::FindCoordinatorResponse;
    use kafka_protocol::messages::join_group_request::{
        JoinGroupRequest, JoinGroupRequestProtocol,
    };
    use kafka_protocol::messages::join_group_response::JoinGroupResponse;
    use kafka_protocol::messages::sync_group_request::{
        SyncGroupRequest, SyncGroupRequestAssignment,
    };
    use kafka_protocol::messages::sync_group_response::SyncGroupResponse;

    let tb = TestBroker::start().await;
    let mut stream = tb.connect().await;

    // 1. FindCoordinator
    let mut fc_req = FindCoordinatorRequest::default();
    fc_req.key = StrBytes::from_string("flow-group".to_string());
    fc_req.key_type = 0;
    send_request(&mut stream, ApiKey::FindCoordinator, 3, 10, &fc_req).await;
    let (_, mut body) = read_response(&mut stream, ApiKey::FindCoordinator, 3).await;
    let fc_resp = FindCoordinatorResponse::decode(&mut body, 3).unwrap();
    assert_eq!(fc_resp.error_code, 0);

    // 2. JoinGroup
    let mut jg_req = JoinGroupRequest::default();
    jg_req.group_id = StrBytes::from_string("flow-group".to_string()).into();
    jg_req.protocol_type = StrBytes::from_string("consumer".to_string());
    jg_req.session_timeout_ms = 30000;
    jg_req.rebalance_timeout_ms = 30000;

    let mut protocol = JoinGroupRequestProtocol::default();
    protocol.name = StrBytes::from_string("range".to_string());
    protocol.metadata = Bytes::from_static(&[0, 0, 0, 0]);
    jg_req.protocols.push(protocol);

    send_request(&mut stream, ApiKey::JoinGroup, 7, 11, &jg_req).await;
    let (_, mut body) = read_response(&mut stream, ApiKey::JoinGroup, 7).await;
    let jg_resp = JoinGroupResponse::decode(&mut body, 7).unwrap();
    assert_eq!(jg_resp.error_code, 0);
    let member_id = jg_resp.member_id.clone();
    let generation_id = jg_resp.generation_id;

    // 3. SyncGroup (as leader)
    let mut sg_req = SyncGroupRequest::default();
    sg_req.group_id = StrBytes::from_string("flow-group".to_string()).into();
    sg_req.member_id = member_id.clone();
    sg_req.generation_id = generation_id;

    let mut assignment = SyncGroupRequestAssignment::default();
    assignment.member_id = member_id;
    assignment.assignment = Bytes::from_static(&[0, 0, 0, 0]);
    sg_req.assignments.push(assignment);

    send_request(&mut stream, ApiKey::SyncGroup, 5, 12, &sg_req).await;
    let (_, mut body) = read_response(&mut stream, ApiKey::SyncGroup, 5).await;
    let sg_resp = SyncGroupResponse::decode(&mut body, 5).unwrap();
    assert_eq!(sg_resp.error_code, 0);

    // 4. OffsetFetch v7 — the request moose makes after joining the group
    let mut of_req = OffsetFetchRequest::default();
    of_req.group_id = StrBytes::from_string("flow-group".to_string()).into();
    let mut topic = OffsetFetchRequestTopic::default();
    topic.name = StrBytes::from_string("test-topic".to_string()).into();
    topic.partition_indexes = vec![0];
    of_req.topics = Some(vec![topic]);

    send_request(&mut stream, ApiKey::OffsetFetch, 7, 13, &of_req).await;
    let (_, mut body) = read_response(&mut stream, ApiKey::OffsetFetch, 7).await;
    let of_resp = OffsetFetchResponse::decode(&mut body, 7)
        .expect("OffsetFetch v7 in consumer flow should decode");
    assert_eq!(of_resp.error_code, 0);
    assert_eq!(of_resp.topics.len(), 1);
    assert_eq!(of_resp.topics[0].partitions[0].committed_offset, -1);
}
