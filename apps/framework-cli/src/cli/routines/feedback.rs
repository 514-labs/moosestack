//! Feedback command routines for submitting feedback, reporting issues, and joining the community.

use crate::cli::display::{Message, MessageType};
use crate::cli::routines::{RoutineFailure, RoutineSuccess};
use crate::cli::settings::user_directory;
use crate::utilities::constants::{
    CLI_VERSION, DOCS_URL, GITHUB_DISCUSSIONS_URL, GITHUB_ISSUES_URL, SLACK_COMMUNITY_URL,
    TROUBLESHOOTING_URL,
};

/// Error type for feedback operations
#[derive(thiserror::Error, Debug)]
pub enum FeedbackError {
    #[error("Failed to open URL: {0}")]
    OpenUrlError(String),
}

/// Opens a URL in the default browser
fn open_url(url: &str) -> Result<(), FeedbackError> {
    open::that(url).map_err(|e| FeedbackError::OpenUrlError(e.to_string()))
}

/// Get the path to CLI log files
fn get_log_path() -> String {
    user_directory().to_string_lossy().to_string()
}

/// Build a GitHub issue URL with pre-filled information
fn build_issue_url(include_logs: bool) -> String {
    let version = CLI_VERSION;
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let log_section = if include_logs {
        format!(
            "\n\n## Logs\nLog files are located at: `{}`\n\nPlease attach relevant log files if applicable.",
            get_log_path()
        )
    } else {
        String::new()
    };

    let body = format!(
        "## Description\n\n<!-- Please describe the issue or bug you encountered -->\n\n## Environment\n- CLI Version: {}\n- OS: {}\n- Architecture: {}{}",
        version, os, arch, log_section
    );

    let encoded_body = urlencoding::encode(&body);
    format!("{}?body={}", GITHUB_ISSUES_URL, encoded_body)
}

/// Execute the feedback command
pub fn feedback(
    bug: bool,
    idea: bool,
    community: bool,
    logs: bool,
) -> Result<RoutineSuccess, RoutineFailure> {
    // Determine action based on flags (if none specified, show interactive menu)
    if community {
        open_url(SLACK_COMMUNITY_URL).map_err(|e| {
            RoutineFailure::new(
                Message::new("Failed".to_string(), "to open Slack community".to_string()),
                e,
            )
        })?;

        return Ok(RoutineSuccess::success(Message::new(
            "Opening".to_string(),
            "Moose community Slack in your browser".to_string(),
        )));
    }

    if idea {
        open_url(GITHUB_DISCUSSIONS_URL).map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Failed".to_string(),
                    "to open GitHub Discussions".to_string(),
                ),
                e,
            )
        })?;

        return Ok(RoutineSuccess::success(Message::new(
            "Opening".to_string(),
            "GitHub Discussions for feature requests and ideas".to_string(),
        )));
    }

    if bug {
        let url = build_issue_url(logs);
        open_url(&url).map_err(|e| {
            RoutineFailure::new(
                Message::new("Failed".to_string(), "to open GitHub Issues".to_string()),
                e,
            )
        })?;

        let log_msg = if logs {
            format!(" Log files are at: {}", get_log_path())
        } else {
            String::new()
        };

        return Ok(RoutineSuccess::success(Message::new(
            "Opening".to_string(),
            format!("GitHub Issues to report a bug.{}", log_msg),
        )));
    }

    // Default: show feedback options and resources
    crate::cli::display::show_message_wrapper(
        MessageType::Info,
        Message::new("Feedback".to_string(), "Ways to reach us:".to_string()),
    );

    println!();
    println!("  Report a bug:          moose feedback --bug");
    println!("  Request a feature:     moose feedback --idea");
    println!("  Join the community:    moose feedback --community");
    println!();
    println!("  Include logs:          moose feedback --bug --logs");
    println!();
    println!("Resources:");
    println!("  Documentation:         {}", DOCS_URL);
    println!("  Troubleshooting:       {}", TROUBLESHOOTING_URL);
    println!("  GitHub Issues:         {}", GITHUB_ISSUES_URL);
    println!("  GitHub Discussions:    {}", GITHUB_DISCUSSIONS_URL);
    println!("  Slack Community:       {}", SLACK_COMMUNITY_URL);
    println!();

    Ok(RoutineSuccess::success(Message::new(
        "Feedback".to_string(),
        "Use the commands above to submit feedback".to_string(),
    )))
}
