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
    /// Create a new `Shutdown` backed by the given broadcast receiver.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_shutdown_signal() {
        let (tx, rx) = broadcast::channel(1);
        let mut shutdown = Shutdown::new(rx);

        assert!(!shutdown.is_shutdown());
        tx.send(()).unwrap();
        shutdown.recv().await;
        assert!(shutdown.is_shutdown());
    }

    #[tokio::test]
    async fn test_shutdown_recv_idempotent() {
        let (tx, rx) = broadcast::channel(1);
        let mut shutdown = Shutdown::new(rx);

        tx.send(()).unwrap();
        shutdown.recv().await;
        // Second recv should return immediately.
        shutdown.recv().await;
        assert!(shutdown.is_shutdown());
    }
}
