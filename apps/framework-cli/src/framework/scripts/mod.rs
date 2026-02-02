use std::path::PathBuf;

use super::languages::SupportedLanguages;

pub mod config;
pub mod executor;
pub mod utils;

use crate::framework::scripts::config::WorkflowConfig;
use crate::infrastructure::orchestration::temporal::TemporalConfig;
use crate::proto::infrastructure_map::Workflow as ProtoWorkflow;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    name: String,
    path: PathBuf,
    config: WorkflowConfig,
    language: SupportedLanguages,
}

impl Workflow {
    pub fn from_user_code(
        name: String,
        language: SupportedLanguages,
        retries: Option<u32>,
        timeout: Option<String>,
        schedule: Option<String>,
    ) -> Result<Self, anyhow::Error> {
        let config = WorkflowConfig::with_overrides(name.clone(), retries, timeout, schedule);

        Ok(Self {
            name: name.clone(),
            path: PathBuf::from(name.clone()),
            config,
            language,
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn config(&self) -> &WorkflowConfig {
        &self.config
    }

    /// Start the workflow execution locally
    pub async fn start(
        &self,
        temporal_config: &TemporalConfig,
        input: Option<String>,
    ) -> Result<executor::WorkflowStartInfo, anyhow::Error> {
        Ok(executor::execute_workflow(
            temporal_config,
            self.language,
            &self.name,
            &self.config,
            input,
        )
        .await?)
    }

    pub fn to_proto(&self) -> ProtoWorkflow {
        ProtoWorkflow {
            name: self.name.clone(),
            schedule: self.config.schedule.clone(),
            retries: self.config.retries,
            timeout: self.config.timeout.clone(),
            language: self.language.to_string(),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: ProtoWorkflow) -> Self {
        let config = WorkflowConfig {
            name: proto.name.clone(),
            schedule: proto.schedule,
            retries: proto.retries,
            timeout: proto.timeout,
            tasks: None,
        };

        Workflow {
            name: proto.name.clone(),
            path: PathBuf::from(proto.name),
            config,
            language: SupportedLanguages::from_proto(proto.language),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_workflow_proto_roundtrip() {
        let workflow = Workflow::from_user_code(
            "test_workflow".to_string(),
            SupportedLanguages::Typescript,
            Some(5),
            Some("60s".to_string()),
            Some("1h".to_string()),
        )
        .unwrap();

        let proto = workflow.to_proto();
        let restored = Workflow::from_proto(proto);

        assert_eq!(workflow.name(), restored.name());
        assert_eq!(workflow.config().schedule, restored.config().schedule);
        assert_eq!(workflow.config().retries, restored.config().retries);
        assert_eq!(workflow.config().timeout, restored.config().timeout);
    }
}
