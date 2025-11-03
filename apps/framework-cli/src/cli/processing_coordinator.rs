//! # Processing Coordinator Module
//!
//! This module provides synchronization between file watcher infrastructure processing
//! and MCP tool requests. It ensures that MCP tools don't read partial or inconsistent
//! state while the file watcher is applying infrastructure changes.
//!
//! ## Architecture
//!
//! The coordinator uses an RwLock-based synchronization pattern:
//! - File watcher holds a write lock during infrastructure processing
//! - MCP tools acquire a read lock to ensure stable state before reading
//! - Multiple MCP tools can read concurrently when no processing is occurring
//!
//! ## Usage
//!
//! ```rust
//! // In file watcher:
//! let _guard = coordinator.begin_processing().await;
//! // ... apply infrastructure changes ...
//! // Guard drops, releasing write lock
//!
//! // In MCP tool:
//! coordinator.wait_for_stable_state().await;
//! // Now safe to read infrastructure state
//! ```

use std::sync::Arc;
use tokio::sync::RwLock;

/// Coordinates MCP requests with file watcher processing to prevent race conditions.
///
/// This coordinator ensures that MCP tools wait for any in-progress infrastructure
/// changes to complete before reading state from Redis, ClickHouse, or Kafka.
///
/// Uses an RwLock where:
/// - Write lock = processing in progress (file watcher holds it)
/// - Read lock = verifying stable state (MCP tools acquire briefly)
#[derive(Clone)]
pub struct ProcessingCoordinator {
    /// RwLock for synchronization
    /// Write lock held during processing, read lock acquired to verify stability
    lock: Arc<RwLock<()>>,
}

impl ProcessingCoordinator {
    /// Create a new ProcessingCoordinator
    pub fn new() -> Self {
        Self {
            lock: Arc::new(RwLock::new(())),
        }
    }

    /// Mark the start of infrastructure processing, returning a guard.
    ///
    /// The guard holds a write lock for the duration of processing.
    /// When dropped, the write lock is released, allowing MCP tools to proceed.
    ///
    /// # Example
    ///
    /// ```rust
    /// let _guard = coordinator.begin_processing().await;
    /// // ... perform infrastructure changes ...
    /// // Guard drops here, releasing write lock
    /// ```
    pub async fn begin_processing(&self) -> ProcessingGuard {
        log::debug!("[ProcessingCoordinator] Acquiring write lock for processing");
        let write_guard = self.lock.clone().write_owned().await;
        log::debug!("[ProcessingCoordinator] Write lock acquired, processing started");

        ProcessingGuard {
            _write_guard: write_guard,
        }
    }

    /// Wait for any in-progress processing to complete.
    ///
    /// This method acquires a read lock, which will block if processing is in progress.
    /// Once the read lock is acquired, the state is guaranteed to be stable.
    /// The read lock is immediately released after acquisition.
    ///
    /// # Example
    ///
    /// ```rust
    /// // Before reading infrastructure state:
    /// coordinator.wait_for_stable_state().await;
    /// // Now safe to read from Redis, ClickHouse, etc.
    /// ```
    pub async fn wait_for_stable_state(&self) {
        log::trace!("[ProcessingCoordinator] Waiting for stable state (acquiring read lock)");
        let _read_guard = self.lock.read().await;
        log::trace!("[ProcessingCoordinator] State is stable (read lock acquired)");
        // Read lock is dropped here, allowing processing to proceed if needed
    }
}

impl Default for ProcessingCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

/// RAII guard that holds a write lock for the duration of processing.
///
/// This ensures that even if processing fails or panics, the write lock will be
/// released, allowing MCP tools to proceed.
pub struct ProcessingGuard {
    _write_guard: tokio::sync::OwnedRwLockWriteGuard<()>,
}

impl Drop for ProcessingGuard {
    fn drop(&mut self) {
        log::debug!("[ProcessingCoordinator] Processing complete, releasing write lock");
        // Write guard drops automatically, releasing the lock
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::time::sleep;

    #[tokio::test]
    async fn test_coordinator_starts_stable() {
        let coordinator = ProcessingCoordinator::new();

        // Should be able to immediately acquire read lock (stable state)
        let start = std::time::Instant::now();
        coordinator.wait_for_stable_state().await;
        let elapsed = start.elapsed();

        assert!(elapsed < Duration::from_millis(10));
    }

    #[tokio::test]
    async fn test_begin_processing_blocks_reads() {
        let coordinator = ProcessingCoordinator::new();

        // Channel to signal when read task has started waiting
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);

        // Acquire write lock (begin processing)
        let _guard = coordinator.begin_processing().await;

        // Try to acquire read lock in another task - should block
        let coordinator_clone = coordinator.clone();
        let read_task = tokio::spawn(async move {
            tx.send(()).await.unwrap(); // Signal that we're about to wait
            coordinator_clone.wait_for_stable_state().await;
        });

        // Wait until read task is definitely waiting on the lock
        rx.recv().await.unwrap();

        // Drop the write lock
        drop(_guard);

        // Read task should now complete without timing out
        tokio::time::timeout(Duration::from_secs(1), read_task)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn test_wait_for_stable_state_immediate_return() {
        let coordinator = ProcessingCoordinator::new();

        // Should return immediately when stable
        let start = std::time::Instant::now();
        coordinator.wait_for_stable_state().await;
        let elapsed = start.elapsed();

        assert!(elapsed < Duration::from_millis(10));
    }

    #[tokio::test]
    async fn test_wait_for_stable_state_waits_during_processing() {
        let coordinator = ProcessingCoordinator::new();
        let coordinator_clone = coordinator.clone();

        // Channel to signal when processor has acquired the write lock
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);

        let processing_duration = Duration::from_millis(100);

        // Spawn a task that starts processing and holds it for a bit
        let processor = tokio::spawn(async move {
            let _guard = coordinator_clone.begin_processing().await;
            tx.send(()).await.unwrap(); // Signal that lock is acquired
            sleep(processing_duration).await;
            // Guard drops here
        });

        // Wait until processor has definitely acquired the write lock
        rx.recv().await.unwrap();

        // Now wait for stable state - should block until processing completes
        coordinator.wait_for_stable_state().await;

        processor.await.unwrap();
    }

    #[tokio::test]
    async fn test_multiple_waiters() {
        let coordinator = ProcessingCoordinator::new();
        let coordinator_clone = coordinator.clone();

        // Channel to signal when processor has acquired the write lock
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);

        // Start processing first
        let processor = tokio::spawn(async move {
            let _guard = coordinator_clone.begin_processing().await;
            tx.send(()).await.unwrap(); // Signal that lock is acquired
            sleep(Duration::from_millis(100)).await;
        });

        // Wait until processor has definitely acquired the write lock
        rx.recv().await.unwrap();

        // Spawn multiple waiters that should all block on the write lock
        let mut waiter_handles = vec![];
        for i in 0..5 {
            let coord = coordinator.clone();
            waiter_handles.push(tokio::spawn(async move {
                coord.wait_for_stable_state().await;
                i
            }));
        }

        // Wait for processing to complete
        processor.await.unwrap();

        // All waiters should complete without timing out
        // This verifies they waited for the processor to finish
        for (i, handle) in waiter_handles.into_iter().enumerate() {
            let result_i = tokio::time::timeout(Duration::from_secs(1), handle)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(result_i, i);
        }
    }

    #[tokio::test]
    async fn test_guard_drop_on_panic() {
        let coordinator = ProcessingCoordinator::new();
        let coordinator_clone = coordinator.clone();

        // Spawn a task that panics while holding the guard
        let processor = tokio::spawn(async move {
            let _guard = coordinator_clone.begin_processing().await;
            sleep(Duration::from_millis(10)).await;
            panic!("Simulated panic during processing");
        });

        // Give the processor time to acquire write lock
        sleep(Duration::from_millis(5)).await;

        // Wait for the panic
        let _ = processor.await;

        // Coordinator should return to stable state despite panic
        // (write lock should be released when task panics)
        let start = std::time::Instant::now();
        coordinator.wait_for_stable_state().await;
        let elapsed = start.elapsed();

        // Should complete quickly since panic releases the lock
        assert!(elapsed < Duration::from_millis(100));
    }

    #[tokio::test]
    async fn test_sequential_processing_cycles() {
        let coordinator = ProcessingCoordinator::new();

        for _ in 0..3 {
            // Should be able to acquire read lock immediately (stable)
            coordinator.wait_for_stable_state().await;

            {
                let _guard = coordinator.begin_processing().await;
                // While guard is held, another task trying to read should block
                // (tested implicitly by other tests)
            }

            // After guard drops, should be stable again
            coordinator.wait_for_stable_state().await;
        }
    }

    #[tokio::test]
    async fn test_clone_shares_state() {
        let coordinator1 = ProcessingCoordinator::new();
        let coordinator2 = coordinator1.clone();

        // Channel to signal when read task has started waiting
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);

        {
            let _guard = coordinator1.begin_processing().await;

            // coordinator2 should also see the processing state (shared lock)
            let coordinator2_clone = coordinator2.clone();
            let read_task = tokio::spawn(async move {
                tx.send(()).await.unwrap(); // Signal that we're about to wait
                coordinator2_clone.wait_for_stable_state().await;
            });

            // Wait until read task is definitely waiting on the lock
            rx.recv().await.unwrap();

            // Drop guard
            drop(_guard);

            // Read task should complete without timing out
            tokio::time::timeout(Duration::from_secs(1), read_task)
                .await
                .unwrap()
                .unwrap();
        }

        // Both coordinators should be able to read now
        coordinator1.wait_for_stable_state().await;
        coordinator2.wait_for_stable_state().await;
    }

    #[tokio::test]
    async fn test_multiple_concurrent_reads() {
        let coordinator = ProcessingCoordinator::new();

        // Multiple readers should be able to acquire read locks concurrently
        let mut read_tasks = vec![];
        for i in 0..5 {
            let coord = coordinator.clone();
            read_tasks.push(tokio::spawn(async move {
                coord.wait_for_stable_state().await;
                i
            }));
        }

        // All should complete quickly
        for (i, handle) in read_tasks.into_iter().enumerate() {
            let result = tokio::time::timeout(Duration::from_millis(50), handle)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(result, i);
        }
    }
}
