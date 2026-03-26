use std::path::PathBuf;
use std::process::Command;

#[test]
fn benchmark_template_env_preview_is_tracked() {
    let crate_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let workspace_root = crate_dir.parent().unwrap().parent().unwrap();
    let rel_path = "templates/typescript-benchmark/query-benchmarks/.env.preview";

    let output = Command::new("git")
        .current_dir(workspace_root)
        .args(["ls-files", "--error-unmatch", rel_path])
        .output()
        .expect("git ls-files should run");

    assert!(
        output.status.success(),
        "{rel_path} must be tracked so CI can package it.\nstderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
