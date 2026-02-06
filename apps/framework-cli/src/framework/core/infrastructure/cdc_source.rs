use crate::framework::core::infrastructure::table::Metadata;
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::proto::infrastructure_map::{
    CdcSource as ProtoCdcSource, CdcTable as ProtoCdcTable, LifeCycle as ProtoLifeCycle,
};
use protobuf::MessageField;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CdcTable {
    pub name: String,
    #[serde(rename = "sourceTable")]
    pub source_table: String,
    #[serde(rename = "primaryKey")]
    pub primary_key: Vec<String>,
    pub stream: Option<String>,
    pub table: Option<String>,
    pub snapshot: Option<String>,
    pub version: Option<String>,
    pub metadata: Option<Metadata>,
}

impl CdcTable {
    pub fn to_proto(&self) -> ProtoCdcTable {
        ProtoCdcTable {
            name: self.name.clone(),
            source_table: self.source_table.clone(),
            primary_key: self.primary_key.clone(),
            stream: self.stream.clone(),
            table: self.table.clone(),
            snapshot: self.snapshot.clone(),
            version: self.version.clone(),
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

    pub fn from_proto(proto: ProtoCdcTable) -> Self {
        CdcTable {
            name: proto.name,
            source_table: proto.source_table,
            primary_key: proto.primary_key,
            stream: proto.stream,
            table: proto.table,
            snapshot: proto.snapshot,
            version: proto.version,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CdcSource {
    pub name: String,
    pub kind: String,
    pub connection: String,
    pub tables: Vec<CdcTable>,
    pub metadata: Option<Metadata>,
    pub life_cycle: LifeCycle,
}

impl CdcSource {
    pub fn expanded_display(&self) -> String {
        format!(
            "CDC Source: {} ({}) - {} tables",
            self.name,
            self.kind,
            self.tables.len()
        )
    }

    pub fn short_display(&self) -> String {
        self.expanded_display()
    }

    pub fn to_proto(&self) -> ProtoCdcSource {
        ProtoCdcSource {
            name: self.name.clone(),
            kind: self.kind.clone(),
            connection: self.connection.clone(),
            tables: self.tables.iter().map(|t| t.to_proto()).collect(),
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
            life_cycle: match self.life_cycle {
                LifeCycle::FullyManaged => ProtoLifeCycle::FULLY_MANAGED.into(),
                LifeCycle::DeletionProtected => ProtoLifeCycle::DELETION_PROTECTED.into(),
                LifeCycle::ExternallyManaged => ProtoLifeCycle::EXTERNALLY_MANAGED.into(),
            },
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: ProtoCdcSource) -> Self {
        CdcSource {
            name: proto.name,
            kind: proto.kind,
            connection: proto.connection,
            tables: proto.tables.into_iter().map(CdcTable::from_proto).collect(),
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
            life_cycle: match proto.life_cycle.enum_value_or_default() {
                ProtoLifeCycle::FULLY_MANAGED => LifeCycle::FullyManaged,
                ProtoLifeCycle::DELETION_PROTECTED => LifeCycle::DeletionProtected,
                ProtoLifeCycle::EXTERNALLY_MANAGED => LifeCycle::ExternallyManaged,
            },
        }
    }
}
