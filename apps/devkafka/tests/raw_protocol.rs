#![allow(dead_code)]

use std::sync::Arc;

use bytes::{BufMut, Bytes, BytesMut};
use kafka_protocol::messages::{ApiKey, RequestHeader, ResponseHeader};
use kafka_protocol::protocol::{Decodable, Encodable, StrBytes};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_util::sync::CancellationToken;

use devkafka::broker::Broker;
use devkafka::server;

/// Encode and send a Kafka request frame over an open test socket.
pub(crate) async fn send_request<E: Encodable>(
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

/// Read a Kafka response frame and decode its response header.
pub(crate) async fn read_response(
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

/// Lightweight devkafka test broker bound to an ephemeral localhost port.
pub(crate) struct TestBroker {
    port: u16,
    cancel: CancellationToken,
}

impl TestBroker {
    /// Start a broker and background reaper task for an integration test.
    pub(crate) async fn start() -> Self {
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

    /// Open a new client connection to the in-process test broker.
    pub(crate) async fn connect(&self) -> TcpStream {
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
