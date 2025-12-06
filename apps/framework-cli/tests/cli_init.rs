use assert_cmd::Command;
use assert_fs::prelude::*;
use predicates::prelude::*; // Used for writing assertions

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
