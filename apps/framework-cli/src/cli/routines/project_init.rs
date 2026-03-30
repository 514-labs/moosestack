use std::path::{Path, PathBuf};

use crate::cli::display::{Message, MessageType};
use crate::cli::load_project_dev;
use crate::cli::routines::code_generation::{db_to_dmv2, prompt_user_for_remote_ch_http};
use crate::cli::routines::templates::create_project_from_template;
use crate::infrastructure::olap::clickhouse::config::parse_clickhouse_connection_string_with_metadata;
use crate::infrastructure::olap::clickhouse::config_resolver::store_remote_clickhouse_credentials;
use crate::project::{ClickHouseProtocol, RemoteClickHouseConfig};
use crate::utilities::constants::KEY_REMOTE_CLICKHOUSE_URL;
use crate::utilities::keyring::{KeyringSecretRepository, SecretRepository};

use super::RoutineFailure;

/// Source of remote ClickHouse bootstrap settings for a new project.
pub enum RemoteBootstrapSource {
    /// Skip remote ClickHouse bootstrap.
    None,
    /// Prompt for the remote ClickHouse connection string during initialization.
    Prompt,
    /// Use the provided remote ClickHouse connection string directly.
    ConnectionString(String),
}

/// Inputs required to scaffold a Moose project and optionally bootstrap remote ClickHouse.
pub struct ProjectInitOptions<'a> {
    /// Template slug to scaffold, such as `typescript` or `python-empty`.
    pub template: &'a str,
    /// Project name used for template generation and credential storage.
    pub project_name: &'a str,
    /// Destination directory where the project should be created.
    pub dir_path: &'a Path,
    /// Allow reusing an existing directory instead of failing fast.
    pub no_fail_already_exists: bool,
    /// Generate a custom Dockerfile at the project root.
    pub custom_dockerfile: bool,
    /// Remote ClickHouse bootstrap mode to apply after scaffolding.
    pub remote_bootstrap: RemoteBootstrapSource,
}

/// Successful result of project initialization.
pub struct ProjectInitOutcome {
    /// Post-install instructions emitted by the selected template.
    pub post_install_message: String,
}

struct CurrentDirGuard {
    previous_dir: Option<PathBuf>,
}

impl CurrentDirGuard {
    fn capture() -> Self {
        Self {
            previous_dir: std::env::current_dir().ok(),
        }
    }
}

impl Drop for CurrentDirGuard {
    fn drop(&mut self) {
        if let Some(previous_dir) = &self.previous_dir {
            let _ = std::env::set_current_dir(previous_dir);
        }
    }
}

/// Creates a project from a template and optionally bootstraps remote ClickHouse access.
pub async fn initialize_project(
    options: &ProjectInitOptions<'_>,
) -> Result<ProjectInitOutcome, RoutineFailure> {
    let post_install_message = create_project_from_template(
        options.template,
        options.project_name,
        options.dir_path,
        options.no_fail_already_exists,
        options.custom_dockerfile,
    )
    .await?;
    let project_dir = resolve_project_dir(options.dir_path)?;

    match &options.remote_bootstrap {
        RemoteBootstrapSource::None => {}
        RemoteBootstrapSource::Prompt => {
            let _guard = CurrentDirGuard::capture();
            let connection_string = prompt_user_for_remote_ch_http()?;
            db_to_dmv2(&connection_string, &project_dir).await?;
            configure_remote_clickhouse(options.project_name, &project_dir, &connection_string)?;
        }
        RemoteBootstrapSource::ConnectionString(connection_string) => {
            let _guard = CurrentDirGuard::capture();
            db_to_dmv2(connection_string, &project_dir).await?;
            configure_remote_clickhouse(options.project_name, &project_dir, connection_string)?;
        }
    }

    Ok(ProjectInitOutcome {
        post_install_message,
    })
}

fn resolve_project_dir(dir_path: &Path) -> Result<PathBuf, RoutineFailure> {
    std::fs::canonicalize(dir_path).map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Failure".to_string(),
                format!("resolving project directory {}", dir_path.display()),
            ),
            e,
        )
    })
}

fn configure_remote_clickhouse(
    project_name: &str,
    dir_path: &Path,
    connection_string: &str,
) -> Result<(), RoutineFailure> {
    std::env::set_current_dir(dir_path).map_err(|e| {
        RoutineFailure::new(
            Message::new("Failure".to_string(), "changing directory".to_string()),
            e,
        )
    })?;

    let parsed =
        parse_clickhouse_connection_string_with_metadata(connection_string).map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Parse Error".to_string(),
                    "Failed to parse ClickHouse URL".to_string(),
                ),
                e,
            )
        })?;

    let mut project = load_project_dev()?;
    project.dev.remote_clickhouse = Some(RemoteClickHouseConfig {
        protocol: ClickHouseProtocol::Http,
        host: Some(parsed.config.host.clone()),
        port: Some(parsed.config.host_port as u16),
        database: Some(parsed.config.db_name.clone()),
        use_ssl: parsed.config.use_ssl,
    });

    project.write_to_disk().map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Failure".to_string(),
                "writing remote_clickhouse config".to_string(),
            ),
            e,
        )
    })?;

    show_message!(
        MessageType::Success,
        Message::new(
            "Config".to_string(),
            format!(
                "Wrote [dev.remote_clickhouse] to moose.config.toml (host: {}, database: {})",
                parsed.config.host, parsed.config.db_name
            ),
        )
    );

    if let Err(e) = store_remote_clickhouse_credentials(
        project_name,
        &parsed.config.user,
        &parsed.config.password,
    ) {
        show_message!(
            MessageType::Warning,
            Message::new(
                "Keychain".to_string(),
                format!("Failed to store credentials: {e:?}. You'll be prompted again next time."),
            )
        );
    }

    let repo = KeyringSecretRepository;
    if let Err(e) = repo.store(project_name, KEY_REMOTE_CLICKHOUSE_URL, connection_string) {
        show_message!(
            MessageType::Warning,
            Message::new(
                "Keychain".to_string(),
                format!(
                    "Failed to store connection URL: {e:?}. You'll be prompted again next time."
                ),
            )
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::ensure_test_environment;

    #[test]
    #[serial_test::serial(project_init)]
    fn resolve_project_dir_returns_absolute_path_for_relative_input() {
        let temp_dir = tempfile::tempdir().unwrap();
        let project_dir = temp_dir.path().join("project");
        std::fs::create_dir_all(&project_dir).unwrap();

        let _guard = CurrentDirGuard::capture();
        std::env::set_current_dir(temp_dir.path()).unwrap();

        let resolved = resolve_project_dir(Path::new("project")).unwrap();
        assert!(resolved.is_absolute());
        assert_eq!(resolved, project_dir.canonicalize().unwrap());

        std::env::set_current_dir(&resolved).unwrap();
        assert!(std::env::set_current_dir(Path::new("project")).is_err());
        std::env::set_current_dir(&resolved).unwrap();
    }

    #[tokio::test]
    #[serial_test::serial(project_init)]
    async fn initialize_project_none_branch_restores_cwd_on_success() {
        ensure_test_environment();

        let temp_dir = tempfile::tempdir().unwrap();
        let caller_dir = temp_dir.path().join("caller");
        let project_dir = temp_dir.path().join("project");
        std::fs::create_dir_all(&caller_dir).unwrap();

        let _guard = CurrentDirGuard::capture();
        std::env::set_current_dir(&caller_dir).unwrap();

        initialize_project(&ProjectInitOptions {
            template: "typescript",
            project_name: "project",
            dir_path: &project_dir,
            no_fail_already_exists: false,
            custom_dockerfile: false,
            remote_bootstrap: RemoteBootstrapSource::None,
        })
        .await
        .unwrap();

        assert_eq!(
            std::env::current_dir().unwrap().canonicalize().unwrap(),
            caller_dir.canonicalize().unwrap()
        );
        assert!(project_dir.join("package.json").exists());
        assert!(project_dir.join("moose.config.toml").exists());
    }

    #[tokio::test]
    #[serial_test::serial(project_init)]
    async fn initialize_project_connection_string_failure_restores_cwd() {
        ensure_test_environment();

        let temp_dir = tempfile::tempdir().unwrap();
        let caller_dir = temp_dir.path().join("caller");
        let project_dir = temp_dir.path().join("project");
        std::fs::create_dir_all(&caller_dir).unwrap();

        let _guard = CurrentDirGuard::capture();
        std::env::set_current_dir(&caller_dir).unwrap();

        let result = initialize_project(&ProjectInitOptions {
            template: "typescript",
            project_name: "project",
            dir_path: &project_dir,
            no_fail_already_exists: false,
            custom_dockerfile: false,
            remote_bootstrap: RemoteBootstrapSource::ConnectionString(
                "http://user:pass@127.0.0.1:9/default".to_string(),
            ),
        })
        .await;

        assert!(result.is_err());
        assert_eq!(
            std::env::current_dir().unwrap().canonicalize().unwrap(),
            caller_dir.canonicalize().unwrap()
        );
        assert!(project_dir.join("package.json").exists());
        assert!(project_dir.join("moose.config.toml").exists());
    }
}
