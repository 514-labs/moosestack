use protobuf::MessageField;
use serde::{Deserialize, Serialize};

use super::{
    table::{Column, Table},
    topic::Topic,
    DataLineage, InfrastructureSignature,
};
use crate::framework::core::infrastructure_map::PrimitiveSignature;
use crate::framework::versions::Version;
use crate::proto::infrastructure_map::{
    TopicToTableSyncProcess as ProtoTopicToTableSyncProcess,
    TopicToTopicSyncProcess as ProtoTopicToTopicSyncProcess,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TopicToTableSyncProcess {
    pub source_topic_id: String,
    pub target_table_id: String,

    pub columns: Vec<Column>,

    pub version: Option<Version>,
    pub source_primitive: PrimitiveSignature,
}

impl TopicToTableSyncProcess {
    pub fn new(topic: &Topic, table: &Table, default_database: &str) -> Self {
        if topic.version != table.version {
            panic!("Version mismatch between topic and table")
        }

        TopicToTableSyncProcess {
            source_topic_id: topic.id(),
            columns: topic.columns.clone(),
            target_table_id: table.id(default_database),
            version: topic.version.clone(),
            source_primitive: topic.source_primitive.clone(),
        }
    }

    pub fn id(&self) -> String {
        format!(
            "{}_{}{}",
            self.source_topic_id,
            self.target_table_id,
            self.version
                .as_ref()
                .map_or("".to_string(), |v| format!("_{}", v.as_suffix()))
        )
    }

    pub fn expanded_display(&self) -> String {
        format!(
            "Topic to Table Sync Process: {} -> {}",
            self.source_topic_id, self.target_table_id
        )
    }

    pub fn short_display(&self) -> String {
        format!(
            "Topic to Table Sync Process: {} -> {}",
            self.source_topic_id, self.target_table_id
        )
    }

    pub fn to_proto(&self) -> ProtoTopicToTableSyncProcess {
        ProtoTopicToTableSyncProcess {
            source_topic_id: self.source_topic_id.clone(),
            target_table_id: self.target_table_id.clone(),
            columns: self.columns.iter().map(|c| c.to_proto()).collect(),
            version: self.version.as_ref().map(|v| v.to_string()),
            source_primitive: MessageField::some(self.source_primitive.to_proto()),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: ProtoTopicToTableSyncProcess) -> Self {
        TopicToTableSyncProcess {
            source_topic_id: proto.source_topic_id,
            target_table_id: proto.target_table_id,
            columns: proto.columns.into_iter().map(Column::from_proto).collect(),
            version: proto.version.map(Version::from_string),
            source_primitive: PrimitiveSignature::from_proto(proto.source_primitive.unwrap()),
        }
    }
}

impl DataLineage for TopicToTableSyncProcess {
    fn pulls_data_from(&self) -> Vec<InfrastructureSignature> {
        vec![InfrastructureSignature::Topic {
            id: self.source_topic_id.clone(),
        }]
    }

    fn pushes_data_to(&self) -> Vec<InfrastructureSignature> {
        vec![InfrastructureSignature::Table {
            id: self.target_table_id.clone(),
        }]
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TopicToTopicSyncProcess {
    pub source_topic_id: String,
    pub target_topic_id: String,

    pub source_primitive: PrimitiveSignature,
}

impl TopicToTopicSyncProcess {
    pub fn id(&self) -> String {
        self.target_topic_id.to_string()
    }

    pub fn expanded_display(&self) -> String {
        format!(
            "Topic to Topic Sync Process: {} -> {}",
            self.source_topic_id, self.target_topic_id
        )
    }

    pub fn short_display(&self) -> String {
        format!(
            "Topic to Topic Sync Process: {} -> {}",
            self.source_topic_id, self.target_topic_id
        )
    }

    pub fn to_proto(&self) -> ProtoTopicToTopicSyncProcess {
        ProtoTopicToTopicSyncProcess {
            source_topic_id: self.source_topic_id.clone(),
            target_topic_id: self.target_topic_id.clone(),
            source_primitive: MessageField::some(self.source_primitive.to_proto()),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: ProtoTopicToTopicSyncProcess) -> Self {
        TopicToTopicSyncProcess {
            source_topic_id: proto.source_topic_id,
            target_topic_id: proto.target_topic_id,
            source_primitive: PrimitiveSignature::from_proto(proto.source_primitive.unwrap()),
        }
    }
}

impl DataLineage for TopicToTopicSyncProcess {
    fn pulls_data_from(&self) -> Vec<super::InfrastructureSignature> {
        vec![InfrastructureSignature::Topic {
            id: self.source_topic_id.clone(),
        }]
    }

    fn pushes_data_to(&self) -> Vec<super::InfrastructureSignature> {
        vec![InfrastructureSignature::Topic {
            id: self.target_topic_id.clone(),
        }]
    }
}
