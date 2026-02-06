//! Feedback command: send feedback via PostHog, report bugs, or join the community.

use crate::cli::display::Message;
use crate::cli::routines::{RoutineFailure, RoutineSuccess};
use crate::cli::settings::{user_directory, Settings};
use crate::utilities::capture::{capture_usage, wait_for_usage_capture, ActivityType};
use crate::utilities::constants::{CLI_VERSION, GITHUB_ISSUES_URL, SLACK_COMMUNITY_URL};
use std::collections::HashMap;

/// Build a GitHub issue URL with pre-filled environment info
fn build_issue_url(include_logs: bool) -> String {
    let log_section = if include_logs {
        let path = user_directory().to_string_lossy().to_string();
        format!(
            "\n\n## Logs\nLog files are located at: `{}`\n\nPlease attach relevant log files.",
            path
        )
    } else {
        String::new()
    };

    let body = format!(
        "## Description\n\n<!-- Describe the issue -->\n\n## Environment\n- CLI Version: {}\n- OS: {}\n- Architecture: {}{}",
        CLI_VERSION,
        std::env::consts::OS,
        std::env::consts::ARCH,
        log_section
    );

    format!("{}?body={}", GITHUB_ISSUES_URL, urlencoding::encode(&body))
}

/// Send feedback message as a PostHog telemetry event
pub async fn send_feedback(
    message: &str,
    settings: &Settings,
    machine_id: String,
) -> Result<RoutineSuccess, RoutineFailure> {
    let mut params = HashMap::new();
    params.insert("feedback_message".to_string(), message.to_string());

    let handle = capture_usage(
        ActivityType::FeedbackCommand,
        None,
        settings,
        machine_id,
        params,
    );

    wait_for_usage_capture(handle).await;

    Ok(RoutineSuccess::success(Message::new(
        "Sent".to_string(),
        "Thank you for your feedback!".to_string(),
    )))
}

/// Open GitHub Issues for bug reporting
pub fn report_bug(logs: bool) -> Result<RoutineSuccess, RoutineFailure> {
    let url = build_issue_url(logs);

    open::that(&url).map_err(|e| {
        RoutineFailure::new(
            Message::new("Failed".to_string(), "to open GitHub Issues".to_string()),
            anyhow::anyhow!("{}", e),
        )
    })?;

    let details = if logs {
        let path = user_directory().to_string_lossy().to_string();
        format!("Opening GitHub Issues. Log files are at: {}", path)
    } else {
        "Opening GitHub Issues in your browser".to_string()
    };

    Ok(RoutineSuccess::success(Message::new(
        "Bug report".to_string(),
        details,
    )))
}

/// Open Slack community invite
pub fn join_community() -> Result<RoutineSuccess, RoutineFailure> {
    open::that(SLACK_COMMUNITY_URL).map_err(|e| {
        RoutineFailure::new(
            Message::new("Failed".to_string(), "to open Slack community".to_string()),
            anyhow::anyhow!("{}", e),
        )
    })?;

    Ok(RoutineSuccess::success(Message::new(
        "Community".to_string(),
        "Opening Moose Slack community in your browser".to_string(),
    )))
}

/// Show usage help when no args are provided
pub fn show_help() -> Result<RoutineSuccess, RoutineFailure> {
    println!();
    println!("  Send feedback:         moose feedback \"loving the DX!\"");
    println!("  Report a bug:          moose feedback --bug");
    println!("  Report with logs:      moose feedback --bug --logs");
    println!("  Join the community:    moose feedback --community");
    println!();

    Ok(RoutineSuccess::success(Message::new(
        "Feedback".to_string(),
        "Use the commands above to get in touch".to_string(),
    )))
}
