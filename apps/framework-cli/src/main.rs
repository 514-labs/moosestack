#[macro_use]
mod cli;
pub mod framework;
pub mod infrastructure;
pub mod mcp;
pub mod metrics;
pub mod metrics_inserter;
pub mod project;
pub mod utilities;

pub mod proto;

#[cfg(test)]
#[path = "../tests/test_utils.rs"]
pub mod test_utils;

use std::process::ExitCode;

use clap::Parser;
use cli::display::{Message, MessageType};

/// Ensures terminal is properly reset on exit using crossterm
fn ensure_terminal_cleanup() {
    use crossterm::terminal::disable_raw_mode;
    use std::io::{stdout, Write};

    let mut stdout = stdout();

    // Perform the standard ratatui cleanup sequence:
    // 1. Disable raw mode (if it was enabled)
    // 2. Reset any terminal state

    let _ = disable_raw_mode();
    let _ = stdout.flush();

    tracing::info!("Terminal cleanup complete via crossterm");
}

// Entry point for the CLI application
fn main() -> ExitCode {
    // Handle all CLI setup that doesn't require async functionality
    let user_directory = cli::settings::setup_user_directory();
    if let Err(e) = user_directory {
        show_message!(
            MessageType::Error,
            Message {
                action: "Init".to_string(),
                details: format!(
                    "Failed to initialize ~/.moose, please check your permissions: {e:?}"
                ),
            }
        );
        std::process::exit(1);
    }

    cli::settings::init_config_file().expect("Failed to init config file");
    let config = cli::settings::read_settings().expect("Failed to read settings");

    // Parse CLI arguments
    let cli_result = match cli::Cli::try_parse() {
        Ok(cli_result) => cli_result,
        Err(e) => {
            // For missing template argument, provide a helpful message
            if e.kind() == clap::error::ErrorKind::MissingRequiredArgument
                && e.to_string().contains("<TEMPLATE>")
            {
                eprintln!("{e}");
                eprintln!("To view available templates, run:");
                eprintln!("\n  moose template list");
                std::process::exit(1)
            } else {
                // For other errors, use Clap's default error format
                // this includes the --version and --help string
                e.exit()
            }
        }
    };

    if cli_result.backtrace {
        // Safe: no other threads have started and no errors have been created yet.
        std::env::set_var("RUST_LIB_BACKTRACE", "1");
    }

    // Clone logger settings before moving config into async block
    let logger_settings = config.logger.clone();

    // Create a runtime with a single thread to avoid issues with dropping runtimes
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to create Tokio runtime");

    // Run inside runtime context so OTLP batch exporter can initialize properly
    let result = runtime.block_on(async {
        // Setup logging (inside runtime context for OTLP batch exporter)
        cli::logger::setup_logging(&logger_settings);

        // Get machine ID (after logging setup so warnings are visible)
        let machine_id = utilities::machine_id::get_or_create_machine_id();

        // Run the async command handler
        cli::top_command_handler(config, &cli_result.command, machine_id).await
    });

    // Process the result using the original display formatting
    let exit_code = match result {
        Ok(s) => {
            // Skip displaying empty messages (used for --json output where JSON is already printed)
            if !s.message.action.is_empty() || !s.message.details.is_empty() {
                show_message!(s.message_type, s.message);
            }
            ensure_terminal_cleanup();
            ExitCode::from(0)
        }
        Err(e) => {
            show_message!(e.message_type, e.message);
            if let Some(err) = e.error {
                eprintln!("{err:?}");
            }
            ensure_terminal_cleanup();
            ExitCode::from(1)
        }
    };

    // Flush OTLP batches before exit
    opentelemetry::global::shutdown_tracer_provider();

    exit_code
}
