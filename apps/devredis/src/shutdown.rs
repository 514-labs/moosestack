use tokio::sync::broadcast;

/// Listens for the server shutdown signal.
///
/// Wraps a `broadcast::Receiver`. When `recv()` returns, the server is shutting
/// down and the connection handler should clean up.
pub struct Shutdown {
    shutdown: bool,
    notify: broadcast::Receiver<()>,
}

impl Shutdown {
    pub fn new(notify: broadcast::Receiver<()>) -> Shutdown {
        Shutdown {
            shutdown: false,
            notify,
        }
    }

    /// Returns `true` if the shutdown signal has been received.
    pub fn is_shutdown(&self) -> bool {
        self.shutdown
    }

    /// Receive the shutdown notice, waiting if necessary.
    pub async fn recv(&mut self) {
        if self.shutdown {
            return;
        }
        // This can return an error if all senders are dropped.
        let _ = self.notify.recv().await;
        self.shutdown = true;
    }
}
