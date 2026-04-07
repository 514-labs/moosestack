use super::errors::NativeInfraError;
use crate::infrastructure::stream::kafka::models::KafkaConfig;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

/// Extract the broker port from the KafkaConfig broker string (e.g. "localhost:19092" -> 19092).
pub fn broker_port(config: &KafkaConfig) -> u16 {
    config
        .broker
        .rsplit(':')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(19092)
}

/// TCP health check on the broker port.
///
/// Uses a blocking `TcpStream::connect_timeout` which is acceptable here
/// since callers are in a synchronous polling loop.
pub fn health_check(port: u16) -> Result<(), NativeInfraError> {
    use std::net::TcpStream;
    use std::time::Duration;

    let addr = format!("127.0.0.1:{port}");
    let socket_addr: std::net::SocketAddr =
        addr.parse().map_err(|_| NativeInfraError::HealthCheck {
            service: "devkafka".to_string(),
            reason: format!("invalid address: {addr}"),
        })?;
    TcpStream::connect_timeout(&socket_addr, Duration::from_secs(2)).map_err(|_| {
        NativeInfraError::HealthCheck {
            service: "devkafka".to_string(),
            reason: format!("connection refused on port {port}"),
        }
    })?;

    Ok(())
}

/// Handle to an embedded devkafka server running as a tokio task.
pub struct DevKafkaHandle {
    cancel: CancellationToken,
}

impl DevKafkaHandle {
    /// Signal the embedded server to shut down (non-blocking).
    /// The tokio tasks will stop on their own once the cancellation propagates.
    pub fn signal_shutdown(&self) {
        self.cancel.cancel();
    }
}

/// Start devkafka as an embedded tokio task on the given host and port.
///
/// Binds the TCP listener before spawning so that bind errors are surfaced
/// immediately rather than silently failing in the background task.
pub async fn start_embedded(host: &str, port: u16) -> Result<DevKafkaHandle, NativeInfraError> {
    let cancel = CancellationToken::new();
    let broker = Arc::new(devkafka::broker::Broker::new(
        host.to_string(),
        port,
        1, // default partitions
    ));

    broker.spawn_reaper(cancel.clone());

    // Bind the listener here so failures propagate to the caller instead of
    // silently dying in the background task.
    let listener = TcpListener::bind(format!("{host}:{port}"))
        .await
        .map_err(|e| NativeInfraError::ProcessStart {
            name: "devkafka".to_string(),
            source: e,
        })?;

    let server_cancel = cancel.clone();
    tokio::spawn(async move {
        if let Err(e) = devkafka::server::run_with_listener(broker, listener, server_cancel).await {
            tracing::error!("embedded devkafka error: {e}");
        }
    });

    Ok(DevKafkaHandle { cancel })
}
