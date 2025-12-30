use serde::{Deserialize, Serialize};

use crate::framework::data_model::model::DataModel;
use crate::framework::versions::Version;
use crate::proto::infrastructure_map::view::View_type as ProtoViewType;
use crate::proto::infrastructure_map::TableAlias as ProtoTableAlias;
use crate::proto::infrastructure_map::View as ProtoView;

use super::DataLineage;
use super::InfrastructureSignature;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ViewType {
    TableAlias { source_table_name: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct View {
    pub name: String,
    pub version: Version,
    pub view_type: ViewType,
}

impl View {
    // This is only to be used in the context of the new core
    // currently name includes the version, here we are separating that out.
    pub fn id(&self) -> String {
        format!("{}_{}", self.name, self.version.as_suffix())
    }

    pub fn expanded_display(&self) -> String {
        self.short_display()
    }

    pub fn short_display(&self) -> String {
        format!("View: {} Version {}", self.name, self.version)
    }

    pub fn alias_view(data_model: &DataModel, source_data_model: &DataModel) -> Self {
        View {
            name: data_model.name.clone(),
            version: data_model.version.clone(),
            view_type: ViewType::TableAlias {
                source_table_name: source_data_model.id(),
            },
        }
    }

    pub fn to_proto(&self) -> ProtoView {
        ProtoView {
            name: self.name.clone(),
            version: self.version.to_string(),
            view_type: Some(self.view_type.to_proto()),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: ProtoView) -> Self {
        View {
            name: proto.name,
            version: Version::from_string(proto.version),
            view_type: ViewType::from_proto(proto.view_type.unwrap()),
        }
    }
}

impl DataLineage for View {
    fn pulls_data_from(&self) -> Vec<InfrastructureSignature> {
        match &self.view_type {
            ViewType::TableAlias { source_table_name } => vec![InfrastructureSignature::Table {
                id: source_table_name.clone(),
            }],
        }
    }

    fn pushes_data_to(&self) -> Vec<InfrastructureSignature> {
        vec![]
    }
}

impl ViewType {
    fn to_proto(&self) -> ProtoViewType {
        match self {
            ViewType::TableAlias { source_table_name } => {
                ProtoViewType::TableAlias(ProtoTableAlias {
                    source_table_name: source_table_name.clone(),
                    special_fields: Default::default(),
                })
            }
        }
    }

    pub fn from_proto(proto: ProtoViewType) -> Self {
        match proto {
            ProtoViewType::TableAlias(alias) => ViewType::TableAlias {
                source_table_name: alias.source_table_name,
            },
        }
    }
}
