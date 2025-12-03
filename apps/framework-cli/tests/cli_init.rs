use assert_cmd::prelude::*; // Add methods on commands
use assert_fs::prelude::*;
use predicates::prelude::*; // Used for writing assertions
use std::process::Command;

#[test]
#[serial_test::serial(init)]
fn cannot_run_cli_init_without_args() -> Result<(), Box<dyn std::error::Error>> {
    let mut cmd = Command::cargo_bin("moose-cli")?;

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

    let mut cmd = Command::cargo_bin("moose-cli")?;

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
fn init_with_positional_template_creates_directory() -> Result<(), Box<dyn std::error::Error>> {
    let temp = assert_fs::TempDir::new().unwrap();
    let temp_path = temp.path();
    let project_dir = temp_path.join("MyProject1");

    // Ensure the directory doesn't exist initially
    if project_dir.exists() {
        std::fs::remove_dir_all(&project_dir)?;
    }

    let mut cmd = Command::cargo_bin("moose-cli")?;

    cmd.arg("init")
        .arg("MyProject1")
        .arg("python")
        .arg("--no-fail-already-exists")
        .current_dir(temp_path);

    cmd.assert().success();

    // Verify the directory was created
    assert!(
        project_dir.exists(),
        "Directory MyProject1 should be created"
    );
    assert!(project_dir.is_dir(), "MyProject1 should be a directory");

    Ok(())
}

#[test]
#[serial_test::serial(init)]
fn init_with_location_flag_uses_name_in_setup_py() -> Result<(), Box<dyn std::error::Error>> {
    let temp = assert_fs::TempDir::new().unwrap();
    let temp_path = temp.path();
    let project_dir = temp_path.join("MyProject1");

    // Ensure the directory doesn't exist initially
    if project_dir.exists() {
        std::fs::remove_dir_all(&project_dir)?;
    }

    let mut cmd = Command::cargo_bin("moose-cli")?;

    cmd.arg("init")
        .arg("-l")
        .arg("MyProject1")
        .arg("--language")
        .arg("python")
        .arg("MyProject23")
        .arg("--no-fail-already-exists")
        .current_dir(temp_path);

    cmd.assert().success();

    // Verify the directory was created with the location name
    assert!(
        project_dir.exists(),
        "Directory MyProject1 should be created"
    );
    assert!(project_dir.is_dir(), "MyProject1 should be a directory");

    // Verify setup.py exists and contains the project name (not the directory name)
    let setup_py_path = project_dir.join("setup.py");
    assert!(
        setup_py_path.exists(),
        "setup.py should exist in MyProject1"
    );

    let setup_py_content = std::fs::read_to_string(&setup_py_path)?;
    assert!(
        setup_py_content.contains("MyProject23"),
        "setup.py should contain the project name 'MyProject23', not the directory name"
    );
    assert!(
        setup_py_content.contains("name='MyProject23'"),
        "setup.py should have name='MyProject23'"
    );

    Ok(())
}
