use std::sync::Arc;

use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, Semaphore};
use tracing::{debug, error, info};

use crate::cmd::Command;
use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
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

    /// Run the server, accepting connections in a loop.
    ///
    /// This only returns if the listener encounters an unrecoverable I/O error.
    /// Use [`Listener::shutdown`] to broadcast a shutdown signal to all active
    /// connections.
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

/// Extract the command name from a frame without consuming it.
fn peek_command_name(frame: &Frame) -> Option<String> {
    if let Frame::Array(parts) = frame {
        if let Some(Frame::Bulk(name)) = parts.first() {
            return String::from_utf8(name.to_vec())
                .ok()
                .map(|s| s.to_uppercase());
        }
    }
    None
}

impl Handler {
    /// Process a single connection.
    async fn run(&mut self) -> crate::Result<()> {
        // Buffered commands when inside a MULTI transaction.
        let mut tx_queue: Option<Vec<Frame>> = None;

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

            // Handle MULTI / EXEC / DISCARD before normal command dispatch.
            match peek_command_name(&frame).as_deref() {
                Some("MULTI") => {
                    let resp = if tx_queue.is_some() {
                        Frame::Error("ERR MULTI calls can not be nested".into())
                    } else {
                        tx_queue = Some(Vec::new());
                        Frame::Simple("OK".into())
                    };
                    self.connection.write_frame(&resp).await?;
                    continue;
                }
                Some("DISCARD") => {
                    let resp = if tx_queue.is_none() {
                        Frame::Error("ERR DISCARD without MULTI".into())
                    } else {
                        tx_queue = None;
                        Frame::Simple("OK".into())
                    };
                    self.connection.write_frame(&resp).await?;
                    continue;
                }
                Some("EXEC") => {
                    match tx_queue.take() {
                        Some(queue) => {
                            let mut results = Vec::with_capacity(queue.len());
                            for queued_frame in queue {
                                match Command::from_frame(queued_frame) {
                                    Ok(cmd) => {
                                        self.connection.start_capture();
                                        let _ = cmd
                                            .apply(
                                                &self.db,
                                                &mut self.connection,
                                                &mut self.shutdown,
                                            )
                                            .await?;
                                        let captured = self.connection.stop_capture();
                                        results.push(
                                            captured.into_iter().next().unwrap_or(Frame::NullBulk),
                                        );
                                    }
                                    Err(e) => {
                                        results.push(Frame::Error(format!("ERR {}", e)));
                                    }
                                }
                            }
                            self.connection.write_frame(&Frame::Array(results)).await?;
                        }
                        None => {
                            self.connection
                                .write_frame(&Frame::Error("ERR EXEC without MULTI".into()))
                                .await?;
                        }
                    }
                    continue;
                }
                _ => {}
            }

            // Inside a transaction: queue the frame and reply +QUEUED.
            if let Some(ref mut queue) = tx_queue {
                queue.push(frame);
                self.connection
                    .write_frame(&Frame::Simple("QUEUED".into()))
                    .await?;
                continue;
            }

            // Normal command execution.
            let cmd = match Command::from_frame(frame) {
                Ok(cmd) => cmd,
                Err(err) => {
                    let response = Frame::Error(format!("ERR {}", err));
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
