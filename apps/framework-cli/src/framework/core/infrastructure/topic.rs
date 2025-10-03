use super::table::{Column, Metadata};
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::framework::versions::Version;
use crate::framework::{
    core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes},
    data_model::model::DataModel,
};
use crate::proto;
use crate::proto::infrastructure_map::LifeCycle as ProtoLifeCycle;
use crate::proto::infrastructure_map::SchemaRegistry as ProtoSchemaRegistry;
use crate::proto::infrastructure_map::SubjectVersion as ProtoSubjectVersion;
use protobuf::MessageField;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::proto::infrastructure_map::Topic as ProtoTopic;

pub const DEFAULT_MAX_MESSAGE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Topic {
    pub version: Option<Version>,
    pub name: String,
    pub retention_period: Duration,

    #[serde(default = "Topic::default_partition_count")]
    pub partition_count: usize,

    pub max_message_bytes: usize,

    pub columns: Vec<Column>,

    pub source_primitive: PrimitiveSignature,

    pub metadata: Option<Metadata>,

    #[serde(default = "LifeCycle::default_for_deserialization")]
    pub life_cycle: LifeCycle,

    /// Optional minimal Schema Registry configuration.
    #[serde(default)]
    pub schema_registry: Option<KafkaSchema>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KafkaSchema {
    /// Encoding/wire format (e.g. "JSON", "AVRO", "PROTOBUF")
    pub kind: String,
    /// Reference sum type
    pub reference: SchemaResgistryReference,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum SchemaResgistryReference {
    Id(u8),
    Latest { subject_name: String },
    SubjectVersion { name: String, version: u8 },
}

impl Topic {
    pub fn from_data_model(data_model: &DataModel) -> Self {
        Topic {
            name: data_model.name.clone(),
            version: Some(data_model.version.clone()),
            // TODO configure this from DataModelConfig
            retention_period: Topic::default_duration(),
            partition_count: data_model.config.parallelism,
            columns: data_model.columns.clone(),
            max_message_bytes: DEFAULT_MAX_MESSAGE_BYTES,
            source_primitive: PrimitiveSignature {
                name: data_model.name.clone(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            schema_registry: None,
        }
    }

    pub fn id(&self) -> String {
        match self.source_primitive.primitive_type {
            // migration functions has versions in the name already
            PrimitiveTypes::Function => self.name.clone(),
            PrimitiveTypes::DataModel
            // the following two possibilities are impossible
            | PrimitiveTypes::DBBlock
            | PrimitiveTypes::ConsumptionAPI => {
                // TODO have a proper version object that standardizes transformations
                self.version.as_ref().map_or(self.name.clone(), |v| format!("{}_{}", self.name, v.as_suffix()))
            }
        }
    }

    pub fn expanded_display(&self) -> String {
        format!(
            "Topic: {} - Version: {:?} - Retention Period: {}s - Partition Count: {}",
            self.name,
            self.version,
            self.retention_period.as_secs(),
            self.partition_count
        )
    }

    pub fn short_display(&self) -> String {
        format!(
            "Topic: {name} - Version: {version:?}",
            name = self.name,
            version = self.version
        )
    }

    fn default_duration() -> Duration {
        Duration::from_secs(60 * 60 * 24 * 7)
    }

    pub fn to_proto(&self) -> ProtoTopic {
        ProtoTopic {
            version: self.version.as_ref().map(|v| v.to_string()),
            name: self.name.clone(),
            retention_period: MessageField::some(
                protobuf::well_known_types::duration::Duration::from(self.retention_period),
            ),
            partition_count: Some(self.partition_count as i32),
            columns: self.columns.iter().map(|c| c.to_proto()).collect(),
            source_primitive: MessageField::some(self.source_primitive.to_proto()),
            max_message_bytes: Some(self.max_message_bytes as i32),
            metadata: MessageField::from_option(self.metadata.as_ref().map(|m| {
                proto::infrastructure_map::Metadata {
                    description: m.description.clone().unwrap_or_default(),
                    special_fields: Default::default(),
                }
            })),
            life_cycle: match self.life_cycle {
                LifeCycle::FullyManaged => ProtoLifeCycle::FULLY_MANAGED.into(),
                LifeCycle::DeletionProtected => ProtoLifeCycle::DELETION_PROTECTED.into(),
                LifeCycle::ExternallyManaged => ProtoLifeCycle::EXTERNALLY_MANAGED.into(),
            },
            schema_registry: self
                .schema_registry
                .as_ref()
                .map(kafka_schema_to_proto)
                .into(),
            special_fields: Default::default(),
        }
    }

    pub fn default_partition_count() -> usize {
        1
    }

    pub fn from_proto(proto: ProtoTopic) -> Self {
        Topic {
            version: proto.version.map(Version::from_string),
            name: proto.name,
            retention_period: proto.retention_period.unwrap().into(),
            partition_count: proto.partition_count.unwrap_or(1) as usize,
            columns: proto.columns.into_iter().map(Column::from_proto).collect(),
            max_message_bytes: proto
                .max_message_bytes
                .unwrap_or(DEFAULT_MAX_MESSAGE_BYTES.try_into().unwrap())
                as usize,
            source_primitive: PrimitiveSignature::from_proto(proto.source_primitive.unwrap()),
            metadata: proto.metadata.into_option().map(|m| Metadata {
                description: if m.description.is_empty() {
                    None
                } else {
                    Some(m.description)
                },
            }),
            life_cycle: match proto.life_cycle.enum_value_or_default() {
                ProtoLifeCycle::FULLY_MANAGED => LifeCycle::FullyManaged,
                ProtoLifeCycle::DELETION_PROTECTED => LifeCycle::DeletionProtected,
                ProtoLifeCycle::EXTERNALLY_MANAGED => LifeCycle::ExternallyManaged,
            },
            schema_registry: proto
                .schema_registry
                .into_option()
                .and_then(proto_to_kafka_schema),
        }
    }
}

fn kafka_schema_to_proto(s: &KafkaSchema) -> ProtoSchemaRegistry {
    let mut sr = ProtoSchemaRegistry::new();
    sr.encoding = match s.kind.as_str() {
        "JSON" => crate::proto::infrastructure_map::schema_registry::Encoding::JSON.into(),
        "AVRO" => crate::proto::infrastructure_map::schema_registry::Encoding::AVRO.into(),
        "PROTOBUF" => crate::proto::infrastructure_map::schema_registry::Encoding::PROTOBUF.into(),
        _ => crate::proto::infrastructure_map::schema_registry::Encoding::JSON.into(),
    };
    use crate::proto::infrastructure_map::schema_registry::SchemaRef as ProtoSchemaRef;
    sr.schema_ref = Some(match &s.reference {
        SchemaResgistryReference::Id(id) => ProtoSchemaRef::SchemaId(*id as u32),
        SchemaResgistryReference::Latest { subject_name } => {
            ProtoSchemaRef::Subject(subject_name.clone())
        }
        SchemaResgistryReference::SubjectVersion { name, version } => {
            let mut sv = ProtoSubjectVersion::new();
            sv.subject = name.clone();
            sv.version = *version as u32;
            ProtoSchemaRef::SubjectVersion(sv)
        }
    });
    sr
}

fn proto_to_kafka_schema(sr: ProtoSchemaRegistry) -> Option<KafkaSchema> {
    use crate::proto::infrastructure_map::schema_registry::Encoding as ProtoEncoding;
    let kind = match sr.encoding.enum_value_or_default() {
        ProtoEncoding::JSON => "JSON",
        ProtoEncoding::AVRO => "AVRO",
        ProtoEncoding::PROTOBUF => "PROTOBUF",
    }
    .to_string();

    let r = sr.schema_ref?;
    let reference = match r {
        crate::proto::infrastructure_map::schema_registry::SchemaRef::SchemaId(id) => {
            SchemaResgistryReference::Id(id as u8)
        }
        crate::proto::infrastructure_map::schema_registry::SchemaRef::Subject(s) => {
            SchemaResgistryReference::Latest { subject_name: s }
        }
        crate::proto::infrastructure_map::schema_registry::SchemaRef::SubjectVersion(sv) => {
            SchemaResgistryReference::SubjectVersion {
                name: sv.subject,
                version: sv.version as u8,
            }
        }
    };

    Some(KafkaSchema { kind, reference })
}
