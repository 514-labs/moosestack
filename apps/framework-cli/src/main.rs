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

    // Setup logging
    cli::logger::setup_logging(&config.logger);

    let machine_id = utilities::machine_id::get_or_create_machine_id();

    // Parse CLI arguments
    let cli_result = match cli::Cli::try_parse() {
        Ok(cli_result) => cli_result,
        Err(e) => {
            // For init command errors, provide helpful guidance
            let error_str = e.to_string();
            if error_str.contains("moose init") || error_str.contains("init") {
                // Check if it's a missing argument error
                if e.kind() == clap::error::ErrorKind::MissingRequiredArgument {
                    eprintln!("{e}");

                    // Check if --location is used but <NAME> is missing
                    // This usually means the user put the name in the wrong position
                    // Use both string matching and check for the specific argument name
                    let missing_name = error_str.contains("<NAME>");
                    let has_location_flag =
                        error_str.contains("--location") || error_str.contains("-l");

                    if missing_name && has_location_flag {
                        eprintln!(
                            "\n💡 Note: The project name must come before flags that take values."
                        );
                        eprintln!("   If using --location (-l), put the project name first:");
                        eprintln!("   moose init <NAME> python -l <directory>");
                        eprintln!("\n   Or use the full flag name to avoid confusion:");
                        eprintln!("   moose init <NAME> python --location <directory>");
                    }

                    eprintln!("\n💡 Quick start examples:");
                    eprintln!("  moose init MyProject python          # Initialize with Python");
                    eprintln!(
                        "  moose init MyProject typescript       # Initialize with TypeScript"
                    );
                    eprintln!("  moose init MyProject python -l ./my-dir  # With custom location");
                    eprintln!("\nTo view all available templates, run:");
                    eprintln!("  moose template list");
                    std::process::exit(1)
                } else {
                    // For other init errors, show the error and suggest help
                    eprintln!("{e}");
                    eprintln!("\nFor more information, run: moose init --help");
                    std::process::exit(1)
                }
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

    // Create a runtime with a single thread to avoid issues with dropping runtimes
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to create Tokio runtime");

    // Run the async function to handle the command
    let result = runtime.block_on(cli::top_command_handler(
        config,
        &cli_result.command,
        machine_id,
    ));

    // Process the result using the original display formatting
    match result {
        Ok(s) => {
            show_message!(s.message_type, s.message);
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
    }
}
