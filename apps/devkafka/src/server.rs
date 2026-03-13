use std::sync::Arc;

use tokio::net::TcpListener;

use crate::broker::Broker;
use crate::connection;

pub async fn run(broker: Arc<Broker>, host: &str, port: u16) -> anyhow::Result<()> {
    let listener = TcpListener::bind(format!("{host}:{port}")).await?;
    tracing::info!("Listening on {}:{}", host, port);

    loop {
        let (stream, addr) = listener.accept().await?;
        let broker = broker.clone();
        tracing::debug!(peer = %addr, "New connection");
        tokio::spawn(async move {
            if let Err(e) = connection::handle_connection(broker, stream, addr).await {
                tracing::debug!(peer = %addr, error = %e, "Connection closed");
            }
        });
    }
}
