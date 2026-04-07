use std::sync::Arc;

use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, Semaphore};
use tracing::{debug, error, info};

use crate::cmd::Command;
use crate::connection::Connection;
use crate::db::Db;
use crate::shutdown::Shutdown;

/// Maximum number of concurrent connections.
const MAX_CONNECTIONS: usize = 1024;

/// Server listener state.
pub struct Listener {
    db: Db,
    listener: TcpListener,
    /// Broadcast shutdown signal to all active connections.
    notify_shutdown: broadcast::Sender<()>,
    /// Limits the number of active connections.
    limit_connections: Arc<Semaphore>,
}

/// Per-connection handler.
struct Handler {
    db: Db,
    connection: Connection,
    shutdown: Shutdown,
    _limit_guard: tokio::sync::OwnedSemaphorePermit,
}

impl Listener {
    /// Create a new server listener.
    pub fn new(listener: TcpListener, db: Db) -> Listener {
        let (notify_shutdown, _) = broadcast::channel(1);
        Listener {
            db,
            listener,
            notify_shutdown,
            limit_connections: Arc::new(Semaphore::new(MAX_CONNECTIONS)),
        }
    }

    /// Run the server, accepting connections until shutdown.
    pub async fn run(&self) -> crate::Result<()> {
        info!("accepting connections");

        loop {
            // Wait for a permit before accepting.
            let permit = self
                .limit_connections
                .clone()
                .acquire_owned()
                .await
                .unwrap();

            let socket = self.accept().await?;

            // Create per-connection handler.
            let mut handler = Handler {
                db: self.db.clone(),
                connection: Connection::new(socket),
                shutdown: Shutdown::new(self.notify_shutdown.subscribe()),
                _limit_guard: permit,
            };

            // Spawn a new task to handle the connection.
            tokio::spawn(async move {
                if let Err(err) = handler.run().await {
                    error!(cause = %err, "connection error");
                }
            });
        }
    }

    /// Accept a new TCP connection and set TCP_NODELAY.
    async fn accept(&self) -> crate::Result<TcpStream> {
        let (socket, addr) = self.listener.accept().await?;
        socket.set_nodelay(true)?;
        debug!("accepted connection from {}", addr);
        Ok(socket)
    }

    /// Initiate graceful shutdown.
    pub fn shutdown(&self) {
        self.db.shutdown();
        let _ = self.notify_shutdown.send(());
    }
}

impl Handler {
    /// Process a single connection.
    async fn run(&mut self) -> crate::Result<()> {
        while !self.shutdown.is_shutdown() {
            // Read a frame, or return None on clean shutdown / disconnect.
            let maybe_frame = tokio::select! {
                res = self.connection.read_frame() => res?,
                _ = self.shutdown.recv() => {
                    return Ok(());
                }
            };

            let frame = match maybe_frame {
                Some(frame) => frame,
                None => return Ok(()),
            };

            debug!(?frame);

            let cmd = match Command::from_frame(frame) {
                Ok(cmd) => cmd,
                Err(err) => {
                    let response = crate::frame::Frame::Error(format!("ERR {}", err));
                    self.connection.write_frame(&response).await?;
                    continue;
                }
            };

            let should_close = cmd
                .apply(&self.db, &mut self.connection, &mut self.shutdown)
                .await?;

            if should_close {
                return Ok(());
            }
        }

        Ok(())
    }
}
