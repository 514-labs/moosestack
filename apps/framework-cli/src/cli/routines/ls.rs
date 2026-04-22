//! Module for listing available resources in the Moose framework.
//!
//! This module provides functionality to list database resources (tables, views)
//! and streaming resources (topics) based on the project configuration.

use super::{RoutineFailure, RoutineSuccess};
use crate::framework::core::infrastructure::api_endpoint::{APIType, ApiEndpoint};
use crate::framework::core::infrastructure::function_process::FunctionProcess;
use crate::framework::core::infrastructure::topic::Topic;
use crate::framework::core::infrastructure::topic_sync_process::TopicToTableSyncProcess;
use crate::framework::core::infrastructure::web_app::WebApp;
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
    pub method: String,
    pub url: String,
    pub destination: String,
}

fn endpoint_url(base_url: &str, endpoint: &ApiEndpoint) -> String {
    // `endpoint.path` is the server-relative path Moose routes on (e.g.
    // `"ingest/UserActivityEvent/1.0"`). Compose with the dev server's base
    // URL so the rendered value is directly pastable into curl / HTTP
    // clients without the user having to know the host/port.
    let path = endpoint.path.to_string_lossy();
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn method_name(
    method: &crate::framework::core::infrastructure::api_endpoint::Method,
) -> &'static str {
    use crate::framework::core::infrastructure::api_endpoint::Method;
    match method {
        Method::GET => "GET",
        Method::POST => "POST",
        Method::PUT => "PUT",
        Method::DELETE => "DELETE",
    }
}

fn to_info(endpoint: &ApiEndpoint, base_url: &str) -> Either<IngestionApiInfo, ConsumptionApiInfo> {
    let url = endpoint_url(base_url, endpoint);
    let method = method_name(&endpoint.method).to_string();
    match &endpoint.api_type {
        APIType::INGRESS {
            target_topic_id,
            dead_letter_queue: _,
            data_model: _,
            schema: _,
        } => Either::Left(IngestionApiInfo {
            name: endpoint.name.clone(),
            method,
            url,
            destination: target_topic_id.clone(),
        }),
        APIType::EGRESS {
            query_params,
            output_schema: _,
        } => Either::Right(ConsumptionApiInfo {
            name: endpoint.name.clone(),
            method,
            url,
            params: query_params
                .iter()
                .map(|param| param.name.clone())
                .collect(),
        }),
    }
}

impl ResourceInfo for Vec<IngestionApiInfo> {
    fn show(&self) {
        show_table(
            "Ingestion APIs".to_string(),
            vec![
                "name".to_string(),
                "method".to_string(),
                "url".to_string(),
                "destination".to_string(),
            ],
            self.iter()
                .map(|api| {
                    vec![
                        api.name.clone(),
                        api.method.clone(),
                        api.url.clone(),
                        api.destination.clone(),
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
    pub method: String,
    pub url: String,
    pub params: Vec<String>,
}

impl ResourceInfo for Vec<ConsumptionApiInfo> {
    fn show(&self) {
        show_table(
            "Analytics APIs".to_string(),
            vec![
                "name".to_string(),
                "method".to_string(),
                "url".to_string(),
                "params".to_string(),
            ],
            self.iter()
                .map(|api| {
                    vec![
                        api.name.clone(),
                        api.method.clone(),
                        api.url.clone(),
                        api.params.iter().join(", "),
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
pub struct WebAppInfo {
    pub name: String,
    pub mount_path: String,
    pub url: String,
}

impl WebAppInfo {
    fn from_web_app(value: WebApp, base_url: &str) -> Self {
        let mount = if value.mount_path.starts_with('/') {
            value.mount_path.clone()
        } else {
            format!("/{}", value.mount_path)
        };
        Self {
            name: value.name,
            url: format!("{}{}", base_url, mount),
            mount_path: value.mount_path,
        }
    }
}

impl ResourceInfo for Vec<WebAppInfo> {
    fn show(&self) {
        show_table(
            "Web Apps".to_string(),
            vec![
                "name".to_string(),
                "url".to_string(),
                "mount_path".to_string(),
            ],
            self.iter()
                .map(|app| vec![app.name.clone(), app.url.clone(), app.mount_path.clone()])
                .collect(),
        )
    }

    fn to_json_string(&self) -> Result<String, Error> {
        serde_json::to_string_pretty(&self)
    }
}

#[derive(Debug, Serialize)]
pub struct DictionaryInfo {
    pub name: String,
    pub source_type: String,
    pub layout: String,
}

impl ResourceInfo for Vec<DictionaryInfo> {
    fn show(&self) {
        show_table(
            "Dictionaries".to_string(),
            vec![
                "name".to_string(),
                "source_type".to_string(),
                "layout".to_string(),
            ],
            self.iter()
                .map(|d| vec![d.name.clone(), d.source_type.clone(), d.layout.clone()])
                .collect(),
        )
    }
    fn to_json_string(&self) -> Result<String, Error> {
        serde_json::to_string_pretty(&self)
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
    pub web_apps: Vec<WebAppInfo>,
    pub dictionaries: Vec<DictionaryInfo>,
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
        self.web_apps.show();
        self.dictionaries.show();
    }

    fn to_json_string(&self) -> Result<String, Error> {
        serde_json::to_string_pretty(&self)
    }
}

pub async fn ls(
    project: &Project,
    _type: Option<&str>,
    name: Option<&str>,
    json: bool,
) -> Result<RoutineSuccess, RoutineFailure> {
    // Don't resolve credentials for ls command - only inspects structure
    let infra_map = InfrastructureMap::load_from_user_code(project, false)
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

    let base_url = project.http_server_config.url();

    let (ingestion_apis, consumption_apis): (Vec<_>, Vec<_>) = infra_map
        .api_endpoints
        .values()
        .filter(|api| name.is_none_or(|name| api.name.contains(name)))
        .partition_map(|ep| to_info(ep, &base_url));
    let resources = ResourceListing {
        tables: infra_map
            .tables
            .into_values()
            .filter(|api| name.is_none_or(|name| api.name.contains(name)))
            .map(|t| TableInfo {
                // Use the display name (bare `name` for the default database,
                // `database.name` otherwise) so the output is directly
                // pastable into `moose query` / ClickHouse SQL. The
                // `{db}_{name}` form returned by `Table::id()` is the
                // infra-map's internal uniqueness key, not a valid SQL
                // identifier.
                name: t.display_name(),
                schema_fields: t.columns.iter().map(|col| col.name.clone()).collect(),
            })
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
        web_apps: infra_map
            .web_apps
            .into_values()
            .filter(|app| name.is_none_or(|n| app.name.contains(n)))
            .map(|app| WebAppInfo::from_web_app(app, &base_url))
            .collect(),
        dictionaries: infra_map
            .olap_dictionaries
            .into_values()
            .filter(|d| name.is_none_or(|n| d.name.contains(n)))
            .map(|d| DictionaryInfo {
                // Same reasoning as for tables: render the query-pastable
                // display name, not the infra-map `id()`.
                name: d.display_name(),
                source_type: d.source.source_type_label().to_string(),
                layout: d.layout.layout_type_label().to_string(),
            })
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
        Some("web_apps") => &resources.web_apps,
        Some("dictionaries") => &resources.dictionaries,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn endpoint_url_joins_base_and_relative_path() {
        let endpoint = ApiEndpoint {
            name: "foo".to_string(),
            api_type: APIType::EGRESS {
                query_params: vec![],
                output_schema: serde_json::Value::Null,
            },
            path: PathBuf::from("api/foo/1.0"),
            method: crate::framework::core::infrastructure::api_endpoint::Method::GET,
            version: None,
            source_primitive: crate::framework::core::infrastructure_map::PrimitiveSignature {
                name: "foo".to_string(),
                primitive_type:
                    crate::framework::core::infrastructure_map::PrimitiveTypes::ConsumptionAPI,
            },
            metadata: None,
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        };
        assert_eq!(
            endpoint_url("http://localhost:4000", &endpoint),
            "http://localhost:4000/api/foo/1.0"
        );
        // Tolerates trailing/leading slashes — no doubled slash in output.
        assert_eq!(
            endpoint_url("http://localhost:4000/", &endpoint),
            "http://localhost:4000/api/foo/1.0"
        );
    }

    #[test]
    fn web_app_info_builds_absolute_url_from_mount_path() {
        let base = "http://localhost:4000";
        let with_leading = WebApp::new("docs".to_string(), "/docs".to_string());
        let without_leading = WebApp::new("admin".to_string(), "admin".to_string());
        assert_eq!(
            WebAppInfo::from_web_app(with_leading, base).url,
            "http://localhost:4000/docs"
        );
        assert_eq!(
            WebAppInfo::from_web_app(without_leading, base).url,
            "http://localhost:4000/admin"
        );
    }
}
