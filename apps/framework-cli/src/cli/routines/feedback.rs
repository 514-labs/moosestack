//! Feedback command: send feedback via PostHog, report bugs, or join the community.

use crate::cli::display::Message;
use crate::cli::routines::{RoutineFailure, RoutineSuccess};
use crate::cli::settings::{user_directory, Settings};
use crate::utilities::capture::{
    capture_usage, identify_user_with_email, wait_for_usage_capture, ActivityType,
};
use crate::utilities::constants::{
    CLI_VERSION, GITHUB_ISSUES_URL, SLACK_COMMUNITY_URL, SUPPORT_EMAIL,
};
use std::collections::HashMap;

/// Build a GitHub issue URL with pre-filled environment info, log paths, and optional description
fn build_issue_url(description: Option<&str>) -> String {
    let description_text = match description {
        Some(msg) => msg.to_string(),
        None => "<!-- Describe the issue -->".to_string(),
    };

    let log_path = user_directory().to_string_lossy().to_string();

    let body = format!(
        "## Description\n\n{}\n\n## Environment\n- CLI Version: {}\n- OS: {}\n- Architecture: {}\n\n## Logs\nLog files are located at: `{}`\n\nPlease attach relevant log files if applicable.",
        description_text,
        CLI_VERSION,
        std::env::consts::OS,
        std::env::consts::ARCH,
        log_path
    );

    let title = description.unwrap_or_default();
    let encoded_body = urlencoding::encode(&body);
    let encoded_title = urlencoding::encode(title);
    format!(
        "{}?title={}&body={}",
        GITHUB_ISSUES_URL, encoded_title, encoded_body
    )
}

/// Validates email format (basic check for @ with characters before and after)
fn is_valid_email(email: &str) -> bool {
    if let Some(at_pos) = email.find('@') {
        // Check there are characters before and after @
        at_pos > 0 && at_pos < email.len() - 1
    } else {
        false
    }
}

/// Handle invalid email with user prompts (with retry limit)
fn handle_invalid_email_with_depth(_invalid_email: &str, depth: u8) -> Option<String> {
    use std::io::{self, IsTerminal, Write};

    // Only prompt if stdin is a TTY (interactive terminal)
    if !io::stdin().is_terminal() {
        return None;
    }

    // Prevent stack overflow - limit retry depth to 3 attempts
    if depth >= 3 {
        println!("\nToo many invalid attempts. Sending without email.");
        return None;
    }

    println!("\nWhat would you like to do?");
    println!("  1. Send anyway");
    println!("  2. Enter a different email");
    print!("\nChoice (1-2): ");
    let _ = io::stdout().flush();

    let mut choice = String::new();
    if io::stdin().read_line(&mut choice).is_ok() {
        match choice.trim() {
            "1" => None, // Send without email
            "2" => {
                // Prompt for new email
                print!("\nEnter email: ");
                let _ = io::stdout().flush();
                let mut new_email = String::new();
                if io::stdin().read_line(&mut new_email).is_ok() {
                    let trimmed = new_email.trim();
                    if !trimmed.is_empty() {
                        if is_valid_email(trimmed) {
                            return Some(trimmed.to_string());
                        } else {
                            // Recursive call with incremented depth
                            return handle_invalid_email_with_depth(trimmed, depth + 1);
                        }
                    }
                }
                None
            }
            _ => None, // Invalid choice - send without email
        }
    } else {
        None
    }
}

/// Handle invalid email with user prompts
fn handle_invalid_email(invalid_email: &str) -> Option<String> {
    handle_invalid_email_with_depth(invalid_email, 0)
}

/// Prompt user for optional email input with validation
fn prompt_for_email() -> Option<String> {
    use std::io::{self, IsTerminal, Write};

    // Only prompt if stdin is a TTY (interactive terminal)
    if !io::stdin().is_terminal() {
        return None;
    }

    print!("Your email (optional, press Enter to skip):\n> ");
    let _ = io::stdout().flush();

    let mut input = String::new();
    if io::stdin().read_line(&mut input).is_ok() {
        let trimmed = input.trim();
        if !trimmed.is_empty() {
            if is_valid_email(trimmed) {
                return Some(trimmed.to_string());
            } else {
                return handle_invalid_email(trimmed);
            }
        }
    }
    None
}

/// Send feedback message as a PostHog telemetry event
pub async fn send_feedback(
    message: &str,
    email_flag: Option<&str>,
    settings: &Settings,
    machine_id: String,
) -> Result<RoutineSuccess, RoutineFailure> {
    if !settings.telemetry.enabled {
        return Err(RoutineFailure::error(Message::new(
            "Telemetry disabled".to_string(),
            format!(
                "Feedback requires telemetry to be enabled. You can email us instead at {}",
                SUPPORT_EMAIL
            ),
        )));
    }

    // Use email from flag if provided (with validation), otherwise prompt the user
    let email = match email_flag {
        Some(e) => {
            if is_valid_email(e) {
                Some(e.to_string())
            } else {
                // Email from flag is invalid - prompt user for options
                handle_invalid_email(e)
            }
        }
        None => prompt_for_email(),
    };

    // If email is provided, identify the user with PostHog
    if let Some(ref email_value) = email {
        let identify_handle = identify_user_with_email(email_value, settings, machine_id.clone());
        wait_for_usage_capture(identify_handle).await;
    }

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

    let success_message = if email.is_some() {
        "Thank you for your feedback! We'll follow up if needed."
    } else {
        "Thank you for your feedback!"
    };

    Ok(RoutineSuccess::success(Message::new(
        "Sent".to_string(),
        success_message.to_string(),
    )))
}

/// Open GitHub Issues for bug reporting
pub async fn report_bug(
    description: Option<&str>,
    settings: &Settings,
    machine_id: String,
) -> Result<RoutineSuccess, RoutineFailure> {
    let url = build_issue_url(description);

    open::that(&url).map_err(|e| {
        RoutineFailure::new(
            Message::new("Failed".to_string(), "to open GitHub Issues".to_string()),
            e,
        )
    })?;

    let mut params = HashMap::new();
    params.insert("action".to_string(), "report_bug".to_string());
    if let Some(desc) = description {
        params.insert("description".to_string(), desc.to_string());
    }
    let handle = capture_usage(
        ActivityType::FeedbackCommand,
        None,
        settings,
        machine_id,
        params,
    );
    wait_for_usage_capture(handle).await;

    let path = user_directory().to_string_lossy().to_string();
    Ok(RoutineSuccess::success(Message::new(
        "Bug report".to_string(),
        format!("Opening GitHub Issues. Log files are at: {}", path),
    )))
}

/// Open Slack community invite
pub async fn join_community(
    settings: &Settings,
    machine_id: String,
) -> Result<RoutineSuccess, RoutineFailure> {
    open::that(SLACK_COMMUNITY_URL).map_err(|e| {
        RoutineFailure::new(
            Message::new("Failed".to_string(), "to open Slack community".to_string()),
            e,
        )
    })?;

    let mut params = HashMap::new();
    params.insert("action".to_string(), "join_community".to_string());
    let handle = capture_usage(
        ActivityType::FeedbackCommand,
        None,
        settings,
        machine_id,
        params,
    );
    wait_for_usage_capture(handle).await;

    Ok(RoutineSuccess::success(Message::new(
        "Community".to_string(),
        "Opening Moose Slack community in your browser".to_string(),
    )))
}

/// Show usage help when no args are provided
pub fn show_help() -> Result<RoutineSuccess, RoutineFailure> {
    println!();
    println!("  Send feedback:         moose feedback \"loving the DX!\"");
    println!("  With email:            moose feedback \"great tool!\" --email you@example.com");
    println!("  Report a bug:          moose feedback --bug \"crash on startup\"");
    println!("  Join the community:    moose feedback --community");
    println!();

    Ok(RoutineSuccess::success(Message::new(
        "Feedback".to_string(),
        "Use the commands above to get in touch".to_string(),
    )))
}
