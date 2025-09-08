use crate::framework::consumption::model::ConsumptionQueryParam;
use crate::framework::core::infrastructure::api_endpoint::{APIType, ApiEndpoint};
use crate::framework::core::infrastructure::table::ColumnType;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::project::Project;
use crate::utilities::constants::OPENAPI_FILE;

use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use serde_yaml;
use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Serialize, Deserialize)]
struct OpenAPI {
    openapi: String,
    info: Info,
    servers: Vec<Server>,
    paths: HashMap<String, PathItem>,
    components: Components,
}

#[derive(Serialize, Deserialize)]
struct Info {
    title: String,
    version: String,
}

#[derive(Serialize, Deserialize)]
struct Server {
    url: String,
    description: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Parameter {
    name: String,
    #[serde(rename = "in")]
    in_: String,
    required: bool,
    schema: ParameterSchema,
    example: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize)]
struct ParameterSchema {
    #[serde(rename = "type")]
    schema_type: String,
}

#[derive(Serialize, Deserialize)]
struct PathItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    post: Option<Operation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    get: Option<Operation>,
}

#[derive(Serialize, Deserialize)]
struct Operation {
    summary: String,
    parameters: Vec<Parameter>,
    #[serde(rename = "requestBody", skip_serializing_if = "Option::is_none")]
    request_body: Option<RequestBody>,
    responses: HashMap<String, Response>,
}

#[derive(Serialize, Deserialize)]
struct RequestBody {
    required: bool,
    content: HashMap<String, Value>,
}

#[derive(Serialize, Deserialize)]
struct Response {
    description: String,
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    content: HashMap<String, Value>,
}

#[derive(Serialize, Deserialize)]
struct Components {
    schemas: HashMap<String, Value>,
}

#[derive(Debug, thiserror::Error)]
pub enum OpenAPIError {
    #[error("Failed to save OpenAPI spec to file: {0}")]
    Save(String),
}

pub async fn openapi(
    project: &Arc<Project>,
    infra_map: &InfrastructureMap,
) -> Result<PathBuf, OpenAPIError> {
    let openapi_spec = generate_openapi_spec(project, infra_map);
    let openapi_file = project.internal_dir().unwrap().join(OPENAPI_FILE);
    save_openapi_to_file(&openapi_spec, &openapi_file.to_string_lossy())
        .map_err(|e| OpenAPIError::Save(e.to_string()))?;

    Ok(openapi_file)
}

fn generate_openapi_spec(project: &Arc<Project>, infra_map: &InfrastructureMap) -> OpenAPI {
    let mut paths = HashMap::new();
    let mut schemas = HashMap::new();
    //
    // for api_endpoint in infra_map.api_endpoints.values() {
    //     if let APIType::INGRESS {
    //         data_model: Some(data_model),
    //         schema,
    //         ..
    //     } = &api_endpoint.api_type
    //     {
    //         schemas.insert(data_model.name.clone(), Value::Object(schema.clone()));
    //     }
    // }

    for api_endpoint in infra_map.api_endpoints.values() {
        match &api_endpoint.api_type {
            APIType::INGRESS { schema, .. } => {
                let (schema, component_schemas) =
                    extract_component_schemas(Value::Object(schema.clone()));
                schemas.extend(component_schemas);
                let path_item = create_ingress_path_item(api_endpoint, schema);
                paths.insert(
                    format!("/{}", api_endpoint.path.to_string_lossy()),
                    path_item,
                );
            }

            APIType::EGRESS {
                query_params,
                output_schema,
            } => {
                let (path_item, component_schemas) =
                    create_egress_path_item(api_endpoint, output_schema.clone(), query_params);
                paths.insert(
                    format!("/api/{}", api_endpoint.path.to_string_lossy()),
                    path_item,
                );
                // Merge egress schemas into the main schemas map
                schemas.extend(component_schemas);
            }
        }
    }

    OpenAPI {
        openapi: "3.1.1".to_string(),
        info: Info {
            title: format!("{} API", project.name()),
            version: project.cur_version().to_string(),
        },
        servers: vec![Server {
            url: project.http_server_config.url(),
            description: Some("Server URL".to_string()),
        }],
        paths,
        components: Components { schemas },
    }
}

fn create_ingress_path_item(api_endpoint: &ApiEndpoint, schema: Value) -> PathItem {
    PathItem {
        post: Some(Operation {
            summary: format!("Ingress endpoint for {}", api_endpoint.name),
            parameters: vec![],
            request_body: Some(RequestBody {
                required: true,
                content: {
                    let mut content = HashMap::new();
                    content.insert("application/json".to_string(), json!({"schema": schema}));
                    content
                },
            }),
            responses: create_default_responses(),
        }),
        get: None,
    }
}

fn create_egress_path_item(
    api_endpoint: &ApiEndpoint,
    output_schema: Value,
    query_params: &[ConsumptionQueryParam],
) -> (PathItem, HashMap<String, Value>) {
    let default_schema = json!({"type": "object"});
    let (response_schema, component_schemas) = if output_schema != Value::Null {
        extract_component_schemas(output_schema)
    } else {
        (default_schema, HashMap::new())
    };

    let path_item = PathItem {
        post: None,
        get: Some(Operation {
            summary: format!("Egress endpoint for {}", api_endpoint.name),
            parameters: query_params
                .iter()
                .map(|param| {
                    let (schema_type, example) = map_query_param_type(&param.data_type);
                    Parameter {
                        name: param.name.clone(),
                        in_: "query".to_string(),
                        required: param.required,
                        schema: ParameterSchema { schema_type },
                        example,
                    }
                })
                .collect(),
            request_body: None,
            responses: HashMap::from([(
                "200".to_string(),
                Response {
                    description: "Successful operation".to_string(),
                    content: HashMap::from([(
                        "application/json".to_string(),
                        json!({ "schema": response_schema }),
                    )]),
                },
            )]),
        }),
    };

    (path_item, component_schemas)
}

fn extract_component_schemas(schema: Value) -> (Value, HashMap<String, Value>) {
    let mut component_schemas = HashMap::new();

    // Handle typia-style schema
    if let Some(components) = schema.get("components").and_then(|c| c.get("schemas")) {
        if let Some(obj) = components.as_object() {
            // Copy all schemas directly to top level component schemas
            for (name, schema_def) in obj {
                component_schemas.insert(name.clone(), schema_def.clone());
            }
        }

        // Reference the schema in the response
        if let Some(schemas) = schema.get("schemas").and_then(|s| s.as_array()) {
            if let Some(first_schema) = schemas.first() {
                return (first_schema.clone(), component_schemas);
            }
        }
    }

    // Handle pydantic-style schema
    if let Some(defs) = schema.get("$defs") {
        if let Some(obj) = defs.as_object() {
            // Copy all schemas directly to top level component schemas
            for (name, schema_def) in obj {
                component_schemas.insert(name.clone(), schema_def.clone());
            }
        }

        // Reference the schema in the response
        let mut response_schema = schema.clone();
        response_schema
            .as_object_mut()
            .and_then(|obj| obj.remove("$defs"));
        return (response_schema, component_schemas);
    }

    (schema, component_schemas)
}

fn create_default_responses() -> HashMap<String, Response> {
    let mut responses = HashMap::new();
    responses.insert(
        "200".to_string(),
        Response {
            description: "Successful operation".to_string(),
            content: HashMap::new(),
        },
    );
    responses
}

fn map_query_param_type(data_type: &ColumnType) -> (String, Option<serde_json::Value>) {
    match data_type {
        ColumnType::Boolean => ("boolean".to_string(), Some(serde_json::Value::Bool(true))),
        ColumnType::Int(_) | ColumnType::BigInt => (
            "integer".to_string(),
            Some(serde_json::Value::Number(1.into())),
        ),
        ColumnType::Float(_) | ColumnType::Decimal { .. } => (
            "number".to_string(),
            Some(serde_json::Value::Number(
                serde_json::Number::from_f64(1.0).unwrap(),
            )),
        ),
        ColumnType::DateTime { .. } => (
            "string".to_string(),
            Some(serde_json::Value::String(Local::now().to_rfc3339())),
        ),
        _ => (
            "string".to_string(),
            Some(serde_json::Value::String("stringValue".to_string())),
        ),
    }
}

fn save_openapi_to_file(openapi_spec: &OpenAPI, file_path: &str) -> std::io::Result<()> {
    let openapi_yaml = serde_yaml::to_string(openapi_spec).unwrap();
    let mut file = File::create(file_path)?;
    if openapi_spec.openapi.starts_with("3.1") {
        file.write_all("# Use https://editor-next.swagger.io/ if the current version does not support 3.1 yet.\n".as_bytes())?;
    }
    file.write_all(openapi_yaml.as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_extract_component_schemas_with_enums() {
        // Test the exact enum pattern mentioned in the issue
        let test_schema = json!({
            "components": {
                "schemas": {
                    "FooStatus": {
                        "oneOf": [
                            {"const": "active"},
                            {"const": "inactive"},
                            {"const": "pending"},
                            {"const": "archived"}
                        ]
                    },
                    "ComplexEnum": {
                        "anyOf": [
                            {"type": "string", "enum": ["foo", "bar"]},
                            {"type": "integer", "enum": [1, 2, 3]}
                        ]
                    },
                    "NestedSchema": {
                        "type": "object",
                        "properties": {
                            "status": {
                                "$ref": "#/components/schemas/FooStatus"
                            },
                            "metadata": {
                                "oneOf": [
                                    {"type": "null"},
                                    {
                                        "type": "object",
                                        "properties": {
                                            "created": {"type": "string", "format": "date-time"}
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }
            },
            "schemas": [
                {"$ref": "#/components/schemas/NestedSchema"}
            ]
        });

        // This should NOT panic (unlike the old implementation)
        let (response_schema, component_schemas) = extract_component_schemas(test_schema);

        // Verify that all schemas were extracted correctly
        assert_eq!(component_schemas.len(), 3);
        assert!(component_schemas.contains_key("FooStatus"));
        assert!(component_schemas.contains_key("ComplexEnum"));
        assert!(component_schemas.contains_key("NestedSchema"));

        // Verify that the enum schema was preserved exactly
        let foo_status = &component_schemas["FooStatus"];
        assert_eq!(foo_status["oneOf"][0]["const"], "active");
        assert_eq!(foo_status["oneOf"][1]["const"], "inactive");
        assert_eq!(foo_status["oneOf"][2]["const"], "pending");
        assert_eq!(foo_status["oneOf"][3]["const"], "archived");

        // Verify complex enum with anyOf
        let complex_enum = &component_schemas["ComplexEnum"];
        assert!(complex_enum["anyOf"].is_array());
        assert_eq!(complex_enum["anyOf"][0]["type"], "string");
        assert_eq!(complex_enum["anyOf"][1]["type"], "integer");

        // Verify response schema references the right schema
        assert_eq!(response_schema["$ref"], "#/components/schemas/NestedSchema");
    }

    #[test]
    fn test_extract_component_schemas_with_pydantic_style() {
        let test_schema = json!({
            "$defs": {
                "StatusEnum": {
                    "enum": ["active", "inactive"],
                    "type": "string"
                },
                "UserModel": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "integer"},
                        "status": {"$ref": "#/$defs/StatusEnum"}
                    }
                }
            },
            "type": "object",
            "properties": {
                "users": {
                    "type": "array",
                    "items": {"$ref": "#/$defs/UserModel"}
                }
            }
        });

        let (response_schema, component_schemas) = extract_component_schemas(test_schema);

        // Verify schemas were moved to components
        assert_eq!(component_schemas.len(), 2);
        assert!(component_schemas.contains_key("StatusEnum"));
        assert!(component_schemas.contains_key("UserModel"));

        // Verify $defs was removed from response schema
        assert!(response_schema.get("$defs").is_none());
        assert!(response_schema["properties"]["users"]["items"]["$ref"]
            .as_str()
            .unwrap()
            .contains("UserModel"));
    }
}
