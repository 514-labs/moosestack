use crate::cli::display::message::{Message, MessageType};
use crate::framework::consumption::model::ConsumptionQueryParam;
use crate::framework::core::infrastructure::table::{ColumnType, FloatType, IntType};
use crate::framework::typescript::export_collectors::ExportCollectorError;
use crate::infrastructure::olap::clickhouse::config::ClickHouseConfig;
use crate::infrastructure::processes::consumption_registry::ConsumptionError;
use crate::project::{JwtConfig, Project};
use log::{debug, error, info};
use serde_json::{Map, Value};
use std::path::Path;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

use super::bin;

const CONSUMPTION_RUNNER_BIN: &str = "consumption-apis";

// TODO: Abstract away ClickhouseConfig to support other databases
// TODO: Bubble up compilation errors to the user
pub fn run(
    project: &Project,
    clickhouse_config: &ClickHouseConfig,
    jwt_config: &Option<JwtConfig>,
    consumption_path: &Path,
    project_path: &Path,
    proxy_port: Option<u16>,
) -> Result<Child, ConsumptionError> {
    let host_port = clickhouse_config.host_port.to_string();
    let temporal_url = project.temporal_config.temporal_url();
    let temporal_namespace = project.temporal_config.get_temporal_namespace();
    let client_cert = project.temporal_config.client_cert.clone();
    let client_key = project.temporal_config.client_key.clone();
    let api_key = project.temporal_config.api_key.clone();

    let mut string_args = vec![
        consumption_path.to_str().unwrap().to_string(),
        clickhouse_config.db_name.clone(),
        clickhouse_config.host.clone(),
        host_port,
        clickhouse_config.user.clone(),
        clickhouse_config.password.clone(),
    ];

    if clickhouse_config.use_ssl {
        string_args.push("--clickhouse-use-ssl".to_string());
    }

    if let Some(jwt_config) = jwt_config {
        if jwt_config.enforce_on_all_consumptions_apis {
            string_args.push("--enforce-auth".to_string());
        }

        string_args.push("--jwt-secret".to_string());
        string_args.push(jwt_config.secret.clone());
        string_args.push("--jwt-issuer".to_string());
        string_args.push(jwt_config.issuer.clone());
        string_args.push("--jwt-audience".to_string());
        string_args.push(jwt_config.audience.clone());
    }

    if project.features.workflows {
        string_args.push("--temporal-url".to_string());
        string_args.push(temporal_url);

        string_args.push("--temporal-namespace".to_string());
        string_args.push(temporal_namespace);

        string_args.push("--client-cert".to_string());
        string_args.push(client_cert);

        string_args.push("--client-key".to_string());
        string_args.push(client_key);

        string_args.push("--api-key".to_string());
        string_args.push(api_key);
    }

    if project.features.data_model_v2 {
        string_args.push("--is-dmv2".to_string());
    }

    if let Some(port) = proxy_port {
        string_args.push("--proxy-port".to_string());
        string_args.push(port.to_string());
    }

    let args: Vec<&str> = string_args.iter().map(|s| s.as_str()).collect();
    let mut consumption_process = bin::run(CONSUMPTION_RUNNER_BIN, project_path, &args, project)?;

    let stdout = consumption_process
        .stdout
        .take()
        .expect("Analytics api process did not have a handle to stdout");

    let stderr = consumption_process
        .stderr
        .take()
        .expect("Analytics api process did not have a handle to stderr");

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();

    tokio::spawn(async move {
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            let stripped = if let Some(s) = line.strip_prefix("[QueryClient] | ") {
                Some(s)
            } else if let Some(s) = line.strip_prefix("[API] | ") {
                Some(s)
            } else {
                None
            };
            if let Some(stripped) = stripped {
                show_message!(
                    MessageType::Info,
                    Message {
                        action: "API".to_string(),
                        details: stripped.to_string(),
                    }
                );
            } else {
                info!("{}", line);
            }
        }
    });

    tokio::spawn(async move {
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            error!("{}", line);
        }
    });

    Ok(consumption_process)
}

fn schema_to_params_list(
    schema: &Value,
) -> Result<Vec<ConsumptionQueryParam>, ExportCollectorError> {
    let required_keys = schema
        .as_object()
        .and_then(|m| m.get("required"))
        .and_then(|v| v.as_array());

    let converted = schema
        .as_object()
        .and_then(|m| m.get("properties"))
        .and_then(|o| o.as_object())
        .ok_or_else(|| ExportCollectorError::Other {
            message: "Missing properties in schema.".to_string(),
        })?
        .iter()
        .map(|(k, v)| {
            let type_object = v.as_object();
            let data_type = match type_object
                .and_then(|m| m.get("type"))
                .and_then(|v| v.as_str())
            {
                Some("string") => ColumnType::String,
                Some("number") => ColumnType::Float(FloatType::Float64),
                Some("integer") => ColumnType::Int(IntType::Int64),
                Some("boolean") => ColumnType::Boolean,
                // no recursion here, query param does not support nested arrays
                Some("array") => {
                    let inner_type = match type_object
                        .unwrap()
                        .get("items")
                        .and_then(|v| v.as_object())
                        .and_then(|m| m.get("type"))
                        .and_then(|v| v.as_str())
                    {
                        Some("number") => ColumnType::Float(FloatType::Float64),
                        Some("integer") => ColumnType::Int(IntType::Int64),
                        Some("boolean") => ColumnType::Boolean,
                        _ => ColumnType::String,
                    };
                    ColumnType::Array {
                        element_type: Box::new(inner_type),
                        element_nullable: false,
                    }
                }

                unexpected => {
                    debug!("unexpected type {:?} for field {k}", unexpected);
                    ColumnType::String
                }
            };

            ConsumptionQueryParam {
                name: k.to_string(),
                data_type,
                required: required_keys
                    .is_some_and(|arr| arr.iter().any(|v| v.as_str() == Some(k))),
            }
        })
        .collect();
    Ok(converted)
}

pub fn extract_schema(json_schema: &Map<String, Value>) -> Result<&Value, ExportCollectorError> {
    let schemas = json_schema
        .get("schemas")
        .and_then(|o| o.as_array())
        .ok_or_else(|| ExportCollectorError::Other {
            message: "Unexpected schema shape.".to_string(),
        })?;

    let schema = if schemas.len() == 1 {
        schemas.iter().next().unwrap()
    } else {
        return Err(ExportCollectorError::Other {
            message: format!("Unexpected number of schemas: {}", schemas.len()),
        });
    };

    let schema_deref = if let Some(Value::String(s)) = schema.get("$ref") {
        let components_schemas = json_schema
            .get("components")
            .and_then(|o| o.as_object())
            .and_then(|m| m.get("schemas"))
            .and_then(|o| o.as_object())
            .ok_or_else(|| ExportCollectorError::Other {
                message: "Unexpected schema shape.".to_string(),
            })?;
        components_schemas
            .get(s.strip_prefix("#/components/schemas/").unwrap_or(s))
            .ok_or_else(|| ExportCollectorError::Other {
                message: format!("Schema {s} not found."),
            })?
    } else {
        schema
    };
    Ok(schema_deref)
}

pub fn extract_intput_param(
    map: &Map<String, Value>,
) -> Result<Vec<ConsumptionQueryParam>, ExportCollectorError> {
    let input_schema = map
        .get("inputSchema")
        .and_then(|o| o.as_object())
        .ok_or_else(|| ExportCollectorError::Other {
            message: "inputSchema field should be an object.".to_string(),
        })?;

    schema_to_params_list(extract_schema(input_schema)?)
}
