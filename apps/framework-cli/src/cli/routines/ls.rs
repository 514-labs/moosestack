//! Module for listing available resources in the Moose framework.
//!
//! This module provides functionality to list database resources (tables, views)
//! and streaming resources (topics) based on the project configuration.

use super::{RoutineFailure, RoutineSuccess};
use crate::framework::core::infrastructure::api_endpoint::{APIType, ApiEndpoint};
use crate::framework::core::infrastructure::function_process::FunctionProcess;
use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure::topic::Topic;
use crate::framework::core::infrastructure::topic_sync_process::TopicToTableSyncProcess;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::framework::scripts::Workflow;
use crate::{
    cli::display::{show_table, Message},
    project::Project,
};
use itertools::{Either, Itertools};
use serde::Serialize;
use serde_json::Error;
use std::collections::HashMap;

#[derive(Debug, Serialize)]
pub struct TableInfo {
    pub name: String,
    pub schema_fields: Vec<String>,
}

impl ResourceInfo for Vec<TableInfo> {
    fn show(&self) {
        show_table(
            "Tables".to_string(),
            vec!["name".to_string(), "schema_fields".to_string()],
            self.iter()
                .map(|t| vec![t.name.clone(), t.schema_fields.iter().join(", ")])
                .collect(),
        )
    }
    fn to_json_string(&self) -> Result<String, Error> {
        serde_json::to_string_pretty(&self)
    }
}

impl From<Table> for TableInfo {
    fn from(value: Table) -> Self {
        Self {
            name: value.id(),
            schema_fields: value.columns.iter().map(|col| col.name.clone()).collect(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct StreamInfo {
    pub name: String,
    pub schema_fields: Vec<String>,
    pub destination: Option<String>,
}

impl StreamInfo {
    fn from_topic(
        value: Topic,
        topic_to_table_sync_processes: &HashMap<String, TopicToTableSyncProcess>,
    ) -> Self {
        let process = topic_to_table_sync_processes
            .values()
            .find(|p| p.source_topic_id == value.id());

        Self {
            name: value.id(),
            schema_fields: value.columns.iter().map(|col| col.name.clone()).collect(),
            destination: process.map(|p| p.target_table_id.to_string()),
        }
    }
}

impl ResourceInfo for Vec<StreamInfo> {
    fn show(&self) {
        show_table(
            "Streams".to_string(),
            vec![
                "name".to_string(),
                "schema_fields".to_string(),
                "destination".to_string(),
            ],
            self.iter()
                .map(|s| {
                    vec![
                        s.name.clone(),
                        s.schema_fields.iter().join(", "),
                        s.destination.clone().unwrap_or_default(),
                    ]
                })
                .collect(),
        )
    }
    fn to_json_string(&self) -> Result<String, Error> {
        serde_json::to_string_pretty(&self)
    }
}

#[derive(Debug, Serialize)]
pub struct IngestionApiInfo {
    pub name: String,
    pub destination: String,
}

fn to_info(endpoint: &ApiEndpoint) -> Either<IngestionApiInfo, ConsumptionApiInfo> {
    match &endpoint.api_type {
        APIType::INGRESS {
            target_topic_id,
            dead_letter_queue: _,
            data_model: _,
            schema: _,
        } => Either::Left(IngestionApiInfo {
            name: endpoint.name.clone(),
            destination: target_topic_id.clone(),
        }),
        APIType::EGRESS {
            query_params,
            output_schema: _,
        } => Either::Right(ConsumptionApiInfo {
            name: endpoint.name.clone(),
            params: query_params
                .iter()
                .map(|param| param.name.clone())
                .collect(),
            path: match &endpoint.version {
                Some(version) => format!("api/{}/{}", endpoint.name, version),
                None => format!("api/{}", endpoint.name),
            },
        }),
    }
}

impl ResourceInfo for Vec<IngestionApiInfo> {
    fn show(&self) {
        show_table(
            "Ingestion APIs".to_string(),
            vec!["name".to_string(), "destination".to_string()],
            self.iter()
                .map(|api| vec![api.name.clone(), api.destination.clone()])
                .collect(),
        )
    }
    fn to_json_string(&self) -> Result<String, Error> {
        serde_json::to_string_pretty(&self)
    }
}

#[derive(Debug, Serialize)]
pub struct SqlResourceInfo {
    pub name: String,
}

impl ResourceInfo for Vec<SqlResourceInfo> {
    fn show(&self) {
        show_table(
            "SQL Resources".to_string(),
            vec!["name".to_string()],
            self.iter()
                .map(|resource| vec![resource.name.clone()])
                .collect(),
        )
    }
    fn to_json_string(&self) -> Result<String, Error> {
        serde_json::to_string_pretty(&self)
    }
}

#[derive(Debug, Serialize)]
pub struct ConsumptionApiInfo {
    pub name: String,
    pub params: Vec<String>,
    pub path: String,
}

impl ResourceInfo for Vec<ConsumptionApiInfo> {
    fn show(&self) {
        show_table(
            "Analytics APIs".to_string(),
            vec!["name".to_string(), "params".to_string(), "path".to_string()],
            self.iter()
                .map(|api| {
                    vec![
                        api.name.clone(),
                        api.params.iter().join(", "),
                        api.path.clone(),
                    ]
                })
                .collect(),
        )
    }
    fn to_json_string(&self) -> Result<String, Error> {
        serde_json::to_string_pretty(&self)
    }
}

#[derive(Debug, Serialize)]
pub struct StreamTransformationInfo {
    pub source: String,
    pub destinations: Vec<String>,
}

impl ResourceInfo for Vec<StreamTransformationInfo> {
    fn show(&self) {
        show_table(
            "Streaming Functions".to_string(),
            vec!["source".to_string(), "destinations".to_string()],
            self.iter()
                .map(|transform| {
                    vec![
                        transform.source.clone(),
                        transform.destinations.iter().join(", "),
                    ]
                })
                .collect(),
        )
    }
    fn to_json_string(&self) -> Result<String, Error> {
        serde_json::to_string_pretty(&self)
    }
}

impl From<FunctionProcess> for StreamTransformationInfo {
    fn from(value: FunctionProcess) -> Self {
        Self {
            source: value.source_topic_id,
            destinations: value.target_topic_id.into_iter().collect(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct WorkflowInfo {
    pub name: String,
    pub schedule: String,
}

impl ResourceInfo for Vec<WorkflowInfo> {
    fn show(&self) {
        show_table(
            "Workflows".to_string(),
            vec!["name".to_string(), "schedule".to_string()],
            self.iter()
                .map(|workflow| vec![workflow.name.clone(), workflow.schedule.clone()])
                .collect(),
        )
    }
    fn to_json_string(&self) -> Result<String, Error> {
        serde_json::to_string_pretty(&self)
    }
}

impl From<Workflow> for WorkflowInfo {
    fn from(value: Workflow) -> Self {
        let schedule = if value.config().schedule.is_empty() {
            "None".to_string()
        } else {
            value.config().schedule.clone()
        };

        Self {
            name: value.name().to_string(),
            schedule,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ResourceListing {
    pub tables: Vec<TableInfo>,
    pub streams: Vec<StreamInfo>,
    pub ingestion_apis: Vec<IngestionApiInfo>,
    pub sql_resources: Vec<SqlResourceInfo>,
    pub consumption_apis: Vec<ConsumptionApiInfo>,
    pub stream_transformations: Vec<StreamTransformationInfo>,
    pub workflows: Vec<WorkflowInfo>,
}

impl ResourceInfo for ResourceListing {
    fn show(&self) {
        self.tables.show();
        self.streams.show();
        self.ingestion_apis.show();
        self.sql_resources.show();
        self.consumption_apis.show();
        self.stream_transformations.show();
        self.workflows.show();
    }

    fn to_json_string(&self) -> Result<String, Error> {
        serde_json::to_string_pretty(&self)
    }
}

pub async fn ls_dmv2(
    project: &Project,
    _type: Option<&str>,
    name: Option<&str>,
    json: bool,
) -> Result<RoutineSuccess, RoutineFailure> {
    let infra_map = InfrastructureMap::load_from_user_code(project)
        .await
        .map_err(|e| {
            RoutineFailure::new(
                Message {
                    action: "Load".to_string(),
                    details: "Infrastructure".to_string(),
                },
                e,
            )
        })?;

    let (ingestion_apis, consumption_apis): (Vec<_>, Vec<_>) = infra_map
        .api_endpoints
        .values()
        .filter(|api| name.is_none_or(|name| api.name.contains(name)))
        .partition_map(to_info);
    let resources = ResourceListing {
        tables: infra_map
            .tables
            .into_values()
            .filter(|api| name.is_none_or(|name| api.name.contains(name)))
            .map(|t| t.into())
            .collect(),
        streams: infra_map
            .topics
            .into_values()
            .filter(|api| name.is_none_or(|name| api.name.contains(name)))
            .map(|t| StreamInfo::from_topic(t, &infra_map.topic_to_table_sync_processes))
            .collect(),
        ingestion_apis,
        sql_resources: infra_map
            .sql_resources
            .into_values()
            .filter(|api| name.is_none_or(|name| api.name.contains(name)))
            .map(|resource| SqlResourceInfo {
                name: resource.name,
            })
            .collect(),
        consumption_apis,
        stream_transformations: infra_map
            .function_processes
            .into_values()
            .filter(|api| name.is_none_or(|name| api.name.contains(name)))
            .map(|p| p.into())
            .collect(),
        workflows: infra_map
            .workflows
            .into_values()
            .filter(|api| name.is_none_or(|name| api.name().contains(name)))
            .map(|w| w.into())
            .collect(),
    };
    let listing: &dyn ResourceInfo = match _type {
        None => &resources,
        Some("tables") => &resources.tables,
        Some("streams") => &resources.streams,
        Some("ingestion") => &resources.ingestion_apis,
        Some("sql_resource") => &resources.sql_resources,
        Some("consumption") => &resources.consumption_apis,
        Some("workflows") => &resources.workflows,
        _ => {
            return Err(RoutineFailure::error(Message::new(
                "Unknown".to_string(),
                "type".to_string(),
            )))
        }
    };
    if json {
        println!("{}", listing.to_json_string().unwrap());
    } else {
        listing.show();
    }

    Ok(RoutineSuccess::success(Message {
        action: "".to_string(),
        details: "".to_string(),
    }))
}

trait ResourceInfo {
    fn show(&self);
    fn to_json_string(&self) -> Result<String, serde_json::error::Error>;
}
