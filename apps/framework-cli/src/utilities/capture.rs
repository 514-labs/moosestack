//! # Capture Utility
//!
//! This module leverages moose to instrument moose. It includes a macro to easily capture data anywhere in the codebase.
//!
use crate::cli::settings::Settings;
use crate::utilities::constants::{CLI_VERSION, CONTEXT, CTX_SESSION_ID};
use posthog514client_rs::PostHog514Client;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use uuid::Uuid;

fn collect_cli_flags() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter_map(|arg| {
            if arg.starts_with('-') {
                Some(arg.split('=').next().unwrap_or("").to_string())
            } else {
                None
            }
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
pub enum ActivityType {
    #[serde(rename = "buildCommand")]
    BuildCommand,
    #[serde(rename = "planCommand")]
    PlanCommand,
    #[serde(rename = "migrateCommand")]
    MigrateCommand,
    #[serde(rename = "cleanCommand")]
    CleanCommand,
    #[serde(rename = "checkCommand")]
    CheckCommand,
    #[serde(rename = "devCommand")]
    DevCommand,
    #[serde(rename = "dockerCommand")]
    DockerCommand,
    #[serde(rename = "initCommand")]
    InitCommand,
    #[serde(rename = "initTemplateCommand")]
    InitTemplateCommand,
    #[serde(rename = "logsCommand")]
    LogsCommand,
    #[serde(rename = "lsCommand")]
    LsCommand,
    #[serde(rename = "prodCommand")]
    ProdCommand,
    #[serde(rename = "psCommand")]
    PsCommand,
    #[serde(rename = "stopCommand")]
    StopCommand,
    #[serde(rename = "metricsCommand")]
    MetricsCommand,
    #[serde(rename = "importCommand")]
    ImportCommand,
    #[serde(rename = "generateHashCommand")]
    GenerateHashCommand,
    #[serde(rename = "generateMigrationCommand")]
    GenerateMigrationCommand,
    #[serde(rename = "generateSDKCommand")]
    GenerateSDKCommand,
    #[serde(rename = "peekCommand")]
    PeekCommand,
    #[serde(rename = "queryCommand")]
    QueryCommand,
    #[serde(rename = "workflowCommand")]
    WorkflowCommand,
    #[serde(rename = "workflowInitCommand")]
    WorkflowInitCommand,
    #[serde(rename = "workflowRunCommand")]
    WorkflowRunCommand,
    #[serde(rename = "workflowListCommand")]
    WorkflowListCommand,
    #[serde(rename = "workflowResumeCommand")]
    WorkflowResumeCommand,
    #[serde(rename = "workflowTerminateCommand")]
    WorkflowTerminateCommand,
    #[serde(rename = "workflowPauseCommand")]
    WorkflowPauseCommand,
    #[serde(rename = "workflowUnpauseCommand")]
    WorkflowUnpauseCommand,
    #[serde(rename = "workflowStatusCommand")]
    WorkflowStatusCommand,
    #[serde(rename = "templateListCommand")]
    TemplateListCommand,
    #[serde(rename = "refreshListCommand")]
    RefreshListCommand,
    #[serde(rename = "dbPullCommand")]
    DbPullCommand,
}

pub fn capture_usage(
    activity_type: ActivityType,
    project_name: Option<String>,
    settings: &Settings,
    machine_id: String,
    parameters: HashMap<String, String>,
) -> Option<tokio::task::JoinHandle<()>> {
    // Skip if telemetry is disabled
    if !settings.telemetry.enabled {
        return None;
    }

    let sequence_id = CONTEXT.get(CTX_SESSION_ID).unwrap().clone();
    let event_id = Uuid::new_v4();
    let is_moose_developer = settings.telemetry.is_moose_developer;
    let project = project_name.clone().unwrap_or_else(|| "N/A".to_string());

    // Create context for the event
    let mut context: HashMap<String, serde_json::Value> = HashMap::new();
    context.insert("event_id".into(), event_id.to_string().into());
    context.insert("command".into(), json!(activity_type));
    context.insert("sequence_id".into(), sequence_id.into());
    context.insert("project".into(), project.into());

    parameters.iter().for_each(|(key, value)| {
        context.insert(key.to_string(), value.to_string().into());
    });

    // Add list of flags used on the CLI invocation, if any
    let flags = collect_cli_flags();
    if !flags.is_empty() {
        context.insert("flags".into(), json!(flags));
    }

    // Create PostHog client
    Some(tokio::task::spawn(async move {
        let client = match PostHog514Client::from_env(machine_id) {
            Some(client) => client,
            None => {
                tracing::warn!("PostHog client not configured - missing POSTHOG_API_KEY");
                return;
            }
        };

        if let Err(e) = client
            .capture_cli_command(
                "moose_cli_command",
                project_name,
                Some(context),
                CLI_VERSION.to_string(),
                is_moose_developer,
            )
            .await
        {
            tracing::warn!("Failed to send telemetry to PostHog: {:?}", e);
        }
    }))
}

pub async fn wait_for_usage_capture(handle: Option<tokio::task::JoinHandle<()>>) {
    if let Some(handle) = handle {
        let _ = handle.await;
    }
}
