use std::path::PathBuf;

use tracing::info;

use crate::utilities::system::{RestartingProcess, StartChildFn};
use crate::{
    framework::{languages::SupportedLanguages, python, typescript},
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
    dir: PathBuf,
    language: SupportedLanguages,
    project_path: PathBuf,
    jwt_config: Option<JwtConfig>,
    project: Project,
    proxy_port: Option<u16>,
}

impl ConsumptionProcessRegistry {
    pub fn new(
        language: SupportedLanguages,
        clickhouse_config: ClickHouseConfig,
        jwt_config: Option<JwtConfig>,
        dir: PathBuf,
        project_path: PathBuf,
        project: Project,
        proxy_port: Option<u16>,
    ) -> Self {
        let proxy_port = proxy_port.or(Some(project.http_server_config.proxy_port));
        Self {
            api_process: Option::None,
            language,
            dir,
            clickhouse_config,
            project_path,
            jwt_config,
            project,
            proxy_port,
        }
    }

    pub fn start(&mut self) -> Result<(), ConsumptionError> {
        info!("Starting analytics api...");

        let project = self.project.clone();
        let clickhouse_config = self.clickhouse_config.clone();
        let jwt_config = self.jwt_config.clone();
        let proxy_port = self.proxy_port;
        let dir = self.dir.clone();

        let start_child: StartChildFn<ConsumptionError> = match self.language {
            SupportedLanguages::Python => Box::new(move || {
                python::consumption::run(
                    &project,
                    &clickhouse_config,
                    &jwt_config,
                    &dir,
                    proxy_port,
                )
            }),
            SupportedLanguages::Typescript => {
                let project_path = self.project_path.clone();
                Box::new(move || {
                    typescript::consumption::run(
                        &project,
                        &clickhouse_config,
                        &jwt_config,
                        &dir,
                        &project_path,
                        proxy_port,
                    )
                })
            }
        };

        self.api_process = Some(RestartingProcess::create(
            "consumption-api".to_string(),
            start_child,
        )?);

        Ok(())
    }

    pub async fn stop(&mut self) -> Result<(), ConsumptionError> {
        info!("Stopping analytics apis...");

        if let Some(child) = self.api_process.take() {
            child.stop().await
        };

        Ok(())
    }
}
