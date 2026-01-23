use crate::cli::routines::scripts::terminate_workflow;
use crate::framework::core::infrastructure_map::{Change, WorkflowChange};
use crate::framework::scripts::Workflow;
use crate::project::Project;

/// Executes workflow changes based on the diff between current and target infrastructure.
///
/// Change handling:
/// - Added: terminate (handles upgrade) + register if scheduled
/// - Removed: terminate
/// - Updated (config changed): terminate + register if scheduled
/// - No change: no action needed
///
/// Shutdown behavior:
/// - Workers stop, but workflow definitions and schedules persist in Temporal
/// - On restart, workers reconnect and resume orchestration
pub async fn execute_changes(
    project: &Project,
    changes: &[WorkflowChange],
    _infra_map: &crate::framework::core::infrastructure_map::InfrastructureMap,
) {
    if !project.features.workflows {
        tracing::info!("Workflows are not enabled, skipping workflow changes");
        return;
    }

    if changes.is_empty() {
        tracing::info!("No workflow changes to execute");
        return;
    }

    tracing::info!("Executing {} workflow change(s)", changes.len());

    for change in changes {
        match change {
            WorkflowChange::Workflow(Change::Added(workflow)) => {
                handle_workflow_added(project, workflow).await;
            }
            WorkflowChange::Workflow(Change::Removed(workflow)) => {
                handle_workflow_removed(project, workflow).await;
            }
            WorkflowChange::Workflow(Change::Updated { before, after }) => {
                handle_workflow_updated(project, before, after).await;
            }
        }
    }
}

async fn handle_workflow_added(project: &Project, workflow: &Workflow) {
    if workflow.config().schedule.is_empty() {
        tracing::info!(
            "Workflow '{}' has no schedule, available for manual trigger only",
            workflow.name()
        );
        return;
    }

    terminate(project, workflow.name()).await;
    start(project, workflow).await;
}

async fn handle_workflow_removed(project: &Project, workflow: &Workflow) {
    terminate(project, workflow.name()).await;
}

async fn handle_workflow_updated(project: &Project, before: &Workflow, after: &Workflow) {
    terminate(project, before.name()).await;

    if after.config().schedule.is_empty() {
        tracing::info!(
            "Workflow '{}' schedule removed, workflow stopped",
            after.name()
        );
    } else {
        start(project, after).await;
    }
}

async fn terminate(project: &Project, name: &str) {
    match terminate_workflow(project, name).await {
        Ok(_) => {
            tracing::info!("Terminated workflow '{}'", name);
        }
        Err(e) => {
            // May not be running or on schedule
            tracing::debug!("Could not terminate workflow '{}': {:?}", name, e);
        }
    }
}

async fn start(project: &Project, workflow: &Workflow) {
    let schedule = &workflow.config().schedule;
    match workflow.start(&project.temporal_config, None).await {
        Ok(info) => {
            tracing::info!(
                "Started workflow '{}' with schedule '{}' (run_id: {})",
                workflow.name(),
                schedule,
                info.run_id
            );
        }
        Err(e) => {
            tracing::error!(
                "Failed to start workflow '{}' with schedule '{}': {}",
                workflow.name(),
                schedule,
                e
            );
        }
    }
}
