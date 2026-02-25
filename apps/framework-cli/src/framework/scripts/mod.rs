use std::path::PathBuf;

use super::languages::SupportedLanguages;
use crate::framework::core::infrastructure::InfrastructureSignature;

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
    /// Infrastructure components this workflow reads data from (lineage).
    #[serde(default)]
    pulls_data_from: Vec<InfrastructureSignature>,
    /// Infrastructure components this workflow writes data to (lineage).
    #[serde(default)]
    pushes_data_to: Vec<InfrastructureSignature>,
}

impl Workflow {
    pub fn from_user_code(
        name: String,
        language: SupportedLanguages,
        retries: Option<u32>,
        timeout: Option<String>,
        schedule: Option<String>,
        pulls_data_from: Vec<InfrastructureSignature>,
        pushes_data_to: Vec<InfrastructureSignature>,
    ) -> Self {
        let config = WorkflowConfig::with_overrides(name.clone(), retries, timeout, schedule);

        Self {
            name: name.clone(),
            path: PathBuf::from(name.clone()),
            config,
            language,
            pulls_data_from,
            pushes_data_to,
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn config(&self) -> &WorkflowConfig {
        &self.config
    }

    /// Returns lineage sources this workflow reads from.
    pub fn pulls_data_from(&self) -> &[InfrastructureSignature] {
        &self.pulls_data_from
    }

    /// Returns lineage targets this workflow writes to.
    pub fn pushes_data_to(&self) -> &[InfrastructureSignature] {
        &self.pushes_data_to
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
            pulls_data_from: self.pulls_data_from.iter().map(|s| s.to_proto()).collect(),
            pushes_data_to: self.pushes_data_to.iter().map(|s| s.to_proto()).collect(),
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
            pulls_data_from: proto
                .pulls_data_from
                .into_iter()
                .map(InfrastructureSignature::from_proto)
                .collect(),
            pushes_data_to: proto
                .pushes_data_to
                .into_iter()
                .map(InfrastructureSignature::from_proto)
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_workflow_proto_roundtrip() {
        let expected_pulls = vec![InfrastructureSignature::Table {
            id: "WorkflowSource".to_string(),
        }];
        let expected_pushes = vec![InfrastructureSignature::Topic {
            id: "WorkflowTarget".to_string(),
        }];

        let workflow = Workflow::from_user_code(
            "test_workflow".to_string(),
            SupportedLanguages::Typescript,
            Some(5),
            Some("60s".to_string()),
            Some("1h".to_string()),
            expected_pulls.clone(),
            expected_pushes.clone(),
        );

        let proto = workflow.to_proto();
        let restored = Workflow::from_proto(proto);

        assert_eq!(workflow.name(), restored.name());
        assert_eq!(workflow.config().schedule, restored.config().schedule);
        assert_eq!(workflow.config().retries, restored.config().retries);
        assert_eq!(workflow.config().timeout, restored.config().timeout);
        assert_eq!(restored.pulls_data_from(), expected_pulls);
        assert_eq!(restored.pushes_data_to(), expected_pushes);
    }
}
