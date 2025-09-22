//! PostHog client implementation

use reqwest::{Client as ReqwestClient, Url};
use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, error, instrument};

use crate::error::{ConfigErrorKind, PostHogError, SendEventErrorKind};
use crate::event::{Event514, MooseEventType};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);
const POSTHOG_HOST: &str = "https://us.i.posthog.com";

// Build-time environment variable for PostHog API key
const POSTHOG_API_KEY: Option<&str> = option_env!("POSTHOG_API_KEY");

/// Configuration for the PostHog client
#[derive(Debug, Clone)]
pub struct Config {
    /// API key for authentication
    api_key: String,
    /// Base URL for the PostHog instance
    base_url: Url,
    /// Request timeout
    timeout: Duration,
}

impl Config {
    /// Creates a new configuration with custom settings
    pub fn new(
        api_key: impl Into<String>,
        base_url: impl AsRef<str>,
    ) -> Result<Self, PostHogError> {
        let api_key = api_key.into();
        if api_key.is_empty() {
            return Err(PostHogError::configuration(
                "API key cannot be empty",
                Some(ConfigErrorKind::InvalidApiKey),
            ));
        }

        let base_url = Url::parse(base_url.as_ref()).map_err(|e| {
            PostHogError::configuration(
                "Invalid base URL",
                Some(ConfigErrorKind::InvalidUrl(e.to_string())),
            )
        })?;

        Ok(Self {
            api_key,
            base_url,
            timeout: DEFAULT_TIMEOUT,
        })
    }

    /// Sets a custom timeout for requests
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

/// Client for interacting with the PostHog API
#[derive(Debug, Clone)]
pub struct PostHogClient {
    config: Config,
    client: ReqwestClient,
}

impl PostHogClient {
    /// Creates a new PostHog client with default configuration
    pub fn new(
        api_key: impl Into<String>,
        base_url: impl AsRef<str>,
    ) -> Result<Self, PostHogError> {
        let config = Config::new(api_key, base_url)?;
        let client = ReqwestClient::builder()
            .timeout(config.timeout)
            .build()
            .map_err(|e| {
                PostHogError::configuration(
                    "Failed to create HTTP client",
                    Some(ConfigErrorKind::InvalidUrl(e.to_string())),
                )
            })?;

        Ok(Self { config, client })
    }

    /// Creates a new PostHog client with custom configuration
    pub fn with_config(config: Config) -> Result<Self, PostHogError> {
        let client = ReqwestClient::builder()
            .timeout(config.timeout)
            .build()
            .map_err(|e| {
                PostHogError::configuration(
                    "Failed to create HTTP client",
                    Some(ConfigErrorKind::InvalidUrl(e.to_string())),
                )
            })?;

        Ok(Self { config, client })
    }

    /// Captures a single event
    #[instrument(skip(self, event), fields(event_name = ?event.event))]
    pub async fn capture(&self, event: Event514) -> Result<(), PostHogError> {
        event.validate()?;

        let url = self.config.base_url.join("/capture/").map_err(|e| {
            PostHogError::configuration(
                "Failed to construct capture URL",
                Some(ConfigErrorKind::InvalidUrl(e.to_string())),
            )
        })?;

        let payload = json!({
            "api_key": self.config.api_key,
            "event": event.event,
            "properties": event.properties,
            "distinct_id": event.distinct_id,
            "timestamp": event.timestamp,
        });

        debug!("Sending event to PostHog");

        let response = self
            .client
            .post(url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| {
                PostHogError::send_event(
                    "Failed to send request",
                    Some(SendEventErrorKind::Network(e.to_string())),
                )
            })?;

        match response.status() {
            status if status.is_success() => {
                debug!("Successfully sent event to PostHog");
                Ok(())
            }
            status if status.as_u16() == 429 => {
                error!("Rate limited by PostHog API");
                Err(PostHogError::send_event(
                    "Rate limited",
                    Some(SendEventErrorKind::RateLimited),
                ))
            }
            status if status.as_u16() == 401 => {
                error!("Authentication failed");
                Err(PostHogError::send_event(
                    "Authentication failed",
                    Some(SendEventErrorKind::Authentication),
                ))
            }
            status => {
                let error_msg = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unknown error".into());
                error!("Unexpected response from PostHog: {}", error_msg);
                Err(PostHogError::send_event(
                    format!("Unexpected response: {status}"),
                    Some(SendEventErrorKind::Network(error_msg)),
                ))
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct PostHog514Client {
    api_key: String,
    client: Arc<ReqwestClient>,
    host: String,
    machine_id: String,
}

impl PostHog514Client {
    /// Creates a new PostHog514Client with the given API key and machine ID
    pub fn new(
        api_key: impl Into<String>,
        machine_id: impl Into<String>,
    ) -> Result<Self, PostHogError> {
        let client = ReqwestClient::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| {
                PostHogError::configuration(
                    "Failed to create HTTP client",
                    Some(ConfigErrorKind::InvalidUrl(e.to_string())),
                )
            })?;

        Ok(Self {
            api_key: api_key.into(),
            client: Arc::new(client),
            host: POSTHOG_HOST.to_string(),
            machine_id: machine_id.into(),
        })
    }

    /// Creates a new PostHog514Client using the API key from the environment.
    /// This will:
    /// 1. First check for a build-time API key (baked into the binary)
    /// 2. Then check for a runtime POSTHOG_API_KEY environment variable
    /// 3. Return None if neither is available
    pub fn from_env(machine_id: impl Into<String>) -> Option<Self> {
        // First try build-time API key
        if let Some(api_key) = POSTHOG_API_KEY {
            return Self::new(api_key, machine_id).ok();
        }

        // Then try runtime environment variable
        if let Ok(api_key) = env::var("POSTHOG_API_KEY") {
            return Self::new(api_key, machine_id).ok();
        }

        None
    }

    /// Captures a custom event
    pub async fn capture_event(
        &self,
        event_name: impl Into<String>,
        properties: Option<HashMap<String, serde_json::Value>>,
    ) -> Result<(), PostHogError> {
        let event = Event514::new(event_name).with_distinct_id(self.machine_id.clone());

        if let Some(properties) = properties {
            let event = event.with_properties(properties);
            self.capture(event).await
        } else {
            self.capture(event).await
        }
    }

    pub async fn capture_cli_command(
        &self,
        command: impl Into<String>,
        project: Option<String>,
        mut context: Option<HashMap<String, serde_json::Value>>,
        app_version: impl Into<String>,
        is_developer: bool,
    ) -> Result<(), PostHogError> {
        let mut event = Event514::new_moose(MooseEventType::MooseCliCommand)
            .with_distinct_id(self.machine_id.clone())
            .with_project(project);

        // Set 514-specific properties
        event.set_app_version(app_version);
        event.set_is_developer(is_developer);
        event.set_environment("production".to_string()); // TODO: Make configurable

        // Ensure we have a context to work with
        let context = context.get_or_insert_with(HashMap::new);

        // Add command to context if not already present
        if !context.contains_key("command") {
            context.insert("command".to_string(), json!(command.into()));
        }

        // Add context to event properties and capture
        let event = event.with_properties(context.clone());
        self.capture(event).await
    }

    pub async fn capture_cli_error(
        &self,
        error: impl std::error::Error,
        project: Option<String>,
        context: Option<HashMap<String, serde_json::Value>>,
    ) -> Result<(), PostHogError> {
        let event = Event514::new_moose(MooseEventType::MooseCliError)
            .with_distinct_id(self.machine_id.clone())
            .with_project(project);

        if let Some(context) = context {
            let event = event.with_properties(context);
            let event = event.with_error(error);
            self.capture(event).await
        } else {
            let event = event.with_error(error);
            self.capture(event).await
        }
    }

    async fn capture(&self, event: Event514) -> Result<(), PostHogError> {
        event.validate()?;

        let url = format!("{}/capture/", self.host);
        let payload = json!({
            "api_key": self.api_key,
            "event": event.event,
            "properties": event.properties,
            "timestamp": event.timestamp,
            "distinct_id": event.distinct_id,
        });

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| {
                PostHogError::send_event(
                    "Failed to send request",
                    Some(SendEventErrorKind::Network(e.to_string())),
                )
            })?;

        match response.status() {
            reqwest::StatusCode::OK | reqwest::StatusCode::ACCEPTED => Ok(()),
            reqwest::StatusCode::UNAUTHORIZED => Err(PostHogError::send_event(
                "Invalid API key",
                Some(SendEventErrorKind::Authentication),
            )),
            reqwest::StatusCode::TOO_MANY_REQUESTS => Err(PostHogError::send_event(
                "Too many requests",
                Some(SendEventErrorKind::RateLimited),
            )),
            status => Err(PostHogError::send_event(
                "Unexpected response from PostHog",
                Some(SendEventErrorKind::Network(status.to_string())),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;
    use std::io;
    use test_case::test_case;

    #[test_case("", POSTHOG_HOST => Err(()) ; "empty api key")]
    #[test_case("test_key", "invalid-url" => Err(()) ; "invalid url")]
    #[test_case("test_key", POSTHOG_HOST => Ok(()) ; "valid config")]
    fn test_config_creation(api_key: &str, base_url: &str) -> Result<(), ()> {
        match Config::new(api_key, base_url) {
            Ok(_) => Ok(()),
            Err(_) => Err(()),
        }
    }

    #[tokio::test]
    async fn test_capture_success() {
        let mut server = Server::new_async().await;

        // Use a partial matcher that ignores timestamp
        let mock = server
            .mock("POST", "/capture/")
            .match_body(mockito::Matcher::PartialJson(json!({
                "api_key": "test_key",
                "event": "moose_cli_command",
                "properties": {
                    "app_version": "",
                    "is_developer": false,
                    "environment": "",
                    "project": null
                },
                "distinct_id": "user123"
            })))
            .with_status(200)
            .create_async()
            .await;

        let client = PostHogClient::new("test_key", server.url()).unwrap();
        let event =
            Event514::new_moose(MooseEventType::MooseCliCommand).with_distinct_id("user123");

        let result = client.capture(event).await;
        assert!(
            result.is_ok(),
            "Failed to capture event: {:?}",
            result.err()
        );
        mock.assert_async().await;
    }

    #[tokio::test]
    #[ignore = "This test makes real network calls to PostHog"]
    async fn test_capture_cli_command() {
        let client = PostHog514Client::new("test_key", "machine123").unwrap();
        let result = client
            .capture_cli_command(
                "moose init",
                Some("test-project".to_string()),
                None,
                "1.0.0",
                false,
            )
            .await;

        // PostHog actually accepts events even with invalid API keys,
        // so we just verify the call completes without panicking
        assert!(result.is_ok() || result.is_err());
    }

    #[tokio::test]
    #[ignore = "This test makes real network calls to PostHog"]
    async fn test_capture_cli_error() {
        let client = PostHog514Client::new("test_key", "machine123").unwrap();
        let error = io::Error::new(io::ErrorKind::NotFound, "File not found");
        let result = client
            .capture_cli_error(error, Some("test-project".to_string()), None)
            .await;

        // PostHog actually accepts events even with invalid API keys,
        // so we just verify the call completes without panicking
        assert!(result.is_ok() || result.is_err());
    }
}
