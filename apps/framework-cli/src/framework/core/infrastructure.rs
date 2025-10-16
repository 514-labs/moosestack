//! Infrastructure module for framework core components.
//!
//! This module defines the core infrastructure components used throughout the framework,
//! providing abstractions for various data storage, processing, and communication mechanisms.
//! It establishes a consistent pattern for defining infrastructure components and their
//! relationships through data lineage.
//!
//! This is a platform agnostic module that can be used to define infrastructure components
//! for any platform. ie there should not be anything specific to a given warehouse or streaming engine
//! in this module.
//!
//! The infrastructure components are used to build the infrastructure map which is used to
//! generate the deployment plan.
//!
//! If components need to reference each other, they should do so by reference and not by value.

use crate::proto::infrastructure_map::{
    infrastructure_signature, InfrastructureSignature as ProtoInfrastructureSignature,
};
use serde::{Deserialize, Serialize};
use std::hash::Hash;

pub mod api_endpoint;
pub mod consumption_webserver;
pub mod function_process;
pub mod olap_process;
pub mod orchestration_worker;
pub mod sql_resource;
pub mod table;
pub mod topic;
pub mod topic_sync_process;
pub mod view;
pub mod web_app;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Eq, Hash)]
#[serde(tag = "kind")]
/// Represents the unique signature of an infrastructure component.
///
/// Infrastructure signatures are used to identify and reference various infrastructure
/// components throughout the system, enabling tracking of data flows and dependencies
/// between components.
///
/// Each variant corresponds to a specific type of infrastructure with a unique identifier.
pub enum InfrastructureSignature {
    /// Table storage infrastructure component
    Table { id: String },
    /// Messaging topic infrastructure component
    Topic { id: String },
    /// API endpoint infrastructure component
    ApiEndpoint { id: String },
    /// Process that synchronizes data from a topic to a table
    TopicToTableSyncProcess { id: String },
    /// View infrastructure component
    View { id: String },
    /// SQL resource infrastructure component
    SqlResource { id: String },
}

impl InfrastructureSignature {
    pub fn to_proto(&self) -> ProtoInfrastructureSignature {
        match self {
            InfrastructureSignature::Table { id } => {
                let mut proto = ProtoInfrastructureSignature::new();
                proto.set_table_id(id.clone());
                proto
            }
            InfrastructureSignature::Topic { id } => {
                let mut proto = ProtoInfrastructureSignature::new();
                proto.set_topic_id(id.clone());
                proto
            }
            InfrastructureSignature::ApiEndpoint { id } => {
                let mut proto = ProtoInfrastructureSignature::new();
                proto.set_api_endpoint_id(id.clone());
                proto
            }
            InfrastructureSignature::TopicToTableSyncProcess { id } => {
                let mut proto = ProtoInfrastructureSignature::new();
                proto.set_topic_to_table_sync_process_id(id.clone());
                proto
            }
            InfrastructureSignature::View { id } => {
                let mut proto = ProtoInfrastructureSignature::new();
                proto.set_view_id(id.clone());
                proto
            }
            InfrastructureSignature::SqlResource { id } => {
                let mut proto = ProtoInfrastructureSignature::new();
                proto.set_sql_resource_id(id.clone());
                proto
            }
        }
    }

    pub fn from_proto(proto: ProtoInfrastructureSignature) -> Self {
        match proto.signature {
            Some(infrastructure_signature::Signature::TableId(id)) => {
                InfrastructureSignature::Table { id }
            }
            Some(infrastructure_signature::Signature::TopicId(id)) => {
                InfrastructureSignature::Topic { id }
            }
            Some(infrastructure_signature::Signature::ApiEndpointId(id)) => {
                InfrastructureSignature::ApiEndpoint { id }
            }
            Some(infrastructure_signature::Signature::TopicToTableSyncProcessId(id)) => {
                InfrastructureSignature::TopicToTableSyncProcess { id }
            }
            Some(infrastructure_signature::Signature::ViewId(id)) => {
                InfrastructureSignature::View { id }
            }
            Some(infrastructure_signature::Signature::SqlResourceId(id)) => {
                InfrastructureSignature::SqlResource { id }
            }
            None => {
                panic!("Invalid infrastructure signature");
            }
        }
    }
}

/// Defines the data flow relationships between infrastructure components.
///
/// This trait enables components to express their data lineage - how data flows into,
/// through, and out of the component. By implementing this trait, components can
/// participate in data flow analysis, dependency tracking, and observability.
///
/// The distinction between "receives", "pulls", and "pushes" represents different
/// data flow patterns:
/// - Receiving: Passive acceptance of data pushed by another component
/// - Pulling: Active fetching of data from another component
/// - Pushing: Active sending of data to another component
pub trait DataLineage {
    /// Returns infrastructure components that this component actively pulls data from.
    fn pulls_data_from(&self) -> Vec<InfrastructureSignature>;

    /// Returns infrastructure components that this component actively pushes data to.
    fn pushes_data_to(&self) -> Vec<InfrastructureSignature>;
}
