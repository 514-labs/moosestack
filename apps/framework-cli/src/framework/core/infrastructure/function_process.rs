use crate::framework::{
    core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes},
    languages::SupportedLanguages,
    streaming::model::StreamingFunction,
    versions::Version,
};
use protobuf::MessageField;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf};

use super::table::Metadata;
use super::{topic::Topic, DataLineage, InfrastructureSignature};

use crate::proto::infrastructure_map::FunctionProcess as ProtoFunctionProcess;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FunctionProcess {
    // The name used here is the name of the file that contains the function
    // since we have the current assumption that there is 1 function per file
    // we can use the file name as the name of the function.
    // We don't currently do checks across functions for unicities but we should
    pub name: String,

    pub source_topic_id: String,

    pub target_topic_id: Option<String>,

    // In DMV1 this is the script that contains the function to be executed.
    // In DMV2 this is the path to the main.py or index.ts file that direclty or transitively
    // contains the function to be executed.
    pub executable: PathBuf,

    #[serde(default = "FunctionProcess::default_parallel_process_count")]
    pub parallel_process_count: usize,

    pub version: Option<Version>,

    pub language: SupportedLanguages,

    pub source_primitive: PrimitiveSignature,

    pub metadata: Option<Metadata>,
}

impl FunctionProcess {
    pub fn default_parallel_process_count() -> usize {
        1
    }

    pub fn from_function(function: &StreamingFunction, topics: &HashMap<String, Topic>) -> Self {
        FunctionProcess {
            name: function.name.clone(),

            source_topic_id: get_latest_topic_id(topics, &function.source_data_model.name)
                .unwrap_or_else(|| function.source_data_model.name.clone()),

            target_topic_id: function.target_data_model.as_ref().map(|target_model| {
                get_latest_topic_id(topics, &target_model.name)
                    .unwrap_or_else(|| target_model.name.clone())
            }),

            executable: function.executable.clone(),

            language: SupportedLanguages::from_file_path(&function.executable),

            parallel_process_count: function.source_data_model.config.parallelism,

            version: Some(function.version.clone()),
            source_primitive: PrimitiveSignature {
                name: function.name.clone(),
                primitive_type: PrimitiveTypes::Function,
            },
            metadata: Some(Metadata {
                description: None,
                source: Some(super::table::SourceLocation {
                    file: function.executable.to_string_lossy().to_string(),
                }),
            }),
        }
    }

    pub fn is_ts_function_process(&self) -> bool {
        self.language == SupportedLanguages::Typescript
    }

    pub fn is_py_function_process(&self) -> bool {
        self.language == SupportedLanguages::Python
    }

    pub fn id(&self) -> String {
        let base = match &self.target_topic_id {
            Some(target_topic_id) => {
                format!("{}_{}_{}", self.name, self.source_topic_id, target_topic_id)
            }
            None => format!("{}_{}", self.name, self.source_topic_id),
        };

        match &self.version {
            Some(version) => format!("{base}_{version}"),
            None => base,
        }
    }

    pub fn expanded_display(&self) -> String {
        if let Some(target_topic_id) = &self.target_topic_id {
            format!(
                "Reloading Function: from topic {} to topic {} - Version: {:?} with {} instances",
                self.source_topic_id, target_topic_id, self.version, self.parallel_process_count
            )
        } else {
            format!(
                "Reloading Consumer Functions: from topic {} - Version: {:?} with {} instances",
                self.source_topic_id, self.version, self.parallel_process_count
            )
        }
    }

    pub fn short_display(&self) -> String {
        self.expanded_display()
    }

    pub fn to_proto(&self) -> ProtoFunctionProcess {
        ProtoFunctionProcess {
            name: self.name.clone(),
            source_topic: self.source_topic_id.clone(),
            // Reverse compatibility with old code
            // We can remove this once all the deployments are using this new code
            source_columns: vec![],
            target_topic: self.target_topic_id.clone(),
            // Reverse compatibility with old code
            // We can remove this once all the deployments are using this new code
            target_topic_config: HashMap::new(),
            // Reverse compatibility with old code
            // We can remove this once all the deployments are using this new code
            target_columns: vec![],
            executable: self.executable.to_str().unwrap_or_default().to_string(),
            parallel_process_count: Some(self.parallel_process_count as i32),
            version: self.version.clone().map(|v| v.to_string()),
            source_primitive: MessageField::some(self.source_primitive.to_proto()),
            metadata: MessageField::from_option(self.metadata.as_ref().map(|m| {
                crate::proto::infrastructure_map::Metadata {
                    description: m.description.clone().unwrap_or_default(),
                    source: MessageField::from_option(m.source.as_ref().map(|s| {
                        crate::proto::infrastructure_map::SourceLocation {
                            file: s.file.clone(),
                            special_fields: Default::default(),
                        }
                    })),
                    special_fields: Default::default(),
                }
            })),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: ProtoFunctionProcess) -> Self {
        let executable = PathBuf::from(proto.executable);
        FunctionProcess {
            name: proto.name,
            source_topic_id: proto.source_topic,
            target_topic_id: proto.target_topic,
            executable: executable.clone(),
            language: SupportedLanguages::from_file_path(&executable),
            parallel_process_count: proto.parallel_process_count.unwrap_or(1) as usize,
            version: proto.version.map(Version::from_string),
            source_primitive: PrimitiveSignature::from_proto(proto.source_primitive.unwrap()),
            metadata: proto.metadata.into_option().map(|m| Metadata {
                description: if m.description.is_empty() {
                    None
                } else {
                    Some(m.description)
                },
                source: m
                    .source
                    .into_option()
                    .map(|s| super::table::SourceLocation { file: s.file }),
            }),
        }
    }
}

/**
 * This function retrieves the latest topic for a given data model
 * This should be eventually retired for proper DCM management for functions.
 */
fn get_latest_topic_id(topics: &HashMap<String, Topic>, data_model: &str) -> Option<String> {
    // Ths algorithm is not super efficient. We probably should have a
    // good way to retrieve the topics for a given data model from the state
    topics
        .values()
        .filter(|t| t.source_primitive.name == data_model)
        .max_by_key(|t| &t.version)
        .map(|t| t.id())
}

impl DataLineage for FunctionProcess {
    fn pulls_data_from(&self) -> Vec<InfrastructureSignature> {
        vec![InfrastructureSignature::Topic {
            id: self.source_topic_id.clone(),
        }]
    }

    fn pushes_data_to(&self) -> Vec<InfrastructureSignature> {
        match &self.target_topic_id {
            Some(target_topic_id) => vec![InfrastructureSignature::Topic {
                id: target_topic_id.clone(),
            }],
            None => vec![],
        }
    }
}
