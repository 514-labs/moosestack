use anyhow::Result;
use std::convert::TryFrom;
use std::sync::Arc;

use crate::cli::display::{show_table, Message};
use crate::cli::routines::{RoutineFailure, RoutineSuccess};
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::framework::scripts::executor::WorkflowStartInfo;
use crate::infrastructure::orchestration::temporal_client::TemporalClientManager;
use crate::project::Project;
use crate::utilities::decode_object::decode_base64_to_json;
use chrono::{DateTime, Utc};
use futures::future::try_join_all;
use temporal_sdk_core_protos::temporal::api::common::v1::WorkflowExecution;
use temporal_sdk_core_protos::temporal::api::enums::v1::WorkflowExecutionStatus;
use temporal_sdk_core_protos::temporal::api::workflowservice::v1::{
    DescribeWorkflowExecutionRequest, GetWorkflowExecutionHistoryRequest,
    ListWorkflowExecutionsRequest, RequestCancelWorkflowExecutionRequest,
    SignalWorkflowExecutionRequest, TerminateWorkflowExecutionRequest,
};

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkflowInfo {
    pub name: String,
    pub run_id: String,
    pub status: String,
    pub started_at: String,
    pub duration: String,
}

impl WorkflowInfo {
    pub fn display_list(workflows: Vec<WorkflowInfo>, json: bool) {
        if json {
            Self::display_as_json(workflows);
        } else {
            Self::display_as_table(workflows);
        }
    }

    fn display_as_json(workflows: Vec<WorkflowInfo>) {
        println!("{}", serde_json::to_string_pretty(&workflows).unwrap());
    }

    fn display_as_table(workflows: Vec<WorkflowInfo>) {
        let table_data: Vec<Vec<String>> = workflows
            .into_iter()
            .map(|w| vec![w.name, w.run_id, w.status, w.started_at, w.duration])
            .collect();

        show_table(
            "History".to_string(),
            vec![
                "Workflow Name".to_string(),
                "Run ID".to_string(),
                "Status".to_string(),
                "Started At".to_string(),
                "Duration".to_string(),
            ],
            table_data,
        );
    }
}

fn calculate_duration_from_timestamps(
    start_time: Option<prost_wkt_types::Timestamp>,
    close_time: Option<prost_wkt_types::Timestamp>,
) -> String {
    let Some(start) = start_time else {
        return "-".to_string();
    };

    let start_dt = chrono::DateTime::from_timestamp(start.seconds, start.nanos as u32)
        .unwrap_or_else(Utc::now);

    let end_dt = if let Some(close) = close_time {
        // Workflow is completed, use close time
        chrono::DateTime::from_timestamp(close.seconds, close.nanos as u32).unwrap_or_else(Utc::now)
    } else {
        // Workflow is still running, use current time
        Utc::now()
    };

    let duration = end_dt.signed_duration_since(start_dt);
    let total_seconds = duration.num_seconds();
    let total_milliseconds = duration.num_milliseconds();

    if total_seconds == 0 {
        // Sub-second duration, show milliseconds
        format!("{total_milliseconds}ms")
    } else if total_seconds < 60 {
        format!("{total_seconds}s")
    } else if total_seconds < 3600 {
        let minutes = total_seconds / 60;
        let seconds = total_seconds % 60;
        format!("{minutes}m {seconds}s")
    } else {
        let hours = total_seconds / 3600;
        let minutes = (total_seconds % 3600) / 60;
        let seconds = total_seconds % 60;
        format!("{hours}h {minutes}m {seconds}s")
    }
}

pub async fn run_workflow(
    project: &Project,
    name: &str,
    input: Option<String>,
) -> Result<RoutineSuccess, RoutineFailure> {
    let namespace = project.temporal_config.get_temporal_namespace();

    let info = run_workflow_and_get_run_ids(project, name, input).await?;

    let dashboard_url = temporal_dashboard_url(&namespace, &info.workflow_id, &info.run_id);

    Ok(RoutineSuccess::success(Message {
        action: "Workflow".to_string(),
        details: format!(
            "'{name}' started successfully.\nView it in the Temporal dashboard: {dashboard_url}\n",
        ),
    }))
}

pub async fn run_workflow_and_get_run_ids(
    project: &Project,
    name: &str,
    input: Option<String>,
) -> Result<WorkflowStartInfo, RoutineFailure> {
    let infra_map = InfrastructureMap::load_from_user_code(project)
        .await
        .map_err(|e| {
            RoutineFailure::new(
                Message {
                    action: "Load".to_string(),
                    details: "Infrastructure".to_string(),
                },
                e,
            )
        })?;

    let workflow = if infra_map.workflows.contains_key(name) {
        infra_map.workflows.get(name).unwrap().clone()
    } else {
        return Err(RoutineFailure::error(Message {
            action: "Workflow".to_string(),
            details: format!("Could not find workflow '{name}'"),
        }));
    };

    let info: WorkflowStartInfo = workflow
        .start(&project.temporal_config, input)
        .await
        .map_err(|e| {
            RoutineFailure::new(
                Message {
                    action: "Workflow".to_string(),
                    details: format!("Could not start workflow '{name}': {e}"),
                },
                e,
            )
        })?;

    if info.run_id.is_empty() {
        return Err(RoutineFailure::error(Message {
            action: "Workflow".to_string(),
            details: format!("'{name}' failed to start: Invalid run ID\n"),
        }));
    }

    Ok(info)
}

pub fn temporal_dashboard_url(namespace: &str, workflow_id: &str, run_id: &str) -> String {
    format!(
        "http://localhost:8080/namespaces/{}/workflows/{}/{}/history",
        namespace, workflow_id, run_id
    )
}

pub async fn get_workflow_history(
    project: &Project,
    status: Option<String>,
    limit: u32,
) -> Result<Vec<WorkflowInfo>, RoutineFailure> {
    let mut workflows = Vec::new();

    let client_manager = TemporalClientManager::new_validate(&project.temporal_config, true)
        .map_err(|e| {
            RoutineFailure::error(Message {
                action: "Temporal".to_string(),
                details: format!("Failed to create client manager: {e}"),
            })
        })?;
    let namespace = project.temporal_config.get_temporal_namespace();

    // Convert status string to Temporal query format
    // Using WorkflowExecutionStatus returns the whole enum, but temporal expects simpler values
    let status_filter = if let Some(status_str) = status {
        match status_str.to_lowercase().as_str() {
            "running" => Some("Running"),
            "completed" => Some("Completed"),
            "failed" => Some("Failed"),
            _ => None,
        }
    } else {
        None
    };

    // Build query string for Temporal
    let query = if let Some(status) = status_filter {
        format!("ExecutionStatus = '{status}'")
    } else {
        "".to_string()
    };

    // List workflows from Temporal
    let request = ListWorkflowExecutionsRequest {
        namespace,
        page_size: limit as i32,
        query,
        ..Default::default()
    };

    let response = client_manager
        .execute(|mut client| async move {
            client
                .list_workflow_executions(request)
                .await
                .map_err(|e| anyhow::Error::msg(e.to_string()))
        })
        .await
        .map_err(|e| {
            RoutineFailure::error(Message {
                action: "Workflow".to_string(),
                details: format!("Could not list workflows: {e}\n"),
            })
        })?;

    // Convert workflow executions to WorkflowInfo structs
    let response_inner = response.into_inner();
    for execution in response_inner.executions {
        if let Some(_workflow_type) = execution.r#type {
            let status = WorkflowExecutionStatus::try_from(execution.status)
                .map_or("UNKNOWN".to_string(), |s| s.as_str_name().to_string());

            if let Some(execution_info) = execution.execution {
                workflows.push(WorkflowInfo {
                    name: execution_info.workflow_id,
                    run_id: execution_info.run_id,
                    status,
                    started_at: execution.start_time.map_or("-".to_string(), |t| {
                        chrono::DateTime::from_timestamp(t.seconds, t.nanos as u32)
                            .map_or("-".to_string(), |dt| dt.to_string())
                    }),
                    duration: calculate_duration_from_timestamps(
                        execution.start_time,
                        execution.close_time,
                    ),
                });
            }
        }
    }

    Ok(workflows)
}

pub async fn list_workflows_history(
    project: &Project,
    status: Option<String>,
    limit: u32,
    json: bool,
) -> Result<RoutineSuccess, RoutineFailure> {
    let workflows = get_workflow_history(project, status, limit).await?;

    WorkflowInfo::display_list(workflows, json);

    Ok(RoutineSuccess::success(Message::new(
        "".to_string(),
        "".to_string(),
    )))
}

// Terminate is a hard stop. Temporal updates its server states
// but does not notify workers. Command is hidden for now because we probably
// want to use cancel instead, with a flag to force kill.
pub async fn terminate_workflow(
    project: &Project,
    name: &str,
) -> Result<RoutineSuccess, RoutineFailure> {
    let client_manager = TemporalClientManager::new_validate(&project.temporal_config, true)
        .map_err(|e| {
            RoutineFailure::error(Message {
                action: "Temporal".to_string(),
                details: format!("Failed to create client manager: {e}"),
            })
        })?;
    let namespace = project.temporal_config.get_temporal_namespace();

    let request = TerminateWorkflowExecutionRequest {
        namespace,
        workflow_execution: Some(
            temporal_sdk_core_protos::temporal::api::common::v1::WorkflowExecution {
                workflow_id: name.to_string(),
                run_id: "".to_string(),
            },
        ),
        reason: "Terminated by user request".to_string(),
        ..Default::default()
    };

    client_manager
        .execute(|mut client| async move {
            client
                .terminate_workflow_execution(request)
                .await
                .map_err(|e| anyhow::Error::msg(e.to_string()))
        })
        .await
        .map_err(|e| {
            let error_message = if e
                .to_string()
                .contains("workflow execution already completed")
            {
                format!("Workflow '{name}' has already completed")
            } else {
                format!("Could not terminate workflow '{name}': {e}")
            };

            RoutineFailure::error(Message {
                action: "Workflow".to_string(),
                details: format!("{error_message}\n"),
            })
        })?;

    Ok(RoutineSuccess::success(Message {
        action: "Workflow".to_string(),
        details: format!("'{name}' terminated successfully\n"),
    }))
}

// Cancel allows for graceful shutdown. Temporal sends a signal to the worker.
pub async fn cancel_workflow(
    project: &Project,
    name: &str,
) -> Result<RoutineSuccess, RoutineFailure> {
    let client_manager = TemporalClientManager::new_validate(&project.temporal_config, true)
        .map_err(|e| {
            RoutineFailure::error(Message {
                action: "Temporal".to_string(),
                details: format!("Failed to create client manager: {e}"),
            })
        })?;
    let namespace = project.temporal_config.get_temporal_namespace();

    let request = RequestCancelWorkflowExecutionRequest {
        namespace,
        workflow_execution: Some(WorkflowExecution {
            workflow_id: name.to_string(),
            run_id: "".to_string(),
        }),
        reason: "Cancelled by user request".to_string(),
        ..Default::default()
    };

    client_manager
        .execute(|mut client| async move {
            client
                .request_cancel_workflow_execution(request)
                .await
                .map_err(|e| anyhow::Error::msg(e.to_string()))
        })
        .await
        .map_err(|e| {
            let error_message = if e
                .to_string()
                .contains("workflow execution already completed")
            {
                format!("Workflow '{name}' has already completed")
            } else {
                format!("Could not cancel workflow '{name}': {e}")
            };

            RoutineFailure::error(Message {
                action: "Workflow".to_string(),
                details: format!("{error_message}\n"),
            })
        })?;

    Ok(RoutineSuccess::success(Message {
        action: "Workflow".to_string(),
        details: format!("'{name}' cancellation requested successfully\n"),
    }))
}

pub async fn terminate_all_workflows(project: &Project) -> Result<RoutineSuccess, RoutineFailure> {
    let client_manager = Arc::new(
        TemporalClientManager::new_validate(&project.temporal_config, true).map_err(|e| {
            RoutineFailure::error(Message {
                action: "Temporal".to_string(),
                details: format!("Failed to create client manager: {e}"),
            })
        })?,
    );
    let namespace = project.temporal_config.get_temporal_namespace();

    let request = ListWorkflowExecutionsRequest {
        namespace: namespace.clone(),
        page_size: 1000,
        query: "ExecutionStatus = 'Running'".to_string(),
        ..Default::default()
    };

    let response = client_manager
        .execute(|mut client| async move {
            // page size is in the ListWorkflowExecutionsRequest above
            client
                .list_workflow_executions(request)
                .await
                .map_err(|e| anyhow::Error::msg(e.to_string()))
        })
        .await
        .map_err(|e| {
            RoutineFailure::error(Message {
                action: "Workflow".to_string(),
                details: format!("Could not list workflows: {e}"),
            })
        })?;

    let executions = response.into_inner().executions;
    let total_workflows = executions.len();

    if total_workflows == 0 {
        return Ok(RoutineSuccess::success(Message {
            action: "Workflow".to_string(),
            details: "Found workflows: 0 | Terminated workflows: 0".to_string(),
        }));
    }

    let termination_futures: Vec<_> = executions
        .into_iter()
        .filter_map(|execution| execution.execution)
        .map(|execution_info| {
            let client_manager: Arc<TemporalClientManager> = Arc::clone(&client_manager);
            let namespace = namespace.clone();
            async move {
                let request = TerminateWorkflowExecutionRequest {
                    namespace,
                    workflow_execution: Some(WorkflowExecution {
                        workflow_id: execution_info.workflow_id.clone(),
                        run_id: execution_info.run_id,
                    }),
                    reason: "Bulk termination requested by user".to_string(),
                    ..Default::default()
                };

                client_manager
                    .execute(|mut client| async move {
                        client
                            .terminate_workflow_execution(request)
                            .await
                            .map_err(|e| anyhow::Error::msg(e.to_string()))
                    })
                    .await
                    .map(|_| execution_info.workflow_id)
            }
        })
        .collect();

    let results = try_join_all(termination_futures).await.map_err(|e| {
        RoutineFailure::error(Message {
            action: "Workflow".to_string(),
            details: format!("Failed to execute terminations: {e}"),
        })
    })?;

    Ok(RoutineSuccess::success(Message {
        action: "Workflow".to_string(),
        details: format!(
            "Found workflows: {} | Terminated workflows: {}",
            total_workflows,
            results.len(),
        ),
    }))
}

pub async fn pause_workflow(
    project: &Project,
    name: &str,
) -> Result<RoutineSuccess, RoutineFailure> {
    let client_manager = TemporalClientManager::new_validate(&project.temporal_config, true)
        .map_err(|e| {
            RoutineFailure::error(Message {
                action: "Temporal".to_string(),
                details: format!("Failed to create client manager: {e}"),
            })
        })?;
    let namespace = project.temporal_config.get_temporal_namespace();

    let request = SignalWorkflowExecutionRequest {
        namespace,
        workflow_execution: Some(
            temporal_sdk_core_protos::temporal::api::common::v1::WorkflowExecution {
                workflow_id: name.to_string(),
                run_id: "".to_string(),
            },
        ),
        signal_name: "pause".to_string(),
        input: None,
        ..Default::default()
    };

    client_manager
        .execute(|mut client| async move {
            client
                .signal_workflow_execution(request)
                .await
                .map_err(|e| anyhow::Error::msg(e.to_string()))
        })
        .await
        .map_err(|e| {
            RoutineFailure::error(Message {
                action: "Workflow".to_string(),
                details: format!("Could not pause workflow '{name}': {e}\n"),
            })
        })?;

    Ok(RoutineSuccess::success(Message {
        action: "Workflow".to_string(),
        details: format!("'{name}' paused successfully\n"),
    }))
}

pub async fn unpause_workflow(
    project: &Project,
    name: &str,
) -> Result<RoutineSuccess, RoutineFailure> {
    let client_manager = TemporalClientManager::new_validate(&project.temporal_config, true)
        .map_err(|e| {
            RoutineFailure::error(Message {
                action: "Temporal".to_string(),
                details: format!("Failed to create client manager: {e}"),
            })
        })?;
    let namespace = project.temporal_config.get_temporal_namespace();

    let request = SignalWorkflowExecutionRequest {
        namespace,
        workflow_execution: Some(
            temporal_sdk_core_protos::temporal::api::common::v1::WorkflowExecution {
                workflow_id: name.to_string(),
                run_id: "".to_string(),
            },
        ),
        signal_name: "unpause".to_string(),
        input: None,
        ..Default::default()
    };

    client_manager
        .execute(|mut client| async move {
            client
                .signal_workflow_execution(request)
                .await
                .map_err(|e| anyhow::Error::msg(e.to_string()))
        })
        .await
        .map_err(|e| {
            RoutineFailure::error(Message {
                action: "Workflow".to_string(),
                details: format!("Could not unpause workflow '{name}': {e}\n"),
            })
        })?;

    Ok(RoutineSuccess::success(Message {
        action: "Workflow".to_string(),
        details: format!("'{name}' unpaused successfully\n"),
    }))
}

// Helper function to parse failure information from JSON messages
fn parse_failure_json(
    message: &str,
) -> (
    Option<serde_json::Value>,
    Option<serde_json::Value>,
    Option<serde_json::Value>,
) {
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(message) {
        (
            json.get("details").cloned(),
            json.get("stack").cloned(),
            json.get("error").cloned(),
        )
    } else {
        (None, None, None)
    }
}

// Helper function to process failure attributes into structured data
fn process_failure_attributes(
    failure: &temporal_sdk_core_protos::temporal::api::failure::v1::Failure,
    event_data: &mut serde_json::Value,
) -> serde_json::Map<String, serde_json::Value> {
    event_data["error"] = serde_json::json!(failure.message);

    let mut summary = serde_json::Map::new();
    summary.insert("error".to_string(), serde_json::json!(failure.message));

    // Process main failure message
    let (details, stack, error_type) = parse_failure_json(&failure.message);
    if let Some(details) = details {
        event_data["details"] = details.clone();
        summary.insert("details".to_string(), details);
    }
    if let Some(stack) = stack {
        event_data["stack"] = stack.clone();
        summary.insert("stack".to_string(), stack);
    }
    if let Some(error_type) = error_type {
        event_data["error_type"] = error_type.clone();
        summary.insert("error_type".to_string(), error_type);
    }

    // Process cause if present
    if let Some(cause) = &failure.cause {
        let (cause_details, cause_stack, cause_error_type) = parse_failure_json(&cause.message);
        if let Some(details) = cause_details {
            event_data["details"] = details.clone();
            summary.insert("details".to_string(), details);
        }
        if let Some(stack) = cause_stack {
            event_data["stack"] = stack.clone();
            summary.insert("stack".to_string(), stack);
        }
        if let Some(error_type) = cause_error_type {
            event_data["error_type"] = error_type.clone();
            summary.insert("error_type".to_string(), error_type);
        }
    }

    summary
}

// Helper function to format failure information for text output
fn format_failure_text(
    failure: &temporal_sdk_core_protos::temporal::api::failure::v1::Failure,
) -> String {
    let mut text = format!("\n    Error: {}", failure.message);

    let (details, stack, error_type) = parse_failure_json(&failure.message);
    if let Some(details) = details {
        text.push_str(&format!("\n    Details: {details}"));
    }
    if let Some(stack) = stack {
        text.push_str(&format!("\n    Stack: {stack}"));
    }
    if let Some(error_type) = error_type {
        text.push_str(&format!("\n    Error Type: {error_type}"));
    }

    // Process cause if present
    if let Some(cause) = &failure.cause {
        let (cause_details, cause_stack, cause_error_type) = parse_failure_json(&cause.message);
        if let Some(details) = cause_details {
            text.push_str(&format!("\n    Details: {details}"));
        }
        if let Some(stack) = cause_stack {
            text.push_str(&format!("\n    Stack: {stack}"));
        }
        if let Some(error_type) = cause_error_type {
            text.push_str(&format!("\n    Error Type: {error_type}"));
        }
    }

    text
}

// Helper function to process activity task result
fn process_activity_result(
    result: &temporal_sdk_core_protos::temporal::api::common::v1::Payloads,
) -> Option<serde_json::Value> {
    for payload in &result.payloads {
        if let Ok(data_str) = String::from_utf8(payload.data.clone()) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data_str) {
                return Some(json);
            } else if let Ok(decoded) = decode_base64_to_json(&data_str) {
                return Some(decoded);
            }
        }
    }
    None
}

// Helper function to format activity result for text output
fn format_activity_result_text(
    result: &temporal_sdk_core_protos::temporal::api::common::v1::Payloads,
) -> String {
    let mut text = String::from("\n    Result: ");

    for payload in &result.payloads {
        match String::from_utf8(payload.data.clone()) {
            Ok(data_str) => match serde_json::from_str::<serde_json::Value>(&data_str) {
                Ok(json) => {
                    let json_str = serde_json::to_string_pretty(&json).unwrap_or_default();
                    let indented = json_str
                        .lines()
                        .map(|line| format!("      {line}"))
                        .collect::<Vec<_>>()
                        .join("\n");
                    text.push_str(&format!("\n{indented}"));
                }
                Err(_) => match decode_base64_to_json(&data_str) {
                    Ok(decoded) => {
                        let json_str = serde_json::to_string_pretty(&decoded).unwrap_or_default();
                        let indented = json_str
                            .lines()
                            .map(|line| format!("      {line}"))
                            .collect::<Vec<_>>()
                            .join("\n");
                        text.push_str(&format!("\n{indented}"));
                    }
                    Err(e) => {
                        text.push_str(&format!("Failed to parse payload: {e}"));
                    }
                },
            },
            Err(_) => {
                text.push_str(&format!("Invalid UTF-8 in payload: {payload:?}"));
            }
        }
    }

    text
}

pub async fn get_workflow_status(
    project: &Project,
    name: &str,
    run_id: Option<String>,
    verbose: bool,
    json: bool,
) -> Result<RoutineSuccess, RoutineFailure> {
    let client_manager = TemporalClientManager::new_validate(&project.temporal_config, true)
        .map_err(|e| {
            RoutineFailure::error(Message {
                action: "Temporal".to_string(),
                details: format!("Failed to create client manager: {e}"),
            })
        })?;
    let namespace = project.temporal_config.get_temporal_namespace();

    // If no run_id provided, get the most recent one
    let execution_id = if let Some(id) = run_id {
        id
    } else {
        // List workflows to get most recent
        let request = ListWorkflowExecutionsRequest {
            namespace: namespace.clone(),
            page_size: 1,
            query: format!("WorkflowId = '{name}'"),
            ..Default::default()
        };

        let response = client_manager
            .execute(|mut client| async move {
                client
                    .list_workflow_executions(request)
                    .await
                    .map_err(|e| anyhow::Error::msg(e.to_string()))
            })
            .await
            .map_err(|e| {
                RoutineFailure::error(Message {
                    action: "Workflow".to_string(),
                    details: format!("Could not find workflow '{name}': {e}\n"),
                })
            })?;

        let executions = response.into_inner().executions;
        if executions.is_empty() {
            return Err(RoutineFailure::error(Message {
                action: "Workflow".to_string(),
                details: format!("No executions found for workflow '{name}'\n"),
            }));
        }

        executions[0].execution.as_ref().unwrap().run_id.clone()
    };

    // Get workflow details
    let request = DescribeWorkflowExecutionRequest {
        namespace: namespace.clone(),
        execution: Some(
            temporal_sdk_core_protos::temporal::api::common::v1::WorkflowExecution {
                workflow_id: name.to_string(),
                run_id: execution_id.clone(),
            },
        ),
    };

    let response = client_manager
        .execute(|mut client| async move {
            client
                .describe_workflow_execution(request)
                .await
                .map_err(|e| anyhow::Error::msg(e.to_string()))
        })
        .await
        .map_err(|e| {
            RoutineFailure::error(Message {
                action: "Workflow".to_string(),
                details: format!("Could not get status for workflow '{name}': {e}\n"),
            })
        })?;

    let info = response.into_inner().workflow_execution_info.unwrap();

    let status = WorkflowExecutionStatus::try_from(info.status)
        .map(|s| s.as_str_name().to_string())
        .unwrap_or_else(|_| "UNKNOWN".to_string());

    let status_emoji = match WorkflowExecutionStatus::try_from(info.status) {
        Ok(status) => match status {
            WorkflowExecutionStatus::Running => "⏳",
            WorkflowExecutionStatus::Completed => "✅",
            WorkflowExecutionStatus::Failed => "❌",
            _ => "❓",
        },
        Err(_) => "❓",
    };

    let start_time = DateTime::<Utc>::from_timestamp(
        info.start_time.as_ref().unwrap().seconds,
        info.start_time.as_ref().unwrap().nanos as u32,
    )
    .unwrap();

    let execution_time = Utc::now().signed_duration_since(start_time);

    // Create a data structure for JSON output
    let mut status_data = serde_json::json!({
        "workflow_name": name,
        "run_id": execution_id,
        "status": status,
        "status_emoji": status_emoji,
        "execution_time_seconds": execution_time.num_seconds(),
        "start_time": start_time,
    });

    let mut failure_summary_for_text = None;
    if verbose {
        let mut events = Vec::new();
        let mut next_page_token = Vec::new();
        let mut failure_summary: Option<serde_json::Value> = None;

        loop {
            let history_request = GetWorkflowExecutionHistoryRequest {
                namespace: namespace.clone(),
                execution: Some(WorkflowExecution {
                    workflow_id: name.to_string(),
                    run_id: execution_id.clone(),
                }),
                next_page_token: next_page_token.clone(),
                ..Default::default()
            };

            let history_response = client_manager
                .execute(|mut client| async move {
                    client
                        .get_workflow_execution_history(history_request)
                        .await
                        .map_err(|e| anyhow::Error::msg(e.to_string()))
                })
                .await
                .map_err(|e| {
                    RoutineFailure::error(Message {
                        action: "Workflow".to_string(),
                        details: format!("Could not fetch history for workflow '{name}': {e}\n"),
                    })
                })?;

            if let Some(history) = history_response.get_ref().history.as_ref() {
                for event in &history.events {
                    if let Ok(event_type) =
                        temporal_sdk_core_protos::temporal::api::enums::v1::EventType::try_from(
                            event.event_type,
                        )
                    {
                        let timestamp =
                            event
                                .event_time
                                .as_ref()
                                .map_or(String::from("unknown time"), |ts| {
                                    chrono::DateTime::from_timestamp(ts.seconds, ts.nanos as u32)
                                        .map_or("invalid time".to_string(), |dt| dt.to_rfc3339())
                                });

                        let mut event_data = serde_json::json!({
                            "timestamp": timestamp,
                            "type": event_type.as_str_name(),
                        });

                        // Add event attributes
                        if let Some(attrs) = &event.attributes {
                            match attrs {
                                temporal_sdk_core_protos::temporal::api::history::v1::history_event::Attributes::ActivityTaskScheduledEventAttributes(attr) => {
                                    if let Some(activity_type) = &attr.activity_type {
                                        event_data["activity"] = serde_json::json!(activity_type.name);
                                    }
                                },
                                temporal_sdk_core_protos::temporal::api::history::v1::history_event::Attributes::ActivityTaskCompletedEventAttributes(attr) => {
                                    if let Some(result) = &attr.result {
                                        if let Some(result_data) = process_activity_result(result) {
                                            event_data["result"] = result_data;
                                        }
                                    }
                                },
                                temporal_sdk_core_protos::temporal::api::history::v1::history_event::Attributes::ActivityTaskFailedEventAttributes(attr) => {
                                    if let Some(failure) = &attr.failure {
                                        process_failure_attributes(failure, &mut event_data);
                                    }
                                },
                                temporal_sdk_core_protos::temporal::api::history::v1::history_event::Attributes::ChildWorkflowExecutionFailedEventAttributes(attr) => {
                                    if let Some(failure) = &attr.failure {
                                        process_failure_attributes(failure, &mut event_data);
                                    }
                                },
                                temporal_sdk_core_protos::temporal::api::history::v1::history_event::Attributes::WorkflowExecutionFailedEventAttributes(attr) => {
                                    if let Some(failure) = &attr.failure {
                                        let summary = process_failure_attributes(failure, &mut event_data);
                                        failure_summary = Some(serde_json::Value::Object(summary));
                                    }
                                },
                                temporal_sdk_core_protos::temporal::api::history::v1::history_event::Attributes::WorkflowExecutionCompletedEventAttributes(_) => {
                                    event_data["details"] = serde_json::json!("Workflow completed successfully");
                                },
                                _ => {}
                            }
                        }
                        events.push(event_data);
                    }
                }
                next_page_token = history_response.get_ref().next_page_token.clone();
                if next_page_token.is_empty() {
                    break;
                }
            } else {
                break;
            }
        }
        status_data["events"] = serde_json::json!(events);
        if let Some(summary) = &failure_summary {
            status_data["failure_summary"] = summary.clone();
        }
        failure_summary_for_text = failure_summary.clone();
    }

    if json {
        Ok(RoutineSuccess::success(Message {
            action: "".to_string(),
            details: serde_json::to_string_pretty(&status_data).unwrap(),
        }))
    } else {
        // Existing text output format
        let mut details = String::new();
        // Print summary if present
        if let Some(summary) = failure_summary_for_text {
            details.push_str("--- Failure Summary ---\n");
            if let Some(error) = summary.get("error") {
                details.push_str(&format!("Error: {error}\n"));
            }
            if let Some(error_type) = summary.get("error_type") {
                details.push_str(&format!("Error Type: {error_type}\n"));
            }
            if let Some(details_val) = summary.get("details") {
                details.push_str(&format!("Details: {details_val}\n"));
            }
            if let Some(stack) = summary.get("stack") {
                details.push_str(&format!("Stack Trace:\n{stack}\n"));
            }
            details.push_str("----------------------\n\n");
        }
        details.push_str(&format!(
            "Workflow Status: {}\nRun ID: {}\nStatus: {} {}\nExecution Time: {}s\n",
            name,
            execution_id,
            status,
            status_emoji,
            execution_time.num_seconds()
        ));

        if verbose {
            let history_request = GetWorkflowExecutionHistoryRequest {
                namespace: namespace.clone(),
                execution: Some(WorkflowExecution {
                    workflow_id: name.to_string(),
                    run_id: execution_id.clone(),
                }),
                ..Default::default()
            };

            details.push_str(&format!("Request: {history_request:?}\n"));

            let history_response = client_manager
                .execute(|mut client| async move {
                    client
                        .get_workflow_execution_history(history_request)
                        .await
                        .map_err(|e| anyhow::Error::msg(e.to_string()))
                })
                .await
                .map_err(|e| {
                    RoutineFailure::error(Message {
                        action: "Workflow".to_string(),
                        details: format!("Could not fetch history for workflow: {e}\n"),
                    })
                })?;

            if let Some(history) = history_response.into_inner().history {
                details.push_str(&format!("\nFound {} events\n", history.events.len()));
                details.push_str("Event History:\n");

                for event in history.events {
                    let code = event.event_type;
                    if let Ok(event_type) =
                        temporal_sdk_core_protos::temporal::api::enums::v1::EventType::try_from(
                            code,
                        )
                    {
                        let timestamp =
                            event.event_time.map_or(String::from("unknown time"), |ts| {
                                chrono::DateTime::from_timestamp(ts.seconds, ts.nanos as u32)
                                    .map_or("invalid time".to_string(), |dt| dt.to_rfc3339())
                            });

                        // Format the basic event info with bullet point
                        details.push_str(&format!(
                            "  • [{}] {}",
                            timestamp,
                            event_type.as_str_name()
                        ));

                        // Add relevant details based on event type
                        if let Some(attrs) = &event.attributes {
                            match attrs {
                                temporal_sdk_core_protos::temporal::api::history::v1::history_event::Attributes::ActivityTaskScheduledEventAttributes(attr) => {
                                    if let Some(activity_type) = &attr.activity_type {
                                        details.push_str(&format!("\n    Activity: {}", activity_type.name));
                                    }
                                },
                                temporal_sdk_core_protos::temporal::api::history::v1::history_event::Attributes::ActivityTaskCompletedEventAttributes(attr) => {
                                    if let Some(result) = &attr.result {
                                        details.push_str(&format_activity_result_text(result));
                                    }
                                },
                                temporal_sdk_core_protos::temporal::api::history::v1::history_event::Attributes::ActivityTaskFailedEventAttributes(attr) => {
                                    if let Some(failure) = &attr.failure {
                                        details.push_str(&format_failure_text(failure));
                                    }
                                },
                                temporal_sdk_core_protos::temporal::api::history::v1::history_event::Attributes::ChildWorkflowExecutionFailedEventAttributes(attr) => {
                                    if let Some(failure) = &attr.failure {
                                        details.push_str(&format_failure_text(failure));
                                    }
                                },
                                temporal_sdk_core_protos::temporal::api::history::v1::history_event::Attributes::WorkflowExecutionFailedEventAttributes(attr) => {
                                    if let Some(failure) = &attr.failure {
                                        details.push_str(&format_failure_text(failure));
                                    }
                                },
                                temporal_sdk_core_protos::temporal::api::history::v1::history_event::Attributes::WorkflowExecutionCompletedEventAttributes(_) => {
                                    details.push_str("\n    Workflow completed successfully");
                                },
                                _ => {}
                            }
                        }
                        details.push('\n');
                    }
                }
            } else {
                details.push_str("No history found in response\n");
            }
        } else {
            details.push_str("Verbose flag not set\n");
        }

        Ok(RoutineSuccess::success(Message {
            action: "Workflow".to_string(),
            details,
        }))
    }
}
