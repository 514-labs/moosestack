use std::sync::Arc;

use clap::Parser;

use devkafka::broker;
use devkafka::server;

#[derive(Parser)]
#[command(name = "devkafka", about = "Minimal Kafka-compatible dev broker")]
struct Cli {
    /// Host to bind to
    #[arg(long, default_value = "0.0.0.0")]
    host: String,

    /// Port to listen on
    #[arg(short, long, default_value_t = 9092)]
    port: u16,

    /// Default number of partitions for auto-created topics
    #[arg(long, default_value_t = 1)]
    default_partitions: i32,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    let broker = Arc::new(broker::Broker::new(
        cli.host.clone(),
        cli.port as i32,
        cli.default_partitions,
    ));

    broker.spawn_reaper(tokio_util::sync::CancellationToken::new());

    tracing::info!(host = %cli.host, port = %cli.port, "devkafka starting");

    // Graceful shutdown on SIGTERM/SIGINT
    let shutdown = async {
        let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to register SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                tracing::info!("Received SIGINT, shutting down");
            }
            _ = sigterm.recv() => {
                tracing::info!("Received SIGTERM, shutting down");
            }
        }
    };

    tokio::select! {
        result = server::run(broker, &cli.host, cli.port) => {
            result?;
        }
        _ = shutdown => {}
    }

    Ok(())
}
