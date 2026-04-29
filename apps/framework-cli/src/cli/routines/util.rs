use crate::utilities::docker::DockerClient;
use std::io::ErrorKind;

/// Guidance when the configured container CLI cannot be executed (commonly: binary missing from PATH).
/// `Command::spawn` reports `ErrorKind::NotFound` without including the program name.
fn container_runtime_not_found_message(configured: &str) -> String {
    format!(
        "Could not find or run the container CLI `{configured}`.\n\
         \n\
         Choose one of the following:\n\
         \n\
         • Install a Docker-compatible CLI (Docker Desktop, Docker Engine, or Finch) and ensure the command is on your `PATH`.\n\
         \n\
         • Point Moose at a specific binary: set `container_cli_path` under `[dev]` in `~/.moose/config.toml`, or set the\n\
         environment variable `MOOSE_DEV__CONTAINER_CLI_PATH` to the full path of your `docker`, `finch`, or `nerdctl` executable.\n\
         \n\
         • Run without Docker for local services: `moose dev --dockerless` (native ClickHouse/Temporal; see the docs for details)."
    )
}

pub fn ensure_docker_running(docker_client: &DockerClient) -> anyhow::Result<()> {
    let errors = docker_client.check_status().map_err(|e| {
        if e.kind() == ErrorKind::NotFound {
            anyhow::anyhow!(container_runtime_not_found_message(
                docker_client.container_cli()
            ))
        } else {
            e.into()
        }
    })?;

    if errors.is_empty() {
        Ok(())
    } else if errors
        .iter()
        .any(|s| s.ends_with("Is the docker daemon running?"))
    {
        anyhow::bail!("Failed to run docker commands. Is docker running?")
    } else {
        anyhow::bail!("Failed to run docker commands. {}", errors.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Uses a real missing executable path so `Command::spawn` returns `ErrorKind::NotFound`
    /// (same shape as a missing `docker`/`finch` on PATH).
    #[test]
    fn ensure_docker_running_missing_cli_includes_path_and_dockerless_hint() {
        let path = std::env::temp_dir().join(format!(
            "moose-missing-container-cli-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let client = DockerClient::new_for_test(path.to_string_lossy().to_string());
        let err = ensure_docker_running(&client).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("Could not find or run the container CLI"),
            "msg: {msg}"
        );
        let path_str = path.to_string_lossy();
        assert!(
            msg.contains(path_str.as_ref()) || msg.contains("moose-missing-container-cli"),
            "msg: {msg}"
        );
        assert!(msg.contains("Choose one of the following"), "msg: {msg}");
        assert!(msg.contains("--dockerless"), "msg: {msg}");
        assert!(msg.contains("container_cli_path"), "msg: {msg}");
    }
}
