use std::fs;
use std::path::{Path, PathBuf};

use assert_cmd::Command;
use predicates::prelude::*;

mod test_utils;

use test_utils::ensure_test_environment;

fn cli() -> Command {
    let mut command = Command::new(assert_cmd::cargo::cargo_bin!("moose-cli"));
    command.env("MOOSE_TELEMETRY__ENABLED", "false");
    command
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
    assert_eq!(parsed["fields"]["install_lsp"]["default"], true);
    let agents = parsed["fields"]["agents"]["items"]["enum"]
        .as_array()
        .expect("schema should include agent enum");
    assert!(agents.iter().any(|value| value == "auto"));
    assert!(agents.iter().any(|value| value == "none"));
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
            "--no-lsp",
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
        .join(".agents/skills/clickhouse/best-practices/references/rule-1.md")
        .exists());
    assert!(home
        .path()
        .join(".codex/skills/clickhouse--best-practices")
        .exists());

    let codex_config = fs::read_to_string(home.path().join(".codex/config.toml"))
        .expect("codex config should exist");
    let parsed: toml::Value = codex_config.parse().expect("codex config should parse");
    assert_eq!(
        parsed["mcp_servers"]["moose-dev"]["command"].as_str(),
        Some("moose")
    );
    assert_eq!(
        parsed["mcp_servers"]["moose-dev"]["args"][0].as_str(),
        Some("mcp")
    );
    assert_eq!(
        parsed["mcp_servers"]["context7"]["url"].as_str(),
        Some("https://mcp.context7.com/mcp")
    );
    assert!(!codex_config.contains("http://localhost:4000/mcp"));
}

#[test]
#[serial_test::serial(harness_init)]
fn harness_init_typescript_agent_keeps_turbo_gitignore_entry() {
    ensure_test_environment();

    let home = tempfile::tempdir().expect("temp home");
    setup_codex_home(home.path());
    let project_dir = home.path().join("agent-app");

    cli()
        .env("HOME", home.path())
        .env("MOOSE_HARNESS_SKILLS_DIR", fixture_skills_dir())
        .current_dir(home.path())
        .args([
            "harness",
            "init",
            "agent-app",
            "typescript-agent",
            "--location",
            project_dir.to_str().expect("project dir"),
            "--agent",
            "none",
            "--no-lsp",
        ])
        .assert()
        .success();

    let gitignore =
        fs::read_to_string(project_dir.join(".gitignore")).expect("gitignore should exist");
    assert!(gitignore.contains(".turbo"));
}

#[test]
#[serial_test::serial(harness_init)]
fn harness_init_typescript_agent_from_remote_uses_nested_moose_project_dir() {
    ensure_test_environment();

    let home = tempfile::tempdir().expect("temp home");
    setup_codex_home(home.path());
    let project_dir = home.path().join("agent-remote-app");

    cli()
        .env("HOME", home.path())
        .env("MOOSE_HARNESS_SKILLS_DIR", fixture_skills_dir())
        .env("MOOSE_TELEMETRY__ENABLED", "false")
        .current_dir(home.path())
        .args([
            "harness",
            "init",
            "agent-remote-app",
            "typescript-agent",
            "--location",
            project_dir.to_str().expect("project dir"),
            "--from-remote",
            "http://user:pass@127.0.0.1:9/default",
            "--agent",
            "none",
            "--no-lsp",
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains("No project found").not())
        .stderr(predicate::str::contains("No project found").not());

    assert!(project_dir
        .join("packages")
        .join("moosestack-service")
        .join("moose.config.toml")
        .exists());
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
            "--no-lsp",
        ])
        .assert()
        .success();

    assert!(project_dir.join("package.json").exists());
    assert!(project_dir.join("moose.config.toml").exists());
}

#[test]
#[serial_test::serial(harness_init)]
fn harness_init_input_file_respects_cli_precedence() {
    ensure_test_environment();

    let home = tempfile::tempdir().expect("temp home");
    setup_codex_home(home.path());
    let input_project_dir = home.path().join("json-app");
    let cli_project_dir = home.path().join("cli-app");
    let input_path = home.path().join("request.json");

    fs::write(
        &input_path,
        serde_json::to_string_pretty(&serde_json::json!({
            "version": 1,
            "name": "json-app",
            "template": "python-empty",
            "location": input_project_dir,
            "agents": ["codex"],
            "install_lsp": true
        }))
        .expect("request should serialize"),
    )
    .expect("request should be written");

    cli()
        .env("HOME", home.path())
        .env("MOOSE_HARNESS_SKILLS_DIR", fixture_skills_dir())
        .env("MOOSE_TELEMETRY__ENABLED", "false")
        .current_dir(home.path())
        .args([
            "harness",
            "init",
            "--input",
            input_path.to_str().expect("input path"),
            "--name",
            "cli-app",
            "--template",
            "typescript",
            "--location",
            cli_project_dir.to_str().expect("cli project dir"),
            "--agent",
            "none",
            "--no-lsp",
        ])
        .assert()
        .success();

    assert!(cli_project_dir.join("package.json").exists());
    assert!(!input_project_dir.exists());
    assert!(!home.path().join(".codex/config.toml").exists());
}

#[test]
#[serial_test::serial(harness_init)]
fn harness_init_accepts_stdin_input() {
    ensure_test_environment();

    let home = tempfile::tempdir().expect("temp home");
    let project_dir = home.path().join("stdin-app");
    let request = serde_json::to_string_pretty(&serde_json::json!({
        "version": 1,
        "name": "stdin-app",
        "template": "typescript",
        "location": project_dir,
        "agents": ["none"],
        "install_lsp": false
    }))
    .expect("request should serialize");

    cli()
        .env("HOME", home.path())
        .env("MOOSE_HARNESS_SKILLS_DIR", fixture_skills_dir())
        .env("MOOSE_TELEMETRY__ENABLED", "false")
        .current_dir(home.path())
        .args(["harness", "init", "--input", "-"])
        .write_stdin(request)
        .assert()
        .success();

    assert!(project_dir.join("package.json").exists());
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
        .write_stdin("wizard-app\nnot-a-template\n\n\n\n\nn\n")
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Starting interactive harness setup",
        ))
        .stdout(predicate::str::contains("Select template"))
        .stdout(predicate::str::contains("Unknown template selection"));

    assert!(project_dir.join("package.json").exists());
    assert!(home.path().join(".codex/skills/514--cli").exists());
}
