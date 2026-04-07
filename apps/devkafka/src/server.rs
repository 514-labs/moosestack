use std::sync::Arc;

use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

use crate::broker::Broker;
use crate::connection;

/// Run the broker server, accepting connections indefinitely.
pub async fn run(broker: Arc<Broker>, host: &str, port: u16) -> anyhow::Result<()> {
    run_until(broker, host, port, CancellationToken::new()).await
}

/// Run the broker server until the given cancellation token is cancelled.
pub async fn run_until(
    broker: Arc<Broker>,
    host: &str,
    port: u16,
    cancel: CancellationToken,
) -> anyhow::Result<()> {
    let listener = TcpListener::bind(format!("{host}:{port}")).await?;
    tracing::info!("Listening on {}:{}", host, port);

    loop {
        tokio::select! {
            result = listener.accept() => {
                let (stream, addr) = result?;
                let broker = broker.clone();
                tracing::debug!(peer = %addr, "New connection");
                tokio::spawn(async move {
                    if let Err(e) = connection::handle_connection(broker, stream, addr).await {
                        tracing::debug!(peer = %addr, error = %e, "Connection closed");
                    }
                });
            }
            _ = cancel.cancelled() => {
                tracing::info!("Cancellation received, stopping server");
                return Ok(());
            }
        }
    }
}
