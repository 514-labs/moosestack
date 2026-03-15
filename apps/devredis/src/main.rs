use tokio::net::TcpListener;
use tracing::info;

#[tokio::main]
async fn main() -> devredis::Result<()> {
    // Initialize tracing.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("devredis=info")),
        )
        .init();

    // Read port from environment, default to 6379.
    let port: u16 = std::env::var("DEVREDIS_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(6379);

    let listener = TcpListener::bind(format!("127.0.0.1:{}", port)).await?;
    info!("devredis listening on 127.0.0.1:{}", port);

    let db = devredis::db::Db::new();
    let server = devredis::server::Listener::new(listener, db);

    // Handle ctrl-c for graceful shutdown.
    let shutdown_handle = tokio::spawn({
        async move {
            tokio::signal::ctrl_c()
                .await
                .expect("failed to listen for ctrl-c");
            info!("shutting down");
        }
    });

    tokio::select! {
        result = server.run() => {
            if let Err(err) = result {
                tracing::error!(cause = %err, "server error");
            }
        }
        _ = shutdown_handle => {
            server.shutdown();
        }
    }

    Ok(())
}
