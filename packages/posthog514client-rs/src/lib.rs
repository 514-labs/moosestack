//! PostHog client library for Rust
//!
//! This crate provides a client for interacting with PostHog analytics.

pub mod client;
pub mod error;
pub mod event;

#[cfg(feature = "blocking")]
mod blocking;

pub use client::{Config, PostHog514Client, PostHogClient};
pub use error::{ConfigErrorKind, PostHogError, SendEventErrorKind};
pub use event::{Event514, EventType, MooseEventType};

#[cfg(feature = "blocking")]
pub use blocking::BlockingPostHog514Client;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "This test makes real network calls to PostHog"]
    async fn test_basic_event_capture() {
        let client = PostHogClient::new("test_key", "https://app.posthog.com").unwrap();
        let event = Event514::new_moose(MooseEventType::MooseCliCommand)
            .with_distinct_id("test_user")
            .with_properties([("test".to_string(), "value".into())].into());

        // PostHog may accept events even with invalid API keys,
        // so we just verify the call completes without panicking
        let _ = client.capture(event).await;
    }
}
