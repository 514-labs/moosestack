use super::table::Metadata;
use super::{topic::Topic, DataLineage, InfrastructureSignature};
use crate::framework::versions::Version;
use crate::framework::{
    consumption::model::{ConsumptionQueryParam, EndpointFile},
    core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes},
    data_model::model::DataModel,
};
use crate::proto::infrastructure_map;
use crate::proto::infrastructure_map::api_endpoint::Api_type as ProtoApiType;
use crate::proto::infrastructure_map::Method as ProtoMethod;
use crate::proto::infrastructure_map::{
    ApiEndpoint as ProtoApiEndpoint, EgressDetails, IngressDetails,
};
use protobuf::{EnumOrUnknown, MessageField};
use serde::de::Error;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum APIType {
    INGRESS {
        target_topic_id: String,
        // in previous versions this is not stored,
        // so deserialization may fail if the value is not optional
        // our code does not depend on the stored field
        // TODO data model is a reference to the primitive map, that should not leak into the infrastructure map
        // that's a different level of abstraction
        data_model: Option<Box<DataModel>>,
        dead_letter_queue: Option<String>,
        #[serde(default)]
        schema: serde_json::Map<String, Value>,
    },
    EGRESS {
        query_params: Vec<ConsumptionQueryParam>,
        #[serde(default)]
        output_schema: Value,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Method {
    GET,
    POST,
    PUT,
    DELETE,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApiEndpoint {
    pub name: String,
    #[serde(deserialize_with = "APIType::backwards_compatible_deserialize")]
    pub api_type: APIType,
    pub path: PathBuf,
    pub method: Method,

    pub version: Option<Version>,
    pub source_primitive: PrimitiveSignature,
    pub metadata: Option<Metadata>,
    /// Infrastructure components this API reads data from (lineage).
    #[serde(default)]
    pub pulls_data_from: Vec<InfrastructureSignature>,
    /// Infrastructure components this API writes data to (lineage).
    #[serde(default)]
    pub pushes_data_to: Vec<InfrastructureSignature>,
}

impl ApiEndpoint {
    // dmv1 code
    pub fn from_data_model(data_model: &DataModel, topic: &Topic) -> Self {
        ApiEndpoint {
            name: data_model.name.clone(),
            api_type: APIType::INGRESS {
                target_topic_id: topic.id(),
                data_model: Some(Box::new(data_model.clone())),
                dead_letter_queue: None,
                schema: serde_json::Map::default(),
            },
            // This implementation is actually removing the functionality of nestedness of paths in
            // data model to change the ingest path. However, we are changing how this works with an
            // explicit in ingest path and we have not seen people use that functionality yet.
            path: PathBuf::from("ingest")
                .join(data_model.name.clone())
                .join(data_model.version.as_str()),
            method: Method::POST,
            version: Some(data_model.version.clone()),
            source_primitive: PrimitiveSignature {
                name: data_model.name.clone(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        }
    }

    pub fn id(&self) -> String {
        // TODO have a proper version object that standardizes transformations
        format!(
            "{}_{}{}",
            match self.api_type {
                APIType::INGRESS { .. } => "INGRESS",
                APIType::EGRESS { .. } => "EGRESS",
            },
            self.name,
            self.version
                .as_ref()
                .map_or("".to_string(), |v| format!("_{}", v.as_suffix()))
        )
    }

    pub fn expanded_display(&self) -> String {
        format!(
            "API Endpoint: {} - Version: {:?} - Path: {} - Method: {:?}",
            self.name,
            self.version,
            self.path.to_string_lossy(),
            self.method,
        )
    }

    pub fn short_display(&self) -> String {
        format!(
            "API Endpoint: {name} - Version: {version:?}",
            name = self.name,
            version = self.version
        )
    }

    pub fn to_proto(&self) -> ProtoApiEndpoint {
        ProtoApiEndpoint {
            name: self.name.clone(),
            api_type: Some(self.api_type.to_proto()),
            path: self.path.to_string_lossy().to_string(),
            method: EnumOrUnknown::new(self.method.to_proto()),
            version: self.version.as_ref().map(|v| v.to_string()),
            source_primitive: MessageField::some(self.source_primitive.to_proto()),
            metadata: MessageField::from_option(self.metadata.as_ref().map(|m| {
                infrastructure_map::Metadata {
                    description: m.description.clone().unwrap_or_default(),
                    source: MessageField::from_option(m.source.as_ref().map(|s| {
                        infrastructure_map::SourceLocation {
                            file: s.file.clone(),
                            special_fields: Default::default(),
                        }
                    })),
                    special_fields: Default::default(),
                }
            })),
            pulls_data_from: self.pulls_data_from.iter().map(|s| s.to_proto()).collect(),
            pushes_data_to: self.pushes_data_to.iter().map(|s| s.to_proto()).collect(),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: ProtoApiEndpoint) -> Self {
        ApiEndpoint {
            name: proto.name,
            api_type: APIType::from_proto(proto.api_type.unwrap()),
            path: PathBuf::from(proto.path),
            method: Method::from_proto(
                proto
                    .method
                    .enum_value()
                    .expect("Invalid method enum value"),
            ),
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

impl From<EndpointFile> for ApiEndpoint {
    fn from(value: EndpointFile) -> Self {
        ApiEndpoint {
            name: value
                .path
                .file_stem()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            api_type: APIType::EGRESS {
                query_params: value.query_params,
                output_schema: value.output_schema,
            },
            path: value.path.clone(),
            method: Method::GET,
            // TODO: why does consumption api use patch version, but others only have major.minor?
            version: Some(
                value
                    .version
                    .map(Version::from_string)
                    .unwrap_or_else(|| Version::from_string("0.0.0".to_string())),
            ),
            source_primitive: PrimitiveSignature {
                name: value.path.to_string_lossy().to_string(),
                primitive_type: PrimitiveTypes::ConsumptionAPI,
            },
            metadata: None,
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        }
    }
}

impl DataLineage for ApiEndpoint {
    fn pulls_data_from(&self, _default_database: &str) -> Vec<InfrastructureSignature> {
        self.pulls_data_from.clone()
    }

    fn pushes_data_to(&self, _default_database: &str) -> Vec<InfrastructureSignature> {
        match &self.api_type {
            APIType::INGRESS {
                target_topic_id, ..
            } => {
                let mut pushes = vec![InfrastructureSignature::Topic {
                    id: target_topic_id.clone(),
                }];
                pushes.extend(self.pushes_data_to.iter().cloned());

                // Preserve insertion order while deduplicating.
                let mut seen = HashSet::new();
                pushes
                    .into_iter()
                    .filter(|signature| seen.insert(signature.clone()))
                    .collect()
            }
            APIType::EGRESS { .. } => self.pushes_data_to.clone(),
        }
    }
}

impl APIType {
    fn to_proto(&self) -> ProtoApiType {
        match self {
            APIType::INGRESS {
                target_topic_id,
                data_model: _data_model,
                dead_letter_queue,
                schema: _,
            } => ProtoApiType::Ingress(IngressDetails {
                target_topic: target_topic_id.clone(),
                special_fields: Default::default(),
                dead_letter_queue: dead_letter_queue.clone(),
                ..Default::default()
            }),
            APIType::EGRESS {
                query_params,
                output_schema,
            } => ProtoApiType::Egress(EgressDetails {
                query_params: query_params.iter().map(|param| param.to_proto()).collect(),
                output_schema: output_schema.to_string(),
                special_fields: Default::default(),
            }),
        }
    }

    fn backwards_compatible_deserialize<'de, D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let json = Value::deserialize(deserializer)?;
        match json {
            Value::String(s) if s == "EGRESS" => Ok(APIType::EGRESS {
                query_params: vec![],
                output_schema: Value::Null,
            }),
            _ => serde_json::from_value(json).map_err(D::Error::custom),
        }
    }

    pub fn from_proto(proto: ProtoApiType) -> Self {
        match proto {
            ProtoApiType::Ingress(details) => APIType::INGRESS {
                target_topic_id: details.target_topic,
                dead_letter_queue: details.dead_letter_queue,
                data_model: None,
                schema: serde_json::Map::default(),
            },
            ProtoApiType::Egress(details) => APIType::EGRESS {
                query_params: details
                    .query_params
                    .into_iter()
                    .map(ConsumptionQueryParam::from_proto)
                    .collect(),
                output_schema: serde_json::from_str(&details.output_schema).unwrap_or_default(),
            },
        }
    }
}

impl Method {
    fn to_proto(&self) -> ProtoMethod {
        match self {
            Method::GET => ProtoMethod::GET,
            Method::POST => ProtoMethod::POST,
            Method::PUT => ProtoMethod::PUT,
            Method::DELETE => ProtoMethod::DELETE,
        }
    }

    pub fn from_proto(proto: ProtoMethod) -> Self {
        match proto {
            ProtoMethod::GET => Method::GET,
            ProtoMethod::POST => Method::POST,
            ProtoMethod::PUT => Method::PUT,
            ProtoMethod::DELETE => Method::DELETE,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};

    #[test]
    fn ingress_pushes_data_to_is_deterministic_and_deduplicated() {
        let endpoint = ApiEndpoint {
            name: "test".to_string(),
            api_type: APIType::INGRESS {
                target_topic_id: "target_topic".to_string(),
                data_model: None,
                dead_letter_queue: None,
                schema: serde_json::Map::default(),
            },
            path: PathBuf::from("/ingest"),
            method: Method::POST,
            version: None,
            source_primitive: PrimitiveSignature {
                name: "test".to_string(),
                primitive_type: PrimitiveTypes::ConsumptionAPI,
            },
            metadata: None,
            pulls_data_from: vec![],
            pushes_data_to: vec![
                InfrastructureSignature::Topic {
                    id: "target_topic".to_string(),
                },
                InfrastructureSignature::Topic {
                    id: "secondary_topic".to_string(),
                },
            ],
        };

        let lineage = endpoint.pushes_data_to("default");
        assert_eq!(
            lineage,
            vec![
                InfrastructureSignature::Topic {
                    id: "target_topic".to_string()
                },
                InfrastructureSignature::Topic {
                    id: "secondary_topic".to_string()
                }
            ]
        );
    }
}
