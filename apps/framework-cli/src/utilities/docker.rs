use handlebars::Handlebars;
use lazy_static::lazy_static;
use log::{error, info, warn};
use regex::Regex;
use serde::Deserialize;
use serde_json::from_str;
use serde_json::json;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::cli::settings::Settings;
use crate::project::Project;
use crate::utilities::constants::REDPANDA_CONTAINER_NAME;

static COMPOSE_FILE: &str = include_str!("docker-compose.yml.hbs");
static PROD_COMPOSE_FILE: &str = include_str!("prod-docker-compose.yml.hbs");

type ContainerName = String;
type ContainerId = String;

#[derive(Debug, thiserror::Error)]
#[error("Failed to create or delete project files")]
#[non_exhaustive]
pub enum DockerError {
    ProjectFile(#[from] crate::project::ProjectFileError),
    IO(#[from] std::io::Error),
}

#[derive(Debug, Deserialize)]
struct DockerInfo {
    #[serde(default)]
    server_errors: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct DockerComposeContainerInfo {
    pub name: String,
    #[serde(default)]
    pub health: Option<String>,
}

/// Client for interacting with container runtime (docker/finch)
pub struct DockerClient {
    /// The container runtime CLI command to use
    cli_command: String,
}

impl DockerClient {
    /// Creates a new DockerClient instance from settings
    pub fn new(settings: &Settings) -> Self {
        let cli_command = settings
            .dev
            .container_cli_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "docker".to_string());

        Self { cli_command }
    }

    /// Creates a new Command using the configured container CLI
    fn create_command(&self) -> Command {
        Command::new(&self.cli_command)
    }

    /// Creates a compose command for the given project
    fn compose_command(&self, project: &Project) -> Command {
        let mut command = self.create_command();
        command
            .arg("compose")
            .arg("-f")
            .arg(project.internal_dir().unwrap().join("docker-compose.yml"));

        // Add override file if it exists in project root
        let override_file = project.project_location.join("docker-compose.dev.override.yaml");
        if override_file.exists() {
            info!(
                "Found docker-compose.dev.override.yaml, applying custom infrastructure configuration"
            );
            command.arg("-f").arg(override_file);
        }

        command
            .arg("-p")
            .arg(project.name().to_lowercase());
        command
    }

    /// Lists all containers for the project
    pub fn list_containers(
        &self,
        project: &Project,
    ) -> std::io::Result<Vec<DockerComposeContainerInfo>> {
        let child = self
            .compose_command(project)
            .arg("ps")
            .arg("-a")
            .arg("--format")
            .arg("json")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let output = child.wait_with_output()?;

        if !output.status.success() {
            warn!("Could not list containers");
            warn!("Error: {}", String::from_utf8_lossy(&output.stderr));
            warn!("Output: {}", String::from_utf8_lossy(&output.stdout));
            return Err(std::io::Error::other("Failed to list Docker containers"));
        }

        let output_str = String::from_utf8_lossy(&output.stdout);
        let output_lines: Vec<&str> = output_str.trim().split('\n').collect();

        // Handle both single array and multiple object formats
        // Docker and Finch have different formats for the output
        if output_str.trim().starts_with('[') {
            // Finch format - array with Name property
            let containers: Vec<serde_json::Value> =
                serde_json::from_str(&output_str).map_err(std::io::Error::other)?;

            Ok(containers
                .into_iter()
                .filter_map(|c| {
                    c.get("Name").and_then(|n| {
                        n.as_str().map(|name| DockerComposeContainerInfo {
                            name: name.to_string(),
                            health: c.get("Health").and_then(|h| h.as_str()).and_then(|h| {
                                if h.is_empty() {
                                    None
                                } else {
                                    Some(h.to_string())
                                }
                            }),
                        })
                    })
                })
                .collect())
        } else {
            // Docker format - newline delimited with Names property
            let mut container_infos = Vec::new();
            for line in output_lines {
                if let Ok(container) = serde_json::from_str::<serde_json::Value>(line) {
                    if let Some(name) = container.get("Names").and_then(|n| n.as_str()) {
                        let health =
                            container
                                .get("Health")
                                .and_then(|h| h.as_str())
                                .and_then(|h| {
                                    if h.is_empty() {
                                        None
                                    } else {
                                        Some(h.to_string())
                                    }
                                });

                        container_infos.push(DockerComposeContainerInfo {
                            name: name.to_string(),
                            health,
                        });
                    }
                }
            }
            Ok(container_infos)
        }
    }

    /// Lists names of all containers
    pub fn list_container_names(&self) -> std::io::Result<Vec<ContainerName>> {
        let child = self
            .create_command()
            .arg("ps")
            .arg("--format")
            .arg("json")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let output = child.wait_with_output()?;

        if !output.status.success() {
            warn!("Could not list containers");
            warn!("Error: {}", String::from_utf8_lossy(&output.stderr));
            warn!("Output: {}", String::from_utf8_lossy(&output.stdout));
            return Err(std::io::Error::other(
                "Failed to list Docker container names",
            ));
        }

        let output_str = String::from_utf8_lossy(&output.stdout);
        let output_lines: Vec<&str> = output_str.trim().split('\n').collect();
        let mut container_names = Vec::new();

        for line in output_lines {
            if let Ok(container) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(names) = container.get("Names") {
                    if let Some(name) = names.as_str() {
                        container_names.push(name.to_string());
                    }
                }
            }
        }

        Ok(container_names)
    }

    /// Stops all containers for the project
    pub fn stop_containers(&self, project: &Project) -> anyhow::Result<()> {
        let child = self
            .compose_command(project)
            .arg("down")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let output = child.wait_with_output()?;

        if !output.status.success() {
            let error_message = String::from_utf8_lossy(&output.stderr);
            let friendly_error_message = format!("Failed to stop containers: {error_message}");
            error!("{}", friendly_error_message);
            Err(anyhow::anyhow!(friendly_error_message))
        } else {
            Ok(())
        }
    }

    /// Starts all containers for the project
    pub fn start_containers(&self, project: &Project) -> anyhow::Result<()> {
        let temporal_env_vars = project.temporal_config.to_env_vars();

        let mut child = self.compose_command(project);

        // Add all temporal environment variables
        for (key, value) in temporal_env_vars {
            child.env(key, value);
        }

        child
            .arg("up")
            .arg("-d")
            .env("DB_NAME", project.clickhouse_config.db_name.clone())
            .env("CLICKHOUSE_USER", project.clickhouse_config.user.clone())
            .env(
                "CLICKHOUSE_PASSWORD",
                project.clickhouse_config.password.clone(),
            )
            .env(
                "CLICKHOUSE_HOST_PORT",
                project.clickhouse_config.host_port.to_string(),
            )
            .env("REDIS_PORT", project.redis_config.port.to_string());

        let child = child
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let output = child.wait_with_output()?;

        if !output.status.success() {
            let error_message = String::from_utf8_lossy(&output.stderr);
            let friendly_error_message = format!("Failed to start containers. Make sure you have Docker version 2.23.1+ and try again: {error_message}");
            error!("{}", friendly_error_message);

            let mapped_error_message =
                if let Some(stuff) = PORT_ALLOCATED_REGEX.captures(&error_message) {
                    format!(
                    "Port {} already in use. Terminate the process using that port and try again.",
                    stuff.get(1).unwrap().as_str()
                )
                } else {
                    friendly_error_message.to_string()
                };

            Err(anyhow::anyhow!(mapped_error_message))
        } else {
            Ok(())
        }
    }

    /// Gets the ID of a container by name
    fn get_container_id(&self, container_name: &str) -> anyhow::Result<ContainerId> {
        let child = self
            .create_command()
            .arg("ps")
            .arg("-af")
            .arg(format!("name={container_name}"))
            .arg("--format")
            .arg("json")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let output = child.wait_with_output()?;

        if !output.status.success() {
            error!(
                "Failed to get container id: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            return Err(anyhow::anyhow!(format!(
                "Failed to get container id for {}",
                container_name
            )));
        }

        let output_str = String::from_utf8_lossy(&output.stdout);
        let output_lines: Vec<&str> = output_str.trim().split('\n').collect();

        for line in output_lines {
            if let Ok(container) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(id) = container.get("ID").and_then(|id| id.as_str()) {
                    return Ok(id.to_string());
                }
            }
        }

        Err(anyhow::anyhow!(
            "No container found with name {}",
            container_name
        ))
    }

    /// Tails logs for a specific container
    pub fn tail_container_logs(
        &self,
        project: &Project,
        container_name: &str,
    ) -> anyhow::Result<()> {
        let full_container_name = format!("{}-{}-1", project.name().to_lowercase(), container_name);
        let container_id = self.get_container_id(&full_container_name)?;

        let mut child = tokio::process::Command::new(&self.cli_command)
            .arg("logs")
            .arg("--follow")
            .arg(container_id)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let stdout = child.stdout.take().ok_or(anyhow::anyhow!(
            "Failed to get stdout for {}",
            full_container_name
        ))?;

        let stderr = child.stderr.take().ok_or(anyhow::anyhow!(
            "Failed to get stderr for {}",
            full_container_name
        ))?;

        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        let log_identifier_stdout = full_container_name.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = stdout_reader.next_line().await {
                info!("<{}> {}", log_identifier_stdout, line);
            }
        });

        let log_identifier_stderr = full_container_name;
        tokio::spawn(async move {
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                error!("<{}> {}", log_identifier_stderr, line);
            }
        });

        Ok(())
    }

    /// Creates the docker-compose file for the project
    pub fn create_compose_file(
        &self,
        project: &Project,
        settings: &Settings,
    ) -> Result<(), DockerError> {
        let compose_file = project.internal_dir()?.join("docker-compose.yml");

        let mut handlebars = Handlebars::new();
        handlebars.register_escape_fn(handlebars::no_escape);

        let mut data = json!({
            "scripts_feature": settings.features.scripts || project.features.workflows,
            "streaming_engine": project.features.streaming_engine,
            "storage": project.features.olap
        });

        // Thread Redpanda broker host/port from config into the compose template
        if project.features.streaming_engine {
            let broker = &project.redpanda_config.broker;
            let mut host = "localhost".to_string();
            let mut port: u16 = 19092;

            if let Some((h, p)) = broker.rsplit_once(':') {
                host = h.to_string();
                if let Ok(parsed) = p.parse::<u16>() {
                    port = parsed;
                } else {
                    warn!(
                        "Failed to parse redpanda broker port from '{}', defaulting to {}",
                        broker, port
                    );
                }
            } else {
                warn!(
                    "Invalid redpanda broker format '{}', expected host:port. Using defaults {}:{}",
                    broker, host, port
                );
            }

            if let Some(obj) = data.as_object_mut() {
                obj.insert("redpanda_broker_host".to_string(), json!(host));
                obj.insert("redpanda_broker_port".to_string(), json!(port));
            }
        }

        // Add the clickhouse host data path if it's set
        if let Some(path) = &project.clickhouse_config.host_data_path {
            if let Some(path_str) = path.to_str() {
                if let Some(obj) = data.as_object_mut() {
                    obj.insert("clickhouse_host_data_path".to_string(), json!(path_str));
                }
            }
        }

        if project.is_production {
            let rendered = handlebars
                .render_template(PROD_COMPOSE_FILE, &data)
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            Ok(std::fs::write(compose_file, rendered)?)
        } else {
            let rendered = handlebars
                .render_template(COMPOSE_FILE, &data)
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            Ok(std::fs::write(compose_file, rendered)?)
        }
    }

    /// Runs rpk cluster info command
    pub fn run_rpk_cluster_info(&self, project_name: &str, attempts: usize) -> anyhow::Result<()> {
        let child = self
            .create_command()
            .arg("exec")
            .arg(format!(
                "{}-{}-1",
                project_name.to_lowercase(),
                REDPANDA_CONTAINER_NAME
            ))
            .arg("rpk")
            .arg("cluster")
            .arg("info")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let output = child.wait_with_output()?;

        if !output.status.success() {
            if attempts > 0 {
                std::thread::sleep(std::time::Duration::from_secs(1));
                self.run_rpk_cluster_info(project_name, attempts - 1)
            } else {
                error!(
                    "Failed to run redpanda cluster info: {}",
                    String::from_utf8_lossy(&output.stderr)
                );
                Err(anyhow::anyhow!("Failed to run redpanda cluster info"))
            }
        } else {
            Ok(())
        }
    }

    /// Runs an rpk command
    pub fn run_rpk_command(
        &self,
        project_name: &str,
        args: Vec<String>,
    ) -> std::io::Result<String> {
        let child = self
            .create_command()
            .arg("exec")
            .arg(format!(
                "{}-{}-1",
                project_name.to_lowercase(),
                REDPANDA_CONTAINER_NAME
            ))
            .arg("rpk")
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let output = child.wait_with_output()?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else if output.stderr.is_empty() {
            if output.stdout.is_empty() {
                return Err(std::io::Error::other("No output from command"));
            }

            if String::from_utf8_lossy(&output.stdout).contains("TOPIC_ALREADY_EXISTS") {
                return Ok(String::from_utf8_lossy(&output.stdout).to_string());
            }

            Err(std::io::Error::other(String::from_utf8_lossy(
                &output.stdout,
            )))
        } else {
            Err(std::io::Error::other(format!(
                "stdout: {}, stderr: {}",
                String::from_utf8_lossy(&output.stdout),
                &String::from_utf8_lossy(&output.stderr)
            )))
        }
    }

    /// Checks the container runtime status
    pub fn check_status(&self) -> std::io::Result<Vec<String>> {
        let child = self
            .create_command()
            .arg("info")
            .arg("--format")
            .arg("json")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let output = child.wait_with_output()?;

        if !output.status.success() {
            error!(
                "Failed to get Docker info: stdout: {}, stderr: {}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return Err(std::io::Error::other(String::from_utf8_lossy(
                &output.stderr,
            )));
        }

        let info: DockerInfo =
            serde_json::from_slice(&output.stdout).map_err(std::io::Error::other)?;

        Ok(info.server_errors)
    }

    /// Runs buildx command
    pub fn buildx(
        &self,
        directory: &PathBuf,
        version: &str,
        architecture: &str,
        binarylabel: &str,
    ) -> std::io::Result<Vec<String>> {
        let child = self
            .create_command()
            .current_dir(directory)
            .arg("buildx")
            .arg("build")
            .arg("--build-arg")
            .arg(format!(
                "DOWNLOAD_URL=https://github.com/514-labs/moose/releases/download/v{version}/moose-cli-{binarylabel}"
            ))
            .arg("--platform")
            .arg(architecture)
            .arg("--load")
            .arg("--no-cache")
            .arg("-t")
            .arg(format!("moose-df-deployment-{binarylabel}:latest"))
            .arg(".")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let output = child.wait_with_output()?;

        if !output.status.success() {
            return Err(std::io::Error::other(String::from_utf8_lossy(
                &output.stderr,
            )));
        }

        let output_str = String::from_utf8_lossy(&output.stdout);
        let containers: Vec<String> = output_str
            .split('\n')
            .filter(|line| !line.is_empty())
            .map(|line| from_str(line).expect("Failed to parse container row"))
            .collect();
        Ok(containers)
    }
}

lazy_static! {
    pub static ref PORT_ALLOCATED_REGEX: Regex =
        Regex::new("Bind for \\d+.\\d+.\\d+.\\d+:(\\d+) failed: port is already allocated")
            .unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::languages::SupportedLanguages;
    use tempfile::TempDir;

    fn create_test_docker_client() -> DockerClient {
        // Create a test DockerClient with default docker CLI
        DockerClient {
            cli_command: "docker".to_string(),
        }
    }

    #[test]
    fn test_compose_command_without_override_file() {
        let temp_dir = TempDir::new().unwrap();
        let project = Project::new(
            temp_dir.path(),
            "test-project".to_string(),
            SupportedLanguages::Typescript,
        );

        // Create internal directory
        std::fs::create_dir_all(project.internal_dir().unwrap()).unwrap();

        let docker_client = create_test_docker_client();

        let command = docker_client.compose_command(&project);
        let args: Vec<&std::ffi::OsStr> = command.get_args().collect();

        // Should have compose, -f, path, -p, project-name
        assert_eq!(args.len(), 5);
        assert_eq!(args[0], "compose");
        assert_eq!(args[1], "-f");
        assert_eq!(args[3], "-p");
        assert_eq!(args[4], "test-project");
    }

    #[test]
    fn test_compose_command_with_override_file() {
        let temp_dir = TempDir::new().unwrap();
        let project = Project::new(
            temp_dir.path(),
            "test-project".to_string(),
            SupportedLanguages::Typescript,
        );

        // Create internal directory
        std::fs::create_dir_all(project.internal_dir().unwrap()).unwrap();

        // Create override file in project root
        let override_file = project.project_location.join("docker-compose.dev.override.yaml");
        std::fs::write(&override_file, "services:\n  custom:\n    image: nginx\n").unwrap();

        let docker_client = create_test_docker_client();

        let command = docker_client.compose_command(&project);
        let args: Vec<&std::ffi::OsStr> = command.get_args().collect();

        // Should have compose, -f, path1, -f, path2, -p, project-name
        assert_eq!(args.len(), 7);
        assert_eq!(args[0], "compose");
        assert_eq!(args[1], "-f");
        assert_eq!(args[3], "-f");
        assert_eq!(args[4], override_file.as_os_str());
        assert_eq!(args[5], "-p");
        assert_eq!(args[6], "test-project");
    }
}
