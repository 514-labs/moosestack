use std::sync::Arc;
use std::{collections::HashMap, path::PathBuf};
use tokio::process::Child;
use tracing::info;

use crate::project::Project;
use crate::{
    framework::{
        blocks::model::BlocksError, core::infrastructure::olap_process::OlapProcess,
        languages::SupportedLanguages, python, typescript,
    },
    infrastructure::olap::clickhouse::config::ClickHouseConfig,
};

pub struct BlocksProcessRegistry {
    registry: HashMap<String, Child>,
    language: SupportedLanguages,
    dir: PathBuf,
    project_path: PathBuf,
    clickhouse_config: ClickHouseConfig,
    project: Arc<Project>,
}

impl BlocksProcessRegistry {
    pub fn new(
        language: SupportedLanguages,
        dir: PathBuf,
        project_path: PathBuf,
        clickhouse_config: ClickHouseConfig,
        project: &Project,
    ) -> Self {
        Self {
            registry: HashMap::new(),
            language,
            dir,
            project_path,
            clickhouse_config,
            project: Arc::new(project.clone()),
        }
    }

    pub fn start(&mut self, olap_process: &OlapProcess) -> Result<(), BlocksError> {
        if self.dir.exists() {
            info!("Starting blocks {:?}...", olap_process);
            let project = self.project.clone();
            let child = match self.language {
                SupportedLanguages::Typescript => typescript::blocks::run(
                    self.clickhouse_config.clone(),
                    &self.dir,
                    &project,
                    &self.project_path,
                )?,
                SupportedLanguages::Python => python::blocks::run(
                    &project,
                    &self.project_path,
                    self.clickhouse_config.clone(),
                    &self.dir,
                )?,
            };

            self.registry.insert(olap_process.id(), child);
        }

        Ok(())
    }

    pub async fn stop(&mut self, _olap_process: &OlapProcess) -> Result<(), BlocksError> {
        if self.dir.exists() {
            info!("Stopping blocks...");

            for child in self.registry.values_mut() {
                child.kill().await?;
            }

            self.registry.clear();
        }
        Ok(())
    }
}
