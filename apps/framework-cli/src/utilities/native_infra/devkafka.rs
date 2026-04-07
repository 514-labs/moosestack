use super::errors::NativeInfraError;
use crate::infrastructure::stream::kafka::models::KafkaConfig;
use std::sync::Arc;
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
pub fn health_check(port: u16) -> Result<(), NativeInfraError> {
    use std::net::TcpStream;
    use std::time::Duration;

    let addr = format!("127.0.0.1:{port}");
    TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_secs(2)).map_err(|_| {
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
pub fn start_embedded(host: &str, port: u16) -> Result<DevKafkaHandle, NativeInfraError> {
    let cancel = CancellationToken::new();
    let broker = Arc::new(devkafka::broker::Broker::new(
        host.to_string(),
        port as i32,
        1, // default partitions
    ));

    broker.spawn_reaper(cancel.clone());

    let server_cancel = cancel.clone();
    let server_host = host.to_string();
    tokio::spawn(async move {
        if let Err(e) = devkafka::server::run_until(broker, &server_host, port, server_cancel).await
        {
            tracing::error!("embedded devkafka error: {e}");
        }
    });

    Ok(DevKafkaHandle { cancel })
}
