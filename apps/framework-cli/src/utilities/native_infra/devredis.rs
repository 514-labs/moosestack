use super::errors::NativeInfraError;
use std::sync::Arc;

/// TCP health check on the Redis port.
pub fn health_check(port: u16) -> Result<(), NativeInfraError> {
    use std::net::TcpStream;
    use std::time::Duration;

    let addr = format!("127.0.0.1:{port}");
    TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_secs(2)).map_err(|_| {
        NativeInfraError::HealthCheck {
            service: "devredis".to_string(),
            reason: format!("connection refused on port {port}"),
        }
    })?;

    Ok(())
}

/// Handle to an embedded devredis server running as a tokio task.
pub struct DevRedisHandle {
    listener: Arc<devredis::server::Listener>,
}

impl DevRedisHandle {
    /// Signal the embedded server to shut down (non-blocking).
    /// The tokio task will stop on its own once the shutdown signal propagates.
    pub fn signal_shutdown(&self) {
        self.listener.shutdown();
    }
}

/// Start devredis as an embedded tokio task on the given port.
pub async fn start_embedded(port: u16) -> Result<DevRedisHandle, NativeInfraError> {
    let tcp_listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .map_err(|e| NativeInfraError::ProcessStart {
            name: "devredis".to_string(),
            source: e,
        })?;

    let db = devredis::db::Db::new();
    let listener = Arc::new(devredis::server::Listener::new(tcp_listener, db));

    let run_listener = listener.clone();
    tokio::spawn(async move {
        if let Err(e) = run_listener.run().await {
            tracing::error!("embedded devredis error: {e}");
        }
    });

    Ok(DevRedisHandle { listener })
}
