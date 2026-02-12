//! Infrastructure status types for the Dev TUI
//!
//! This module defines the status types used to communicate infrastructure boot
//! progress from the background infrastructure task to the TUI for real-time display.

use tokio::sync::mpsc;

/// Boot phase during infrastructure startup
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BootPhase {
    /// Initial phase before any work begins
    Initializing,
    /// Checking if Docker daemon is running
    CheckingDocker,
    /// Creating the docker-compose file
    CreatingComposeFile,
    /// Starting containers via docker-compose
    StartingContainers,
    /// Validating individual services are healthy
    ValidatingServices,
    /// All infrastructure is ready
    Ready,
    /// Infrastructure boot failed
    Failed,
}

impl BootPhase {
    /// Returns a human-readable description of the phase
    pub fn description(&self) -> &'static str {
        match self {
            BootPhase::Initializing => "Initializing...",
            BootPhase::CheckingDocker => "Checking Docker...",
            BootPhase::CreatingComposeFile => "Creating compose file...",
            BootPhase::StartingContainers => "Starting containers...",
            BootPhase::ValidatingServices => "Validating services...",
            BootPhase::Ready => "Ready",
            BootPhase::Failed => "Failed",
        }
    }
}

/// Status of an individual service
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceStatus {
    /// Service has not started yet
    Pending,
    /// Service is being started
    Starting,
    /// Service is waiting to become healthy
    WaitingHealthy {
        /// Current health check attempt number
        attempt: u8,
        /// Maximum number of attempts
        max_attempts: u8,
    },
    /// Service is up and healthy
    Healthy,
    /// Service was skipped (feature disabled)
    Skipped,
    /// Service failed to start
    Failed(String),
}

impl ServiceStatus {
    /// Returns the icon character for this status
    #[allow(dead_code)]
    pub fn icon(&self) -> char {
        match self {
            ServiceStatus::Pending => '○',
            ServiceStatus::Starting => '◐',
            ServiceStatus::WaitingHealthy { .. } => '◑',
            ServiceStatus::Healthy => '●',
            ServiceStatus::Skipped => '○',
            ServiceStatus::Failed(_) => '✗',
        }
    }

    /// Returns a display string for this status
    pub fn display(&self) -> String {
        match self {
            ServiceStatus::Pending => "Pending".to_string(),
            ServiceStatus::Starting => "Starting".to_string(),
            ServiceStatus::WaitingHealthy {
                attempt,
                max_attempts,
            } => format!("{}/{}", attempt, max_attempts),
            ServiceStatus::Healthy => "Healthy".to_string(),
            ServiceStatus::Skipped => "Skipped".to_string(),
            ServiceStatus::Failed(msg) => format!("Failed: {}", msg),
        }
    }

    /// Returns whether this is a terminal state
    #[allow(dead_code)]
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            ServiceStatus::Healthy | ServiceStatus::Skipped | ServiceStatus::Failed(_)
        )
    }
}

/// Current status of all infrastructure components
#[derive(Debug, Clone)]
pub struct InfrastructureStatus {
    /// Current boot phase
    pub phase: BootPhase,
    /// Docker daemon status
    pub docker: ServiceStatus,
    /// ClickHouse status (None if OLAP feature disabled)
    pub clickhouse: Option<ServiceStatus>,
    /// Redis status
    pub redis: Option<ServiceStatus>,
    /// Temporal status (None if workflows feature disabled)
    pub temporal: Option<ServiceStatus>,
    /// Redpanda status (None if streaming feature disabled)
    pub redpanda: Option<ServiceStatus>,
    /// Web server status
    pub web_server: ServiceStatus,
    /// Error message if infrastructure boot failed
    pub error_message: Option<String>,
}

impl InfrastructureStatus {
    /// Creates a new infrastructure status with all services pending
    pub fn new(olap_enabled: bool, streaming_enabled: bool, workflows_enabled: bool) -> Self {
        Self {
            phase: BootPhase::Initializing,
            docker: ServiceStatus::Pending,
            clickhouse: if olap_enabled {
                Some(ServiceStatus::Pending)
            } else {
                None
            },
            redis: Some(ServiceStatus::Pending),
            temporal: if workflows_enabled {
                Some(ServiceStatus::Pending)
            } else {
                None
            },
            redpanda: if streaming_enabled {
                Some(ServiceStatus::Pending)
            } else {
                None
            },
            web_server: ServiceStatus::Pending,
            error_message: None,
        }
    }

    /// Creates a status indicating infrastructure is skipped (--no-infra flag)
    pub fn skipped() -> Self {
        Self {
            phase: BootPhase::Ready,
            docker: ServiceStatus::Skipped,
            clickhouse: Some(ServiceStatus::Skipped),
            redis: Some(ServiceStatus::Skipped),
            temporal: Some(ServiceStatus::Skipped),
            redpanda: Some(ServiceStatus::Skipped),
            web_server: ServiceStatus::Pending,
            error_message: None,
        }
    }

    /// Returns whether infrastructure is ready for the web server to start
    #[allow(dead_code)]
    pub fn is_ready_for_web_server(&self) -> bool {
        self.phase == BootPhase::Ready && !matches!(self.phase, BootPhase::Failed)
    }

    /// Returns whether all infrastructure has completed (success or failure)
    #[allow(dead_code)]
    pub fn is_complete(&self) -> bool {
        matches!(self.phase, BootPhase::Ready | BootPhase::Failed)
    }
}

/// Updates sent from the infrastructure task to the TUI
#[derive(Debug, Clone)]
pub enum InfraStatusUpdate {
    /// Boot phase changed
    PhaseChanged(BootPhase),
    /// Docker status changed
    DockerStatus(ServiceStatus),
    /// ClickHouse status changed
    ClickHouseStatus(ServiceStatus),
    /// Redis status changed
    RedisStatus(ServiceStatus),
    /// Temporal status changed
    TemporalStatus(ServiceStatus),
    /// Redpanda status changed
    RedpandaStatus(ServiceStatus),
    /// Web server status changed
    #[allow(dead_code)]
    WebServerStatus(ServiceStatus),
    /// Infrastructure boot completed successfully
    BootCompleted,
    /// Infrastructure boot failed with error
    BootFailed(String),
}

/// Sender for infrastructure status updates
pub type InfraStatusSender = mpsc::UnboundedSender<InfraStatusUpdate>;

/// Receiver for infrastructure status updates
pub type InfraStatusReceiver = mpsc::UnboundedReceiver<InfraStatusUpdate>;

/// Creates a new channel for infrastructure status updates
pub fn infra_status_channel() -> (InfraStatusSender, InfraStatusReceiver) {
    mpsc::unbounded_channel()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boot_phase_description_returns_correct_strings() {
        assert_eq!(BootPhase::Initializing.description(), "Initializing...");
        assert_eq!(
            BootPhase::CheckingDocker.description(),
            "Checking Docker..."
        );
        assert_eq!(
            BootPhase::CreatingComposeFile.description(),
            "Creating compose file..."
        );
        assert_eq!(
            BootPhase::StartingContainers.description(),
            "Starting containers..."
        );
        assert_eq!(
            BootPhase::ValidatingServices.description(),
            "Validating services..."
        );
        assert_eq!(BootPhase::Ready.description(), "Ready");
        assert_eq!(BootPhase::Failed.description(), "Failed");
    }

    #[test]
    fn service_status_icon_returns_correct_chars() {
        assert_eq!(ServiceStatus::Pending.icon(), '○');
        assert_eq!(ServiceStatus::Starting.icon(), '◐');
        assert_eq!(
            ServiceStatus::WaitingHealthy {
                attempt: 1,
                max_attempts: 30
            }
            .icon(),
            '◑'
        );
        assert_eq!(ServiceStatus::Healthy.icon(), '●');
        assert_eq!(ServiceStatus::Skipped.icon(), '○');
        assert_eq!(ServiceStatus::Failed("test".into()).icon(), '✗');
    }

    #[test]
    fn service_status_display_formats_correctly() {
        assert_eq!(ServiceStatus::Pending.display(), "Pending");
        assert_eq!(ServiceStatus::Starting.display(), "Starting");
        assert_eq!(
            ServiceStatus::WaitingHealthy {
                attempt: 5,
                max_attempts: 30
            }
            .display(),
            "5/30"
        );
        assert_eq!(ServiceStatus::Healthy.display(), "Healthy");
        assert_eq!(ServiceStatus::Skipped.display(), "Skipped");
        assert_eq!(
            ServiceStatus::Failed("connection refused".into()).display(),
            "Failed: connection refused"
        );
    }

    #[test]
    fn service_status_is_terminal_returns_correct_values() {
        assert!(!ServiceStatus::Pending.is_terminal());
        assert!(!ServiceStatus::Starting.is_terminal());
        assert!(!ServiceStatus::WaitingHealthy {
            attempt: 1,
            max_attempts: 30
        }
        .is_terminal());
        assert!(ServiceStatus::Healthy.is_terminal());
        assert!(ServiceStatus::Skipped.is_terminal());
        assert!(ServiceStatus::Failed("test".into()).is_terminal());
    }

    #[test]
    fn infrastructure_status_new_creates_correct_status() {
        let status = InfrastructureStatus::new(true, true, true);
        assert_eq!(status.phase, BootPhase::Initializing);
        assert_eq!(status.docker, ServiceStatus::Pending);
        assert!(status.clickhouse.is_some());
        assert!(status.redis.is_some());
        assert!(status.temporal.is_some());
        assert!(status.redpanda.is_some());
        assert_eq!(status.web_server, ServiceStatus::Pending);
    }

    #[test]
    fn infrastructure_status_new_respects_feature_flags() {
        let status = InfrastructureStatus::new(false, false, false);
        assert!(status.clickhouse.is_none());
        assert!(status.temporal.is_none());
        assert!(status.redpanda.is_none());
        // Redis is always present
        assert!(status.redis.is_some());
    }

    #[test]
    fn infrastructure_status_skipped_creates_correct_status() {
        let status = InfrastructureStatus::skipped();
        assert_eq!(status.phase, BootPhase::Ready);
        assert_eq!(status.docker, ServiceStatus::Skipped);
    }

    #[test]
    fn infrastructure_status_is_ready_for_web_server() {
        let mut status = InfrastructureStatus::new(true, true, true);
        assert!(!status.is_ready_for_web_server());

        status.phase = BootPhase::Ready;
        assert!(status.is_ready_for_web_server());

        status.phase = BootPhase::Failed;
        assert!(!status.is_ready_for_web_server());
    }

    #[test]
    fn infrastructure_status_is_complete() {
        let mut status = InfrastructureStatus::new(true, true, true);
        assert!(!status.is_complete());

        status.phase = BootPhase::Ready;
        assert!(status.is_complete());

        status.phase = BootPhase::Failed;
        assert!(status.is_complete());

        status.phase = BootPhase::ValidatingServices;
        assert!(!status.is_complete());
    }

    #[test]
    fn infra_status_channel_creates_working_channel() {
        let (tx, mut rx) = infra_status_channel();
        tx.send(InfraStatusUpdate::PhaseChanged(BootPhase::CheckingDocker))
            .unwrap();

        let update = rx.try_recv().unwrap();
        assert!(matches!(
            update,
            InfraStatusUpdate::PhaseChanged(BootPhase::CheckingDocker)
        ));
    }
}
