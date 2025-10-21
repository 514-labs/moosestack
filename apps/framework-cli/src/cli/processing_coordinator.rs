//! # Processing Coordinator Module
//!
//! This module provides synchronization between file watcher infrastructure processing
//! and MCP tool requests. It ensures that MCP tools don't read partial or inconsistent
//! state while the file watcher is applying infrastructure changes.
//!
//! ## Architecture
//!
//! The coordinator uses a generation counter pattern:
//! - Even generations = stable state (safe to read)
//! - Odd generations = processing in progress (wait before reading)
//!
//! ## Usage
//!
//! ```rust
//! // In file watcher:
//! let _guard = coordinator.begin_processing();
//! // ... apply infrastructure changes ...
//! // Guard drops, marking processing complete
//!
//! // In MCP tool:
//! coordinator.wait_for_stable_state().await;
//! // Now safe to read infrastructure state
//! ```

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Notify;

/// Coordinates MCP requests with file watcher processing to prevent race conditions.
///
/// This coordinator ensures that MCP tools wait for any in-progress infrastructure
/// changes to complete before reading state from Redis, ClickHouse, or Kafka.
#[derive(Clone)]
pub struct ProcessingCoordinator {
    /// Generation counter - increments with each processing cycle
    /// Even = stable, Odd = processing
    generation: Arc<AtomicU64>,
    /// Notifies waiters when processing completes
    completion_notify: Arc<Notify>,
}

impl ProcessingCoordinator {
    /// Create a new ProcessingCoordinator
    pub fn new() -> Self {
        Self {
            generation: Arc::new(AtomicU64::new(0)),
            completion_notify: Arc::new(Notify::new()),
        }
    }

    /// Mark the start of infrastructure processing, returning a guard.
    ///
    /// The guard will automatically mark processing as complete when dropped,
    /// ensuring that waiters are notified even if processing fails.
    ///
    /// # Example
    ///
    /// ```rust
    /// let _guard = coordinator.begin_processing();
    /// // ... perform infrastructure changes ...
    /// // Guard drops here, notifying waiters
    /// ```
    pub fn begin_processing(&self) -> ProcessingGuard {
        let gen = self.generation.fetch_add(1, Ordering::SeqCst);
        log::debug!(
            "[ProcessingCoordinator] Begin processing, generation {} -> {}",
            gen,
            gen + 1
        );

        ProcessingGuard {
            generation: self.generation.clone(),
            completion_notify: self.completion_notify.clone(),
            start_generation: gen,
        }
    }

    /// Wait for any in-progress processing to complete.
    ///
    /// This method returns immediately if no processing is occurring.
    /// If processing is in progress, it waits until the processing guard is dropped.
    ///
    /// # Example
    ///
    /// ```rust
    /// // Before reading infrastructure state:
    /// coordinator.wait_for_stable_state().await;
    /// // Now safe to read from Redis, ClickHouse, etc.
    /// ```
    pub async fn wait_for_stable_state(&self) {
        loop {
            let current_gen = self.generation.load(Ordering::SeqCst);

            // Even generation = stable state
            if current_gen % 2 == 0 {
                log::trace!(
                    "[ProcessingCoordinator] State is stable (generation {})",
                    current_gen
                );
                return;
            }

            // Odd generation = processing in progress
            log::debug!(
                "[ProcessingCoordinator] Processing in progress (generation {}), waiting...",
                current_gen
            );

            // Wait for notification
            let notified = self.completion_notify.notified();
            notified.await;

            // Loop to check generation again (handles spurious wakeups)
        }
    }

    /// Check if processing is currently in progress.
    ///
    /// This is primarily useful for debugging and monitoring.
    /// Use `wait_for_stable_state()` to ensure you're reading stable state.
    pub fn is_processing(&self) -> bool {
        self.generation.load(Ordering::SeqCst) % 2 == 1
    }

    /// Get the current generation number.
    ///
    /// Useful for debugging and testing.
    pub fn current_generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }
}

impl Default for ProcessingCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

/// RAII guard that marks processing as complete when dropped.
///
/// This ensures that even if processing fails or panics, waiters will be notified
/// and the coordinator returns to a stable state.
pub struct ProcessingGuard {
    generation: Arc<AtomicU64>,
    completion_notify: Arc<Notify>,
    start_generation: u64,
}

impl Drop for ProcessingGuard {
    fn drop(&mut self) {
        let new_gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        log::debug!(
            "[ProcessingCoordinator] End processing, generation {} -> {}",
            self.start_generation + 1,
            new_gen
        );

        // Notify all waiters that processing is complete
        self.completion_notify.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::time::sleep;

    #[test]
    fn test_coordinator_starts_stable() {
        let coordinator = ProcessingCoordinator::new();
        assert_eq!(coordinator.current_generation(), 0);
        assert!(!coordinator.is_processing());
    }

    #[tokio::test]
    async fn test_begin_processing_increments_generation() {
        let coordinator = ProcessingCoordinator::new();

        assert_eq!(coordinator.current_generation(), 0);

        {
            let _guard = coordinator.begin_processing();
            assert_eq!(coordinator.current_generation(), 1);
            assert!(coordinator.is_processing());
        }

        assert_eq!(coordinator.current_generation(), 2);
        assert!(!coordinator.is_processing());
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

        let processing_duration = Duration::from_millis(100);

        // Spawn a task that starts processing and holds it for a bit
        let processor = tokio::spawn(async move {
            let _guard = coordinator_clone.begin_processing();
            sleep(processing_duration).await;
            // Guard drops here
        });

        // Give the processor time to start
        sleep(Duration::from_millis(10)).await;

        // Now wait for stable state
        let start = std::time::Instant::now();
        coordinator.wait_for_stable_state().await;
        let elapsed = start.elapsed();

        // Should have waited approximately the processing duration
        assert!(elapsed >= Duration::from_millis(80));
        assert!(!coordinator.is_processing());

        processor.await.unwrap();
    }

    #[tokio::test]
    async fn test_multiple_waiters() {
        let coordinator = ProcessingCoordinator::new();
        let coordinator_clone = coordinator.clone();

        // Spawn multiple waiters
        let mut waiter_handles = vec![];
        for i in 0..5 {
            let coord = coordinator.clone();
            waiter_handles.push(tokio::spawn(async move {
                coord.wait_for_stable_state().await;
                i
            }));
        }

        // Give waiters time to start
        sleep(Duration::from_millis(10)).await;

        // Start processing
        let processor = tokio::spawn(async move {
            let _guard = coordinator_clone.begin_processing();
            sleep(Duration::from_millis(50)).await;
        });

        // Wait for processing to complete
        processor.await.unwrap();

        // All waiters should complete
        for (i, handle) in waiter_handles.into_iter().enumerate() {
            let result = tokio::time::timeout(Duration::from_millis(100), handle)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(result, i);
        }

        assert!(!coordinator.is_processing());
    }

    #[tokio::test]
    async fn test_guard_drop_on_panic() {
        let coordinator = ProcessingCoordinator::new();
        let coordinator_clone = coordinator.clone();

        // Spawn a task that panics while holding the guard
        let processor = tokio::spawn(async move {
            let _guard = coordinator_clone.begin_processing();
            sleep(Duration::from_millis(10)).await;
            panic!("Simulated panic during processing");
        });

        // Give the processor time to start
        sleep(Duration::from_millis(5)).await;

        // Wait for the panic
        let _ = processor.await;

        // Coordinator should return to stable state despite panic
        coordinator.wait_for_stable_state().await;
        assert!(!coordinator.is_processing());
        // Generation should be even (stable)
        assert_eq!(coordinator.current_generation() % 2, 0);
    }

    #[tokio::test]
    async fn test_sequential_processing_cycles() {
        let coordinator = ProcessingCoordinator::new();

        for i in 0..3 {
            assert_eq!(coordinator.current_generation(), i * 2);
            assert!(!coordinator.is_processing());

            {
                let _guard = coordinator.begin_processing();
                assert_eq!(coordinator.current_generation(), i * 2 + 1);
                assert!(coordinator.is_processing());
            }

            assert_eq!(coordinator.current_generation(), i * 2 + 2);
            assert!(!coordinator.is_processing());
        }
    }

    #[tokio::test]
    async fn test_clone_shares_state() {
        let coordinator1 = ProcessingCoordinator::new();
        let coordinator2 = coordinator1.clone();

        {
            let _guard = coordinator1.begin_processing();
            assert!(coordinator2.is_processing());
            assert_eq!(
                coordinator1.current_generation(),
                coordinator2.current_generation()
            );
        }

        assert!(!coordinator1.is_processing());
        assert!(!coordinator2.is_processing());
    }
}
