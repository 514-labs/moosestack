use std::sync::Arc;

use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

use crate::broker::Broker;
use crate::connection;

/// Run the broker server, accepting connections indefinitely.
pub async fn run(broker: Arc<Broker>, host: &str, port: u16) -> std::io::Result<()> {
    run_until(broker, host, port, CancellationToken::new()).await
}

/// Run the broker server until the given cancellation token is cancelled.
pub async fn run_until(
    broker: Arc<Broker>,
    host: &str,
    port: u16,
    cancel: CancellationToken,
) -> std::io::Result<()> {
    let listener = TcpListener::bind(format!("{host}:{port}")).await?;
    accept_loop(broker, listener, cancel).await
}

/// Run the broker server with a pre-bound listener until cancelled.
///
/// This is useful when the caller needs to verify that binding succeeded
/// before spawning the server as a background task.
pub async fn run_with_listener(
    broker: Arc<Broker>,
    listener: TcpListener,
    cancel: CancellationToken,
) -> std::io::Result<()> {
    accept_loop(broker, listener, cancel).await
}

async fn accept_loop(
    broker: Arc<Broker>,
    listener: TcpListener,
    cancel: CancellationToken,
) -> std::io::Result<()> {
    tracing::info!(addr = %listener.local_addr()?, "Listening");

    loop {
        tokio::select! {
            result = listener.accept() => {
                let (stream, addr) = match result {
                    Ok(conn) => conn,
                    Err(e) => {
                        tracing::warn!(error = %e, "Failed to accept connection, continuing");
                        continue;
                    }
                };
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
