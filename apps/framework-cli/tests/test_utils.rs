//! Shared test utilities for the moose-cli crate.
//!
//! This module provides common test setup functions that can be used across
//! different test modules.

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Once;

static SETUP: Once = Once::new();

/// Ensures the test environment is set up. This function is idempotent and
/// thread-safe - it will only run the setup once, even if called from multiple
/// tests running in parallel.
///
/// The setup:
/// 1. Runs `scripts/package-templates.js` to generate template packages
/// 2. Copies necessary files to `target/template-packages/`
///
/// This is needed because `get_template_manifest()` looks for the manifest at
/// `target/template-packages/manifest.toml` when `CLI_VERSION` is "0.0.1".
pub fn ensure_test_environment() {
    SETUP.call_once(|| {
        setup_test_environment().expect("Failed to set up test environment");
    });
}

fn setup_test_environment() -> anyhow::Result<()> {
    let crate_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?);
    let workspace_root = crate_dir.parent().unwrap().parent().unwrap();

    let source_dir = workspace_root.join("template-packages");
    let target_dir = workspace_root.join("target/template-packages");

    // Run the package-templates.js script to generate the templates
    println!("Running scripts/package-templates.js to generate templates...");
    let script_path = workspace_root.join("scripts/package-templates.js");

    let status = Command::new("node")
        .current_dir(workspace_root)
        .arg(script_path)
        .status()?;

    if !status.success() {
        anyhow::bail!("Failed to run scripts/package-templates.js");
    }

    if !source_dir.exists() {
        anyhow::bail!(
            "Source template package directory not found even after running scripts/package-templates.js: {:?}",
            source_dir
        );
    }

    // Ensure the target directory exists
    fs::create_dir_all(&target_dir)?;

    for entry in fs::read_dir(&source_dir)? {
        let entry = entry?;
        let source_file = entry.path();
        let file_name = entry.file_name();
        let should_copy = file_name == "manifest.toml"
            || source_file.extension().and_then(|ext| ext.to_str()) == Some("tgz");

        if should_copy {
            fs::copy(&source_file, target_dir.join(file_name))?;
        }
    }

    Ok(())
}
