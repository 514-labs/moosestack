use std::path::{Path, PathBuf};

use crate::cli::display::{Message, MessageType};
use crate::cli::load_project_dev;
use crate::cli::routines::code_generation::{db_to_dmv2, prompt_user_for_remote_ch_http};
use crate::cli::routines::templates::create_project_from_template;
use crate::infrastructure::olap::clickhouse::config::parse_clickhouse_connection_string_with_metadata;
use crate::infrastructure::olap::clickhouse::config_resolver::store_remote_clickhouse_credentials;
use crate::project::{ClickHouseProtocol, RemoteClickHouseConfig};
use crate::utilities::constants::{KEY_REMOTE_CLICKHOUSE_URL, PROJECT_CONFIG_FILE};
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
    /// Project name used for template generation.
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
            let bootstrap_project_dir = resolve_bootstrap_project_dir(&project_dir)?;
            let _guard = CurrentDirGuard::capture();
            let connection_string = prompt_user_for_remote_ch_http()?;
            db_to_dmv2(&connection_string, &bootstrap_project_dir).await?;
            configure_remote_clickhouse(&bootstrap_project_dir, &connection_string)?;
        }
        RemoteBootstrapSource::ConnectionString(connection_string) => {
            let bootstrap_project_dir = resolve_bootstrap_project_dir(&project_dir)?;
            let _guard = CurrentDirGuard::capture();
            db_to_dmv2(connection_string, &bootstrap_project_dir).await?;
            configure_remote_clickhouse(&bootstrap_project_dir, connection_string)?;
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

fn resolve_bootstrap_project_dir(project_dir: &Path) -> Result<PathBuf, RoutineFailure> {
    if project_dir.join(PROJECT_CONFIG_FILE).is_file() {
        return Ok(project_dir.to_path_buf());
    }

    let mut candidates = Vec::new();
    collect_nested_project_dirs(project_dir, &mut candidates)?;

    match candidates.as_slice() {
        [project_dir] => Ok(project_dir.to_path_buf()),
        [] => Err(RoutineFailure::error(Message::new(
            "Loading".to_string(),
            format!(
                "No Moose project config found under {}",
                project_dir.display()
            ),
        ))),
        _ => Err(RoutineFailure::error(Message::new(
            "Loading".to_string(),
            format!(
                "Found multiple Moose project configs under {}:\n  - {}\n\nRemote ClickHouse bootstrap requires a single target project and cannot choose one automatically.\nInitialize without `--from-remote`, then run `moose db pull --clickhouse-url <connection-string>` from the intended Moose project directory.",
                project_dir.display(),
                candidates
                    .iter()
                    .map(|candidate| {
                        candidate
                            .strip_prefix(project_dir)
                            .unwrap_or(candidate)
                            .display()
                            .to_string()
                    })
                    .collect::<Vec<_>>()
                    .join("\n  - ")
            ),
        ))),
    }
}

fn collect_nested_project_dirs(
    root_dir: &Path,
    candidates: &mut Vec<PathBuf>,
) -> Result<(), RoutineFailure> {
    for entry in std::fs::read_dir(root_dir).map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Failure".to_string(),
                format!("reading project directory {}", root_dir.display()),
            ),
            e,
        )
    })? {
        let entry = entry.map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Failure".to_string(),
                    format!("reading project directory {}", root_dir.display()),
                ),
                e,
            )
        })?;
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        let Some(dir_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if matches!(
            dir_name,
            ".git" | ".next" | ".turbo" | "dist" | "node_modules" | "target"
        ) {
            continue;
        }

        if path.join(PROJECT_CONFIG_FILE).is_file() {
            candidates.push(path.clone());
        }

        collect_nested_project_dirs(&path, candidates)?;
    }

    Ok(())
}

fn configure_remote_clickhouse(
    dir_path: &Path,
    connection_string: &str,
) -> Result<(), RoutineFailure> {
    let repo = KeyringSecretRepository;
    configure_remote_clickhouse_with(
        dir_path,
        connection_string,
        &repo,
        store_remote_clickhouse_credentials,
    )
}

fn configure_remote_clickhouse_with<R, F>(
    dir_path: &Path,
    connection_string: &str,
    url_store: &R,
    store_credentials: F,
) -> Result<(), RoutineFailure>
where
    R: SecretRepository,
    F: FnOnce(&str, &str, &str) -> Result<(), RoutineFailure>,
{
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
    let stored_project_name = project.name();
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

    if let Err(e) = store_credentials(
        &stored_project_name,
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

    if let Err(e) = url_store.store(
        &stored_project_name,
        KEY_REMOTE_CLICKHOUSE_URL,
        connection_string,
    ) {
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
    use crate::utilities::keyring::SecretError;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MockSecretRepository {
        values: Mutex<HashMap<(String, String), String>>,
    }

    impl SecretRepository for MockSecretRepository {
        fn store(&self, project_name: &str, key: &str, value: &str) -> Result<(), SecretError> {
            self.values.lock().unwrap().insert(
                (project_name.to_string(), key.to_string()),
                value.to_string(),
            );
            Ok(())
        }

        fn get(&self, project_name: &str, key: &str) -> Result<Option<String>, SecretError> {
            Ok(self
                .values
                .lock()
                .unwrap()
                .get(&(project_name.to_string(), key.to_string()))
                .cloned())
        }

        fn delete(&self, project_name: &str, key: &str) -> Result<(), SecretError> {
            self.values
                .lock()
                .unwrap()
                .remove(&(project_name.to_string(), key.to_string()));
            Ok(())
        }
    }

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

    #[test]
    fn resolve_bootstrap_project_dir_prefers_root_config() {
        let temp_dir = tempfile::tempdir().unwrap();
        let project_dir = temp_dir.path().join("project");
        let nested_project_dir = project_dir.join("packages").join("moosestack-service");
        std::fs::create_dir_all(&nested_project_dir).unwrap();
        std::fs::write(project_dir.join(PROJECT_CONFIG_FILE), "").unwrap();
        std::fs::write(nested_project_dir.join(PROJECT_CONFIG_FILE), "").unwrap();

        assert_eq!(
            resolve_bootstrap_project_dir(&project_dir).unwrap(),
            project_dir
        );
    }

    #[test]
    fn resolve_bootstrap_project_dir_supports_single_nested_config() {
        let temp_dir = tempfile::tempdir().unwrap();
        let project_dir = temp_dir.path().join("project");
        let nested_project_dir = project_dir.join("packages").join("moosestack-service");
        std::fs::create_dir_all(&nested_project_dir).unwrap();
        std::fs::write(nested_project_dir.join(PROJECT_CONFIG_FILE), "").unwrap();

        assert_eq!(
            resolve_bootstrap_project_dir(&project_dir).unwrap(),
            nested_project_dir
        );
    }

    #[test]
    fn resolve_bootstrap_project_dir_multiple_nested_configs_returns_actionable_error() {
        let temp_dir = tempfile::tempdir().unwrap();
        let project_dir = temp_dir.path().join("project");
        let service_a = project_dir.join("services").join("alpha");
        let service_b = project_dir.join("services").join("beta");
        std::fs::create_dir_all(&service_a).unwrap();
        std::fs::create_dir_all(&service_b).unwrap();
        std::fs::write(service_a.join(PROJECT_CONFIG_FILE), "").unwrap();
        std::fs::write(service_b.join(PROJECT_CONFIG_FILE), "").unwrap();

        let error = resolve_bootstrap_project_dir(&project_dir).unwrap_err();
        assert!(error
            .message
            .details
            .contains("Found multiple Moose project configs under"));
        assert!(error.message.details.contains("services/alpha"));
        assert!(error.message.details.contains("services/beta"));
        assert!(error
            .message
            .details
            .contains("cannot choose one automatically"));
        assert!(error
            .message
            .details
            .contains("Initialize without `--from-remote`"));
        assert!(error
            .message
            .details
            .contains("moose db pull --clickhouse-url <connection-string>"));
    }

    #[test]
    fn resolve_bootstrap_project_dir_nested_configs_in_same_branch_returns_actionable_error() {
        let temp_dir = tempfile::tempdir().unwrap();
        let project_dir = temp_dir.path().join("project");
        let parent_service = project_dir.join("services");
        let nested_service = parent_service.join("alpha");
        std::fs::create_dir_all(&nested_service).unwrap();
        std::fs::write(parent_service.join(PROJECT_CONFIG_FILE), "").unwrap();
        std::fs::write(nested_service.join(PROJECT_CONFIG_FILE), "").unwrap();

        let error = resolve_bootstrap_project_dir(&project_dir).unwrap_err();
        assert!(error.message.details.contains("services"));
        assert!(error.message.details.contains("services/alpha"));
        assert!(error
            .message
            .details
            .contains("cannot choose one automatically"));
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
    async fn initialize_project_connection_string_uses_nested_moose_project_dir() {
        ensure_test_environment();

        let temp_dir = tempfile::tempdir().unwrap();
        let caller_dir = temp_dir.path().join("caller");
        let project_dir = temp_dir.path().join("project");
        std::fs::create_dir_all(&caller_dir).unwrap();

        let _guard = CurrentDirGuard::capture();
        std::env::set_current_dir(&caller_dir).unwrap();

        let result = initialize_project(&ProjectInitOptions {
            template: "typescript-agent",
            project_name: "project",
            dir_path: &project_dir,
            no_fail_already_exists: false,
            custom_dockerfile: false,
            remote_bootstrap: RemoteBootstrapSource::ConnectionString(
                "http://user:pass@127.0.0.1:9/default".to_string(),
            ),
        })
        .await;

        let failure = match result {
            Ok(_) => panic!("unreachable ClickHouse should fail"),
            Err(failure) => failure,
        };
        assert_ne!(
            failure.message.details,
            "No project found, please run `moose init` to create a project"
        );
        assert_eq!(
            std::env::current_dir().unwrap().canonicalize().unwrap(),
            caller_dir.canonicalize().unwrap()
        );
        assert!(project_dir.join("package.json").exists());
        assert!(project_dir
            .join("packages")
            .join("moosestack-service")
            .join("moose.config.toml")
            .exists());
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

    #[tokio::test]
    #[serial_test::serial(project_init)]
    async fn configure_remote_clickhouse_uses_normalized_current_directory_name_for_storage() {
        ensure_test_environment();

        let temp_dir = tempfile::tempdir().unwrap();
        let caller_dir = temp_dir.path().join("caller");
        let project_dir = temp_dir.path().join("project");
        std::fs::create_dir_all(&caller_dir).unwrap();
        std::fs::create_dir_all(&project_dir).unwrap();

        let _guard = CurrentDirGuard::capture();
        std::env::set_current_dir(&caller_dir).unwrap();

        initialize_project(&ProjectInitOptions {
            template: "typescript",
            project_name: ".",
            dir_path: &project_dir,
            no_fail_already_exists: false,
            custom_dockerfile: false,
            remote_bootstrap: RemoteBootstrapSource::None,
        })
        .await
        .unwrap();

        let stored_credentials = Mutex::new(Vec::new());
        let url_store = MockSecretRepository::default();
        configure_remote_clickhouse_with(
            &project_dir,
            "http://user:pass@127.0.0.1:8123/default",
            &url_store,
            |project_name, user, password| {
                stored_credentials.lock().unwrap().push((
                    project_name.to_string(),
                    user.to_string(),
                    password.to_string(),
                ));
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(stored_credentials.lock().unwrap()[0].0, "project");
        assert_eq!(
            url_store
                .get("project", KEY_REMOTE_CLICKHOUSE_URL)
                .unwrap()
                .as_deref(),
            Some("http://user:pass@127.0.0.1:8123/default")
        );
    }

    #[tokio::test]
    #[serial_test::serial(project_init)]
    async fn configure_remote_clickhouse_uses_loaded_nested_project_name_for_storage() {
        ensure_test_environment();

        let temp_dir = tempfile::tempdir().unwrap();
        let caller_dir = temp_dir.path().join("caller");
        let project_dir = temp_dir.path().join("project");
        std::fs::create_dir_all(&caller_dir).unwrap();

        let _guard = CurrentDirGuard::capture();
        std::env::set_current_dir(&caller_dir).unwrap();

        initialize_project(&ProjectInitOptions {
            template: "typescript-agent",
            project_name: "agent-remote-app",
            dir_path: &project_dir,
            no_fail_already_exists: false,
            custom_dockerfile: false,
            remote_bootstrap: RemoteBootstrapSource::None,
        })
        .await
        .unwrap();

        let bootstrap_project_dir = resolve_bootstrap_project_dir(&project_dir).unwrap();
        let stored_credentials = Mutex::new(Vec::new());
        let url_store = MockSecretRepository::default();

        configure_remote_clickhouse_with(
            &bootstrap_project_dir,
            "http://user:pass@127.0.0.1:8123/default",
            &url_store,
            |project_name, user, password| {
                stored_credentials.lock().unwrap().push((
                    project_name.to_string(),
                    user.to_string(),
                    password.to_string(),
                ));
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(
            stored_credentials.lock().unwrap()[0].0,
            "moosestack-service"
        );
        assert_eq!(
            url_store
                .get("moosestack-service", KEY_REMOTE_CLICKHOUSE_URL)
                .unwrap()
                .as_deref(),
            Some("http://user:pass@127.0.0.1:8123/default")
        );
        assert_eq!(
            url_store
                .get("agent-remote-app", KEY_REMOTE_CLICKHOUSE_URL)
                .unwrap()
                .as_deref(),
            None
        );
    }
}
