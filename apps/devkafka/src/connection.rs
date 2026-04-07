use std::net::SocketAddr;
use std::sync::Arc;

use bytes::{Buf, BufMut, Bytes, BytesMut};
use kafka_protocol::messages::{ApiKey, RequestHeader, RequestKind, ResponseHeader, ResponseKind};
use kafka_protocol::protocol::{Decodable, Encodable};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::broker::Broker;

pub async fn handle_connection(
    broker: Arc<Broker>,
    mut stream: TcpStream,
    addr: SocketAddr,
) -> anyhow::Result<()> {
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

        while read_buf.len() < 4 + frame_size {
            let n = stream.read_buf(&mut read_buf).await?;
            if n == 0 {
                return Err(anyhow::anyhow!("connection closed mid-frame"));
            }
        }

        read_buf.advance(4);
        let frame_bytes = read_buf.split_to(frame_size);

        if frame_bytes.len() < 4 {
            return Err(anyhow::anyhow!("frame too small"));
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

        let header = RequestHeader::decode(&mut frame, request_header_version)?;
        let correlation_id = header.correlation_id;

        tracing::trace!(
            peer = %addr,
            correlation_id,
            client_id = ?header.client_id,
            "Decoded header"
        );

        let api_key_enum = ApiKey::try_from(api_key_raw)
            .map_err(|_| anyhow::anyhow!("unknown API key: {}", api_key_raw))?;
        let request = RequestKind::decode(api_key_enum, &mut frame, api_version)?;

        let response = broker.handle(api_key_raw, api_version, request).await;

        // For Produce with acks=0, skip sending response
        if api_key_raw == ApiKey::Produce as i16 {
            if let Ok(ResponseKind::Produce(ref resp)) = response {
                if resp.responses.is_empty() {
                    continue;
                }
            }
        }

        match response {
            Ok(response_body) => {
                let response_header_version = ApiKey::try_from(api_key_raw)
                    .map(|k| k.response_header_version(api_version))
                    .unwrap_or(0);

                let mut resp_header = ResponseHeader::default();
                resp_header.correlation_id = correlation_id;

                let mut resp_buf = BytesMut::new();
                resp_header.encode(&mut resp_buf, response_header_version)?;
                response_body.encode(&mut resp_buf, api_version)?;

                let mut out = BytesMut::with_capacity(4 + resp_buf.len());
                out.put_u32(resp_buf.len() as u32);
                out.extend_from_slice(&resp_buf);

                stream.write_all(&out).await?;
                stream.flush().await?;
            }
            Err(e) => {
                tracing::warn!(
                    peer = %addr,
                    api_key = api_key_raw,
                    api_version,
                    error = %e,
                    "Handler error, dropping request"
                );
            }
        }
    }
}
