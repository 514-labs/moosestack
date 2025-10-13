//! Local Binary Builder
//!
//! Handles building the moose-cli binary for Linux (x86_64) using Docker.
//! This enables testing unreleased moose changes by embedding a locally-built
//! binary into Docker images instead of downloading from GitHub releases.

use super::RoutineFailure;
use crate::cli::display::Message;
use home::home_dir;
use log::info;
use std::path::{Path, PathBuf};
use std::process::Command;

const DOCKER_RUST_IMAGE: &str = "rust:latest";

/// Expands tilde (~) in paths to the user's home directory.
///
/// This handles cases where the shell doesn't expand the tilde (e.g., in quoted strings).
fn expand_tilde(path: &str) -> Result<PathBuf, RoutineFailure> {
    if path.starts_with("~/") || path == "~" {
        let home = home_dir().ok_or_else(|| {
            RoutineFailure::new(
                Message::new(
                    "Home directory not found".to_string(),
                    "Unable to determine your home directory.\n\
                     Please use an absolute path instead."
                        .to_string(),
                ),
                std::io::Error::other("HOME directory not found"),
            )
        })?;

        if path == "~" {
            Ok(home)
        } else {
            // Strip the "~/" and join with home directory
            Ok(home.join(&path[2..]))
        }
    } else {
        // Not a tilde path, use as-is
        Ok(PathBuf::from(path))
    }
}

/// Validates that the provided path is a moose repository root.
fn validate_moose_repo_root(repo_path: &Path) -> Result<(), RoutineFailure> {
    if !repo_path.exists() {
        return Err(RoutineFailure::new(
            Message::new(
                "Moose repository not found".to_string(),
                format!(
                    "The specified path does not exist: {}\n\
                     Please provide a valid path to the moose repository.",
                    repo_path.display()
                ),
            ),
            std::io::Error::other("Repository path does not exist"),
        ));
    }

    let has_cargo_toml = repo_path.join("Cargo.toml").exists();
    let has_framework_cli = repo_path.join("apps/framework-cli").exists();

    if !has_cargo_toml || !has_framework_cli {
        return Err(RoutineFailure::new(
            Message::new(
                "Invalid moose repository".to_string(),
                format!(
                    "The path {} does not appear to be a moose repository.\n\
                     Expected to find: Cargo.toml and apps/framework-cli/\n\
                     Found: Cargo.toml={}, apps/framework-cli={}",
                    repo_path.display(),
                    has_cargo_toml,
                    has_framework_cli
                ),
            ),
            std::io::Error::other("Invalid moose repository"),
        ));
    }

    Ok(())
}

/// Verifies Docker is installed and accessible.
fn check_docker_available() -> Result<(), RoutineFailure> {
    Command::new("docker")
        .arg("--version")
        .output()
        .map_err(|_| {
            RoutineFailure::new(
                Message::new(
                    "Docker not found".to_string(),
                    "Docker is required for --local flag.\n\
                     Please install Docker Desktop or Podman."
                        .to_string(),
                ),
                std::io::Error::other("Docker not available"),
            )
        })?;

    Ok(())
}

/// Builds the moose-cli binary for Linux using Docker.
///
/// Equivalent shell command:
/// ```bash
/// docker run --rm --platform linux/amd64 \
///   -v /path/to/moose:/moose \
///   -w /moose \
///   rust:latest \
///   sh -c "apt-get update && apt-get install -y protobuf-compiler && cargo build --release"
/// ```
///
/// Output: `target/release/moose-cli` in the moose repository.
fn build_with_docker(repo_root: &Path) -> Result<(), RoutineFailure> {
    info!("Building moose-cli binary using Docker...");
    info!("Installing build dependencies (protobuf-compiler)...");

    let status = Command::new("docker")
        .args([
            "run",
            "--rm",
            "--platform",
            "linux/amd64",
            "-v",
            &format!("{}:/moose", repo_root.display()),
            "-w",
            "/moose",
            DOCKER_RUST_IMAGE,
            "sh",
            "-c",
            "apt-get update -qq && apt-get install -y -qq protobuf-compiler > /dev/null && cargo build --release",
        ])
        .status()
        .map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Failed to start Docker build".to_string(),
                    format!("Error running docker command: {}", e),
                ),
                e,
            )
        })?;

    if !status.success() {
        return Err(RoutineFailure::new(
            Message::new(
                "Docker build failed".to_string(),
                "Failed to compile moose-cli for Linux. Check the error output above.".to_string(),
            ),
            std::io::Error::other("docker build returned non-zero exit code"),
        ));
    }

    info!("Linux binary compiled successfully");
    Ok(())
}

/// Gets the path where the Linux binary should be located after building.
fn get_linux_binary_path(repo_root: &Path) -> PathBuf {
    repo_root.join("target").join("release").join("moose-cli")
}

/// Verifies the binary was created successfully.
fn verify_binary_exists(binary_path: &Path) -> Result<(), RoutineFailure> {
    if !binary_path.exists() {
        return Err(RoutineFailure::new(
            Message::new(
                "Binary not found after build".to_string(),
                format!(
                    "Build succeeded but binary not found at: {}\n\
                     This is unexpected. Please check the build output.",
                    binary_path.display()
                ),
            ),
            std::io::Error::other("Binary not found after successful build"),
        ));
    }

    Ok(())
}

/// Builds the moose-cli binary for Linux and returns its path.
///
/// This is the main entry point for building a local binary. It:
/// 1. Expands tilde (~) in the path
/// 2. Validates the moose repository path
/// 3. Verifies Docker is available
/// 4. Builds the binary using Docker
/// 5. Verifies the binary was created
/// 6. Returns the path to the binary
///
/// # Arguments
///
/// * `repo_path_str` - Path to the moose repository root directory (supports ~ expansion)
///
/// # Errors
///
/// Returns an error if:
/// - The provided path is not a valid moose repository
/// - Docker is not installed or not running
/// - The build fails
/// - The binary cannot be found after building
///
/// # Examples
///
/// Supports both absolute paths and tilde expansion:
/// - `/Users/jonathan/dev/moose`
/// - `~/dev/moose`
pub fn build_linux_binary(repo_path_str: &str) -> Result<PathBuf, RoutineFailure> {
    let repo_path = expand_tilde(repo_path_str)?;

    validate_moose_repo_root(&repo_path)?;
    info!("Using moose repository at: {}", repo_path.display());

    check_docker_available()?;
    build_with_docker(&repo_path)?;

    let binary_path = get_linux_binary_path(&repo_path);
    verify_binary_exists(&binary_path)?;

    Ok(binary_path)
}
