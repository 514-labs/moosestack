use std::collections::HashMap;
use std::net::TcpListener;
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};

use tracing::{info, instrument, warn};

use crate::cli::logger::{context, resource_type};
use crate::utilities::system::{RestartPolicy, RestartingProcess, StartChildFn};
use crate::{
    framework::{
        core::infrastructure::select_row_policy::SelectRowPolicy, languages::SupportedLanguages,
        python, typescript,
    },
    infrastructure::olap::clickhouse::config::ClickHouseConfig,
    project::{JwtConfig, Project, ProjectFileError},
    utilities::system::KillProcessError,
};

#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum ConsumptionError {
    #[error("Failed to start/stop the analytics api process")]
    IoError(#[from] std::io::Error),

    #[error("Kill process Error")]
    KillProcessError(#[from] KillProcessError),

    #[error("Failed to create library files")]
    ProjectFileError(#[from] ProjectFileError),
}

pub struct ConsumptionProcessRegistry {
    api_process: Option<RestartingProcess>,
    clickhouse_config: ClickHouseConfig,
    language: SupportedLanguages,
    project_path: PathBuf,
    jwt_config: Option<JwtConfig>,
    project: Project,
    proxy_port: Option<u16>,
    row_policies: Vec<SelectRowPolicy>,
}

impl ConsumptionProcessRegistry {
    pub fn new(
        language: SupportedLanguages,
        clickhouse_config: ClickHouseConfig,
        jwt_config: Option<JwtConfig>,
        project_path: PathBuf,
        project: Project,
        proxy_port: Option<u16>,
    ) -> Self {
        let proxy_port = proxy_port.or(Some(project.http_server_config.proxy_port));
        Self {
            api_process: Option::None,
            language,
            clickhouse_config,
            project_path,
            jwt_config,
            project,
            proxy_port,
            row_policies: Vec::new(),
        }
    }

    #[instrument(
        name = "consumption_process_start",
        skip_all,
        fields(
            context = context::RUNTIME,
            resource_type = resource_type::CONSUMPTION_API,
            // No resource_name - generic process
        )
    )]
    pub fn start(&mut self) -> Result<(), ConsumptionError> {
        info!("Starting analytics api...");

        let project = self.project.clone();
        let clickhouse_config = self.clickhouse_config.clone();
        let jwt_config = self.jwt_config.clone();
        let proxy_port = self.proxy_port;

        // Hot-reload race mitigation: when ConsumptionApiWebServer::Updated
        // fires, we call stop() then start() back-to-back. The prior Node
        // primary's workers drain connections asynchronously, so :proxy_port
        // may still be held by the kernel when the new primary tries to
        // fork workers — every new worker's listen() then fails EADDRINUSE
        // and the cluster enters a retry storm.
        //
        // Here we wait until we can successfully bind the port ourselves
        // (releasing it immediately after). That proves the old listener is
        // gone, so the next process's listen() will succeed cleanly.
        if let Some(port) = proxy_port {
            wait_for_port_free("127.0.0.1", port);
        }

        let start_child: StartChildFn<ConsumptionError> = match self.language {
            SupportedLanguages::Python => Box::new(move || {
                python::consumption::run(
                    &project,
                    &clickhouse_config,
                    &jwt_config,
                    proxy_port,
                    project.is_production,
                )
            }),
            SupportedLanguages::Typescript => {
                let project_path = self.project_path.clone();
                let row_policies_config: HashMap<String, String> = self
                    .row_policies
                    .iter()
                    .map(|p| p.to_cli_config())
                    .collect();
                Box::new(move || {
                    typescript::consumption::run(
                        &project,
                        &clickhouse_config,
                        &jwt_config,
                        &project_path,
                        proxy_port,
                        project.is_production,
                        &row_policies_config,
                    )
                })
            }
        };

        self.api_process = Some(RestartingProcess::create(
            "consumption-api".to_string(),
            start_child,
            RestartPolicy::Always,
        )?);

        Ok(())
    }

    pub fn update_row_policies(&mut self, policies: Vec<SelectRowPolicy>) {
        self.row_policies = policies;
    }

    pub async fn stop(&mut self) -> Result<(), ConsumptionError> {
        info!("Stopping analytics apis...");

        if let Some(child) = self.api_process.take() {
            child.stop().await
        };

        Ok(())
    }
}

/// Block (briefly) until `host:port` is bindable, i.e. any prior listener
/// has fully released it. Polls every 100ms up to 5s. Non-fatal: on timeout
/// we log a warning and return so the caller can still attempt the spawn —
/// the Node-side `server.on('error')` handler will catch a lingering
/// EADDRINUSE and the cluster's restart path will recover.
fn wait_for_port_free(host: &str, port: u16) {
    const INTERVAL: Duration = Duration::from_millis(100);
    const TIMEOUT: Duration = Duration::from_secs(5);

    let deadline = Instant::now() + TIMEOUT;
    loop {
        // A successful bind here proves the port is free. The TcpListener
        // is dropped at the end of this scope, releasing the fd. Since we
        // never accept a connection on it, no TIME_WAIT is created, so the
        // Node worker can bind the same port a few ms later.
        match TcpListener::bind((host, port)) {
            Ok(_) => return,
            Err(_) if Instant::now() < deadline => thread::sleep(INTERVAL),
            Err(e) => {
                warn!(
                    "consumption-api: port {port} still held after {TIMEOUT:?} ({e}); \
                     continuing — Node-side error handler will manage the retry"
                );
                return;
            }
        }
    }
}
