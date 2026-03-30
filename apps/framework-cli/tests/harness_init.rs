use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::sync::Once;

use assert_cmd::Command;
use predicates::prelude::*;

fn cli() -> Command {
    Command::new(assert_cmd::cargo::cargo_bin!("moose-cli"))
}

static SETUP: Once = Once::new();

fn ensure_test_environment() {
    SETUP.call_once(|| {
        setup_test_environment().expect("Failed to set up test environment");
    });
}

fn setup_test_environment() -> anyhow::Result<()> {
    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = crate_dir.parent().unwrap().parent().unwrap();
    let source_dir = workspace_root.join("template-packages");
    let target_dir = workspace_root.join("target/template-packages");
    let script_path = workspace_root.join("scripts/package-templates.js");

    let status = StdCommand::new("node")
        .current_dir(workspace_root)
        .arg(script_path)
        .status()?;

    if !status.success() {
        anyhow::bail!("Failed to run scripts/package-templates.js");
    }

    fs::create_dir_all(&target_dir)?;
    for file_name in ["manifest.toml", "default.tgz", "python.tgz"] {
        let source_file = source_dir.join(file_name);
        if source_file.exists() {
            fs::copy(&source_file, target_dir.join(file_name))?;
        }
    }

    Ok(())
}

fn fixture_skills_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("agent-skills")
}

fn setup_codex_home(home: &Path) {
    fs::create_dir_all(home.join(".codex")).expect("should create fake codex home");
}

#[test]
#[serial_test::serial(harness_init)]
fn harness_init_schema_json_output() {
    let output = cli()
        .args(["harness", "init", "schema", "--json"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let parsed: serde_json::Value =
        serde_json::from_slice(&output).expect("schema output should be valid JSON");

    assert_eq!(parsed["version"], 1);
    assert_eq!(parsed["precedence"], "cli_flags_override_json");
    assert_eq!(parsed["template_discovery"], "moose template list --json");
    let agents = parsed["fields"]["agents"]["items"]["enum"]
        .as_array()
        .expect("schema should include agent enum");
    assert!(agents.iter().any(|value| value == "codex"));
    assert!(agents.iter().any(|value| value == "vscode"));
}

#[test]
#[serial_test::serial(harness_init)]
fn harness_init_arg_driven_mode_is_non_interactive() {
    ensure_test_environment();

    let home = tempfile::tempdir().expect("temp home");
    setup_codex_home(home.path());
    let project_dir = home.path().join("arg-app");

    cli()
        .env("HOME", home.path())
        .env("MOOSE_HARNESS_SKILLS_DIR", fixture_skills_dir())
        .current_dir(home.path())
        .args([
            "harness",
            "init",
            "arg-app",
            "typescript",
            "--location",
            project_dir.to_str().expect("project dir"),
            "--agent",
            "codex",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Project name").not())
        .stdout(predicate::str::contains("Coding agents").not());

    assert!(project_dir.join("package.json").exists());
    assert!(project_dir.join("moose.config.toml").exists());
    assert!(home
        .path()
        .join(".agents/skills/clickhouse/best-practices/SKILL.md")
        .exists());
    assert!(home
        .path()
        .join(".codex/skills/clickhouse--best-practices")
        .exists());

    let codex_config = fs::read_to_string(home.path().join(".codex/config.toml"))
        .expect("codex config should exist");
    assert!(codex_config.contains("[mcp_servers.moose-dev]"));
    assert!(codex_config.contains("[mcp_servers.context7]"));
}

#[test]
#[serial_test::serial(harness_init)]
fn harness_init_rejects_bare_from_remote_flag() {
    ensure_test_environment();

    let home = tempfile::tempdir().expect("temp home");
    setup_codex_home(home.path());
    let project_dir = home.path().join("remote-app");

    cli()
        .env("HOME", home.path())
        .env("MOOSE_HARNESS_SKILLS_DIR", fixture_skills_dir())
        .env("MOOSE_TELEMETRY__ENABLED", "false")
        .current_dir(home.path())
        .args([
            "harness",
            "init",
            "remote-app",
            "typescript",
            "--location",
            project_dir.to_str().expect("project dir"),
            "--from-remote",
            "--agent",
            "none",
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains(
            "a value is required for '--from-remote <CONNECTION_STRING>'",
        ));
}

#[test]
#[serial_test::serial(harness_init)]
fn harness_init_supports_project_named_schema_via_name_flag() {
    ensure_test_environment();

    let home = tempfile::tempdir().expect("temp home");
    setup_codex_home(home.path());
    let project_dir = home.path().join("schema");

    cli()
        .env("HOME", home.path())
        .env("MOOSE_HARNESS_SKILLS_DIR", fixture_skills_dir())
        .env("MOOSE_TELEMETRY__ENABLED", "false")
        .current_dir(home.path())
        .args([
            "harness",
            "init",
            "--name",
            "schema",
            "--template",
            "typescript",
            "--location",
            project_dir.to_str().expect("project dir"),
            "--agent",
            "none",
        ])
        .assert()
        .success();

    assert!(project_dir.join("package.json").exists());
    assert!(project_dir.join("moose.config.toml").exists());
}

#[test]
#[serial_test::serial(harness_init)]
fn harness_init_zero_args_runs_interactive_wizard() {
    ensure_test_environment();

    let home = tempfile::tempdir().expect("temp home");
    setup_codex_home(home.path());
    let project_dir = home.path().join("wizard-app");

    cli()
        .env("HOME", home.path())
        .env("MOOSE_HARNESS_SKILLS_DIR", fixture_skills_dir())
        .current_dir(home.path())
        .args(["harness", "init"])
        .write_stdin("wizard-app\ntypescript\n\n\n\n\n")
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Starting interactive harness setup",
        ))
        .stdout(predicate::str::contains("Available templates:"));

    assert!(project_dir.join("package.json").exists());
    assert!(home.path().join(".codex/skills/514--cli").exists());
}
