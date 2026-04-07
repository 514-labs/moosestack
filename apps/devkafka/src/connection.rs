use std::net::SocketAddr;
use std::sync::Arc;

use bytes::{Buf, BufMut, Bytes, BytesMut};
use kafka_protocol::messages::{ApiKey, RequestHeader, RequestKind, ResponseHeader, ResponseKind};
use kafka_protocol::protocol::{Decodable, Encodable};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::broker::Broker;
use crate::error::{BrokerError, ConnectionError};

/// Maximum frame size (8 MiB). Frames larger than this are rejected to prevent
/// unbounded memory growth from a misbehaving client.
const MAX_FRAME_SIZE: usize = 8 * 1024 * 1024;

/// Read Kafka protocol frames from a TCP connection and dispatch them to the broker.
///
/// Each frame is decoded, dispatched via [`Broker::handle`], and the response is
/// written back. The connection is closed on any unrecoverable error.
pub async fn handle_connection(
    broker: Arc<Broker>,
    mut stream: TcpStream,
    addr: SocketAddr,
) -> Result<(), ConnectionError> {
    let mut read_buf = BytesMut::with_capacity(8192);

    loop {
        while read_buf.len() < 4 {
            let n = stream.read_buf(&mut read_buf).await?;
            if n == 0 {
                return Ok(());
            }
        }

        let frame_size =
            u32::from_be_bytes([read_buf[0], read_buf[1], read_buf[2], read_buf[3]]) as usize;

        if frame_size > MAX_FRAME_SIZE {
            return Err(ConnectionError::FrameTooLarge {
                size: frame_size,
                max: MAX_FRAME_SIZE,
            });
        }

        while read_buf.len() < 4 + frame_size {
            let n = stream.read_buf(&mut read_buf).await?;
            if n == 0 {
                return Err(ConnectionError::ClosedMidFrame);
            }
        }

        read_buf.advance(4);
        let frame_bytes = read_buf.split_to(frame_size);

        if frame_bytes.len() < 4 {
            return Err(ConnectionError::FrameTooSmall(frame_bytes.len()));
        }
        let api_key_raw = i16::from_be_bytes([frame_bytes[0], frame_bytes[1]]);
        let api_version = i16::from_be_bytes([frame_bytes[2], frame_bytes[3]]);

        tracing::trace!(peer = %addr, api_key = api_key_raw, api_version, frame_size, "Request");

        // Convert to Bytes for kafka-protocol decoder
        let mut frame: Bytes = frame_bytes.freeze();

        // Use the protocol-defined header version for all API keys.
        let request_header_version = ApiKey::try_from(api_key_raw)
            .map(|k| k.request_header_version(api_version))
            .unwrap_or(1);

        let header = RequestHeader::decode(&mut frame, request_header_version)
            .map_err(|e| ConnectionError::Decode(e.into()))?;
        let correlation_id = header.correlation_id;

        tracing::trace!(
            peer = %addr,
            correlation_id,
            client_id = ?header.client_id,
            "Decoded header"
        );

        let api_key_enum = ApiKey::try_from(api_key_raw).map_err(|_| {
            ConnectionError::Decode(format!("unknown API key: {api_key_raw}").into())
        })?;
        let request = RequestKind::decode(api_key_enum, &mut frame, api_version)
            .map_err(|e| ConnectionError::Decode(e.into()))?;

        let response = broker.handle(api_key_raw, api_version, request).await;

        // For Produce with acks=0, the handler returns an empty response as a sentinel
        // to signal that no response should be sent (fire-and-forget mode).
        if api_key_raw == ApiKey::Produce as i16 {
            if let Ok(ResponseKind::Produce(ref resp)) = response {
                if resp.responses.is_empty() {
                    continue;
                }
            }
        }

        let response_body = match response {
            Ok(body) => body,
            Err(BrokerError::UnsupportedApiKey { api_key, version }) => {
                // Send a minimal response (header-only) so the client can
                // match the correlation_id and report an error for this
                // specific request.  Previously this path used `continue`
                // which silently swallowed the response, corrupting the
                // protocol stream.
                tracing::warn!(
                    peer = %addr,
                    api_key,
                    version,
                    "Unsupported API key, sending header-only error response"
                );

                let response_header_version = ApiKey::try_from(api_key_raw)
                    .map(|k| k.response_header_version(api_version))
                    .unwrap_or(0);

                let mut resp_header = ResponseHeader::default();
                resp_header.correlation_id = correlation_id;

                let mut resp_buf = BytesMut::new();
                resp_header
                    .encode(&mut resp_buf, response_header_version)
                    .map_err(|e| ConnectionError::Decode(e.into()))?;

                let mut out = BytesMut::with_capacity(4 + resp_buf.len());
                out.put_u32(resp_buf.len() as u32);
                out.extend_from_slice(&resp_buf);

                stream.write_all(&out).await?;
                stream.flush().await?;
                continue;
            }
            Err(e) => {
                tracing::warn!(
                    peer = %addr,
                    api_key = api_key_raw,
                    api_version,
                    error = %e,
                    "Handler error, closing connection"
                );
                return Err(ConnectionError::Handler(e));
            }
        };

        {
            let response_header_version = ApiKey::try_from(api_key_raw)
                .map(|k| k.response_header_version(api_version))
                .unwrap_or(0);

            let mut resp_header = ResponseHeader::default();
            resp_header.correlation_id = correlation_id;

            let mut resp_buf = BytesMut::new();
            resp_header
                .encode(&mut resp_buf, response_header_version)
                .map_err(|e| ConnectionError::Decode(e.into()))?;
            response_body
                .encode(&mut resp_buf, api_version)
                .map_err(|e| ConnectionError::Decode(e.into()))?;

            let mut out = BytesMut::with_capacity(4 + resp_buf.len());
            out.put_u32(resp_buf.len() as u32);
            out.extend_from_slice(&resp_buf);

            stream.write_all(&out).await?;
            stream.flush().await?;
        }
    }
}
