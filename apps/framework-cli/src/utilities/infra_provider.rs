use crate::cli::routines::{RoutineFailure, RoutineSuccess};
use crate::cli::settings::Settings;
use crate::project::Project;

/// Abstraction over infrastructure backends (Docker, native binaries, etc.)
///
/// Implementations manage the lifecycle of dev-mode infrastructure services
/// (ClickHouse, Redpanda, Temporal, Redis). The `dev.rs` routine calls these
/// methods without knowing whether Docker or native processes back them.
pub trait InfraProvider {
    /// One-time setup: generate config files, create data directories, etc.
    fn setup(&self, project: &Project, settings: &Settings) -> Result<(), RoutineFailure>;

    /// Start all infrastructure services managed by this provider.
    fn start(&self, project: &Project) -> Result<(), RoutineFailure>;

    /// Stop all infrastructure services managed by this provider.
    fn stop(&self, project: &Project, settings: &Settings) -> Result<(), RoutineFailure>;

    /// Validate that ClickHouse is running and healthy.
    fn validate_clickhouse(&self, project: &Project) -> Result<RoutineSuccess, RoutineFailure>;

    /// Validate that Redpanda is running.
    fn validate_redpanda(&self, project: &Project) -> Result<RoutineSuccess, RoutineFailure>;

    /// Validate that the Redpanda cluster is formed and responsive.
    fn validate_redpanda_cluster(
        &self,
        project_name: &str,
    ) -> Result<RoutineSuccess, RoutineFailure>;

    /// Validate that Temporal is running and healthy.
    fn validate_temporal(&self, project: &Project) -> Result<RoutineSuccess, RoutineFailure>;
}
