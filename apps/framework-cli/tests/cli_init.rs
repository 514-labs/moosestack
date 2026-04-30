use assert_cmd::Command;
use assert_fs::prelude::*;
use predicates::prelude::*; // Used for writing assertions

mod test_utils;

use test_utils::ensure_test_environment;

#[test]
#[serial_test::serial(init)]
fn cannot_run_cli_init_without_args() -> Result<(), Box<dyn std::error::Error>> {
    let mut cmd = Command::new(assert_cmd::cargo::cargo_bin!("moose-cli"));

    cmd.arg("init");
    cmd.assert().failure().stderr(predicate::str::contains(
        "the following required arguments were not provided:",
    ));

    Ok(())
}

#[test]
#[serial_test::serial(init)]
fn can_run_cli_init() -> Result<(), Box<dyn std::error::Error>> {
    ensure_test_environment();

    let temp = assert_fs::TempDir::new().unwrap();
    std::fs::remove_dir(&temp)?;
    let dir: &str = temp.path().to_str().unwrap();

    // List the content of dir
    temp.child("package.json")
        .assert(predicate::path::missing());
    temp.child("app").assert(predicate::path::missing());
    temp.child("moose.config.toml")
        .assert(predicate::path::missing());

    let mut cmd = Command::new(assert_cmd::cargo::cargo_bin!("moose-cli"));

    cmd.arg("init")
        .arg("test-app")
        .arg("typescript")
        .arg("-l")
        .arg(dir);

    cmd.assert().success();

    // TODO add more specific tests when the layout of the
    // app is more stable
    temp.child("package.json").assert(predicate::path::exists());
    temp.child("app").assert(predicate::path::exists());
    temp.child("moose.config.toml")
        .assert(predicate::path::exists());

    Ok(())
}

#[test]
#[serial_test::serial(init)]
fn can_run_cli_init_without_template_by_prompting() -> Result<(), Box<dyn std::error::Error>> {
    ensure_test_environment();

    let temp = assert_fs::TempDir::new().unwrap();
    std::fs::remove_dir(&temp)?;
    let dir: &str = temp.path().to_str().unwrap();

    temp.child("package.json")
        .assert(predicate::path::missing());
    temp.child("app").assert(predicate::path::missing());
    temp.child("moose.config.toml")
        .assert(predicate::path::missing());

    let mut cmd = Command::new(assert_cmd::cargo::cargo_bin!("moose-cli"));

    cmd.arg("init")
        .arg("prompted-app")
        .arg("-l")
        .arg(dir)
        .write_stdin("typescript\n");

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("Select template"));

    temp.child("package.json").assert(predicate::path::exists());
    temp.child("app").assert(predicate::path::exists());
    temp.child("moose.config.toml")
        .assert(predicate::path::exists());

    Ok(())
}

#[test]
#[serial_test::serial(init)]
fn init_help_does_not_list_language_flag() -> Result<(), Box<dyn std::error::Error>> {
    let mut cmd = Command::new(assert_cmd::cargo::cargo_bin!("moose-cli"));

    cmd.arg("init")
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("--language").not())
        .stdout(predicate::str::contains("[TEMPLATE]").not())
        .stdout(predicate::str::contains("Examples (preferred):"))
        .stdout(predicate::str::contains(
            "--name my-app --template typescript",
        ));

    Ok(())
}

#[test]
#[serial_test::serial(init)]
fn can_run_cli_init_with_flag_name_and_template() -> Result<(), Box<dyn std::error::Error>> {
    ensure_test_environment();

    let temp = assert_fs::TempDir::new().unwrap();
    std::fs::remove_dir(&temp)?;
    let dir: &str = temp.path().to_str().unwrap();

    let mut cmd = Command::new(assert_cmd::cargo::cargo_bin!("moose-cli"));

    cmd.arg("init")
        .arg("--name")
        .arg("flag-app")
        .arg("--template")
        .arg("typescript")
        .arg("-l")
        .arg(dir);

    cmd.assert().success();

    temp.child("package.json").assert(predicate::path::exists());
    temp.child("app").assert(predicate::path::exists());
    temp.child("moose.config.toml")
        .assert(predicate::path::exists());

    Ok(())
}

#[test]
#[serial_test::serial(init)]
fn can_run_cli_init_with_equals_style_template_flag() -> Result<(), Box<dyn std::error::Error>> {
    ensure_test_environment();

    let temp = assert_fs::TempDir::new().unwrap();
    std::fs::remove_dir(&temp)?;
    let dir: &str = temp.path().to_str().unwrap();

    let mut cmd = Command::new(assert_cmd::cargo::cargo_bin!("moose-cli"));

    cmd.arg("init")
        .arg("--name")
        .arg("equals-app")
        .arg("--template=typescript")
        .arg("-l")
        .arg(dir);

    cmd.assert().success();

    temp.child("package.json").assert(predicate::path::exists());
    temp.child("app").assert(predicate::path::exists());
    temp.child("moose.config.toml")
        .assert(predicate::path::exists());

    Ok(())
}

#[test]
#[serial_test::serial(init)]
fn init_rejects_positional_and_flag_template_together() -> Result<(), Box<dyn std::error::Error>> {
    let mut cmd = Command::new(assert_cmd::cargo::cargo_bin!("moose-cli"));

    cmd.arg("init")
        .arg("my-app")
        .arg("typescript")
        .arg("--template")
        .arg("python");

    cmd.assert()
        .failure()
        .stderr(predicate::str::contains("cannot be used with"))
        .stderr(predicate::str::contains("--template"));

    Ok(())
}

#[test]
#[serial_test::serial(init)]
fn init_rejects_positional_and_flag_name_together() -> Result<(), Box<dyn std::error::Error>> {
    let mut cmd = Command::new(assert_cmd::cargo::cargo_bin!("moose-cli"));

    cmd.arg("init")
        .arg("my-app")
        .arg("--name")
        .arg("other-name");

    cmd.assert()
        .failure()
        .stderr(predicate::str::contains("cannot be used with"))
        .stderr(predicate::str::contains("--name"));

    Ok(())
}

#[test]
#[serial_test::serial(init)]
fn init_with_unknown_template_flag_prints_template_recovery(
) -> Result<(), Box<dyn std::error::Error>> {
    ensure_test_environment();

    let temp = assert_fs::TempDir::new().unwrap();
    std::fs::remove_dir(&temp)?;
    let dir: &str = temp.path().to_str().unwrap();

    let mut cmd = Command::new(assert_cmd::cargo::cargo_bin!("moose-cli"));

    cmd.arg("init")
        .arg("--name")
        .arg("order-loader")
        .arg("--template=simple")
        .arg("-l")
        .arg(dir);

    cmd.assert().failure().stdout(
        predicate::str::contains("Template 'simple' not found")
            .and(predicate::str::contains("moose template list --json")),
    );

    temp.child("package.json")
        .assert(predicate::path::missing());
    temp.child("app").assert(predicate::path::missing());
    temp.child("moose.config.toml")
        .assert(predicate::path::missing());

    Ok(())
}
