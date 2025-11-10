use crate::cli::display::{Message, MessageType};
use crate::cli::routines::RoutineFailure;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::framework::languages::SupportedLanguages;
use crate::framework::python::generate::{
    map_to_python_class_name, map_to_python_snake_identifier,
};
use crate::framework::typescript::generate::sanitize_typescript_identifier;
use crate::infrastructure::stream::kafka::client::fetch_topics;
use crate::project::Project;
use globset::{Glob, GlobMatcher};
use log::{info, warn};
use schema_registry_client::rest::apis::Error as SchemaRegistryError;
use schema_registry_client::rest::schema_registry_client::{
    Client as SrClientTrait, SchemaRegistryClient,
};
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::str::FromStr;

fn build_matcher(s: &str) -> Result<GlobMatcher, RoutineFailure> {
    let matcher = Glob::new(s)
        .map_err(|e| {
            RoutineFailure::new(
                Message::new("Kafka".to_string(), format!("invalid glob pattern: {s}")),
                e,
            )
        })?
        .compile_matcher();
    Ok(matcher)
}

pub async fn write_external_topics(
    project: &Project,
    bootstrap: &str,
    path: &str,
    include: &str,
    exclude: &str,
    schema_registry: &Option<String>,
) -> Result<(), RoutineFailure> {
    info!(
        "Fetching topics from {} with include='{}' exclude='{:?}'",
        bootstrap, include, exclude
    );

    let mut kafka_cfg = project.redpanda_config.clone();
    kafka_cfg.broker = bootstrap.to_string();
    let inc = build_matcher(include)?;
    let exc = build_matcher(exclude)?;

    let topics = fetch_topics(&kafka_cfg).await.map_err(|e| {
        RoutineFailure::new(
            Message::new("Kafka".to_string(), "failed to fetch topics".to_string()),
            e,
        )
    })?;

    let mut names: Vec<String> = topics
        .into_iter()
        .map(|t| t.name)
        .filter(|n| inc.is_match(n) && !exc.is_match(n))
        .collect();

    // Don't resolve credentials - only checking which topics are managed
    let infra_map = InfrastructureMap::load_from_user_code(project, false)
        .await
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Kafka".to_string(),
                format!("Failed to load InfrastructureMap: {e:?}"),
            ))
        })?;

    // Remove topics that are known to Moose and NOT ExternallyManaged
    let managed_by_moose: std::collections::HashSet<String> = infra_map
        .topics
        .values()
        .filter(|t| t.life_cycle != LifeCycle::ExternallyManaged)
        .map(|t| t.name.clone())
        .collect();
    names.retain(|n| !managed_by_moose.contains(n));
    names.sort();

    fs::create_dir_all(path).map_err(|e| {
        RoutineFailure::new(
            Message::new("Kafka".to_string(), format!("creating directory {path}")),
            e,
        )
    })?;

    // Build type maps by fetching schemas first (if configured)
    let mut type_map: std::collections::HashMap<String, (String, String)> = Default::default();
    // Accumulate schemas to generate single-file outputs
    let mut schema_items: Vec<(String, String)> = Vec::new(); // (type_name, schema_json)
    if let Some(sr_url) = schema_registry {
        let config = schema_registry_client::rest::client_config::ClientConfig {
            base_urls: vec![sr_url.to_string()],
            ..Default::default()
        };
        let sr_client = SchemaRegistryClient::new(config);
        for topic in &names {
            let subject = format!("{}-value", topic);
            match fetch_latest_json_schema(&sr_client, &subject).await {
                Ok(Some(schema_json)) => {
                    let schema_title = Value::from_str(&schema_json).ok().and_then(|j| {
                        j.get("title")
                            .and_then(|t| t.as_str().map(|s| s.to_string()))
                    });
                    match project.language {
                        SupportedLanguages::Typescript => {
                            let type_name = schema_title
                                .as_deref()
                                .map(sanitize_typescript_identifier)
                                .unwrap_or_else(|| sanitize_typescript_identifier(topic));
                            schema_items.push((type_name.clone(), schema_json));
                            type_map
                                .insert(topic.clone(), (type_name, "externalTypes".to_string()));
                        }
                        SupportedLanguages::Python => {
                            let class_name = schema_title
                                .as_deref()
                                .map(map_to_python_class_name)
                                .unwrap_or_else(|| map_to_python_class_name(topic));
                            schema_items.push((class_name.clone(), schema_json));
                            type_map
                                .insert(topic.clone(), (class_name, "external_models".to_string()));
                        }
                    }
                }
                Ok(None) => {
                    info!("No JSON schema found for subject {}", subject);
                }
                Err(e) => {
                    warn!("Failed to fetch schema for {}: {:?}", subject, e);
                }
            }
        }
        // After collecting all schemas, write single-file outputs per language
        match project.language {
            SupportedLanguages::Typescript => {
                if !schema_items.is_empty() {
                    let out = Path::new(path).join("externalTypes.ts");
                    if let Err(e) = generate_typescript_bundle(&schema_items, &out) {
                        warn!("Failed to generate bundled TS types: {:?}", e);
                    }
                }
            }
            SupportedLanguages::Python => {
                // Ensure package for relative imports
                let init_py = Path::new(path).join("__init__.py");
                if !init_py.exists() {
                    let _ = fs::write(&init_py, b"");
                }
                if !schema_items.is_empty() {
                    let out = Path::new(path).join("external_models.py");
                    if let Err(e) = generate_python_bundle(&schema_items, &out) {
                        warn!("Failed to generate bundled Python models: {:?}", e);
                    }
                }
            }
        }
    }

    // Now write stream declarations with imports referencing generated types where available
    match project.language {
        SupportedLanguages::Typescript => {
            let file_path = Path::new(path).join("externalTopics.ts");
            let contents = render_typescript_streams(&names, &type_map);
            fs::write(&file_path, contents.as_bytes()).map_err(|e| {
                RoutineFailure::new(
                    Message::new(
                        "Kafka".to_string(),
                        format!("writing {}", file_path.display()),
                    ),
                    e,
                )
            })?;
            crate::cli::display::show_message_wrapper(
                MessageType::Success,
                Message::new(
                    "Kafka".to_string(),
                    format!("wrote {} streams to {}", names.len(), file_path.display()),
                ),
            );
        }
        SupportedLanguages::Python => {
            let file_path = Path::new(path).join("external_topics.py");
            let contents = render_python_streams(&names, &type_map);
            fs::write(&file_path, contents.as_bytes()).map_err(|e| {
                RoutineFailure::new(
                    Message::new(
                        "Kafka".to_string(),
                        format!("writing {}", file_path.display()),
                    ),
                    e,
                )
            })?;
            crate::cli::display::show_message_wrapper(
                MessageType::Success,
                Message::new(
                    "Kafka".to_string(),
                    format!("wrote {} streams to {}", names.len(), file_path.display()),
                ),
            );
        }
    }

    Ok(())
}

fn render_typescript_streams(
    topics: &[String],
    type_map: &std::collections::HashMap<String, (String, String)>,
) -> String {
    let mut out = String::new();
    out.push_str("// AUTO-GENERATED FILE. DO NOT EDIT.\n");
    out.push_str("// This file will be replaced when you run `moose kafka pull`.\n\n");
    out.push_str("import { Stream, LifeCycle } from \"@514labs/moose-lib\";\n");
    for (_topic, (type_name, file_stem)) in type_map.iter() {
        out.push_str(&format!(
            "import type {{ {type_name} }} from \"./{file_stem}\";\n"
        ));
    }
    out.push('\n');

    for t in topics {
        let var_name = format!("{}Stream", sanitize_typescript_identifier(t));
        if let Some((type_name, _)) = type_map.get(t) {
            // Include schema registry config (Latest subject) for topics with discovered JSON schema
            let subject = format!("{}-value", t);
            out.push_str(&format!(
                "export const {var_name} = new Stream<{type_name}>(\"{t}\", {{\n"
            ));
            out.push_str("    lifeCycle: LifeCycle.EXTERNALLY_MANAGED,\n");
            out.push_str(&format!(
                "    schemaConfig: {{ kind: \"JSON\", reference: {{ subjectLatest: \"{subject}\" }} }}\n"
            ));
            out.push_str("});\n");
        } else {
            out.push_str(&format!(
                "export const {var_name} = new Stream<{{}}>(\"{t}\", {{ lifeCycle: LifeCycle.EXTERNALLY_MANAGED }});\n"
            ));
        }
    }
    out
}

fn render_python_streams(
    topics: &[String],
    type_map: &std::collections::HashMap<String, (String, String)>,
) -> String {
    let mut out = String::new();
    out.push_str("# AUTO-GENERATED FILE. DO NOT EDIT.\n");
    out.push_str("# This file will be replaced when you run `moose kafka pull`.\n\n");
    out.push_str(
        "from moose_lib import Stream, StreamConfig, LifeCycle, KafkaSchemaConfig, SubjectLatest\n",
    );
    let needs_empty = topics.iter().any(|t| !type_map.contains_key(t));
    if needs_empty {
        out.push_str("from pydantic import BaseModel\n");
    }
    for (_topic, (class_name, module_stem)) in type_map.iter() {
        out.push_str(&format!("from .{module_stem} import {class_name}\n"));
    }
    out.push('\n');
    if needs_empty {
        out.push_str("class EmptyModel(BaseModel):\n");
        out.push_str("    pass\n\n");
    }

    for t in topics {
        let var_name = format!("{}_stream", map_to_python_snake_identifier(t));
        if let Some((class_name, _)) = type_map.get(t) {
            // Include schema registry config (Latest subject) for topics with discovered JSON schema
            let subject = format!("{}-value", t);
            out.push_str(&format!(
                "{var_name} = Stream[{class_name}](\"{t}\", StreamConfig(\n"
            ));
            out.push_str("    life_cycle=LifeCycle.EXTERNALLY_MANAGED,\n");
            out.push_str(&format!("    schema_config=KafkaSchemaConfig(kind=\"JSON\", reference=SubjectLatest(name=\"{subject}\"))))\n"));
        } else {
            out.push_str(&format!("{var_name} = Stream[EmptyModel](\"{t}\", StreamConfig(life_cycle=LifeCycle.EXTERNALLY_MANAGED))\n"));
        }
    }
    out
}

/// Returns None if the subject does not exist or schema type is not JSON.
async fn fetch_latest_json_schema(
    client: &SchemaRegistryClient,
    subject: &str,
) -> Result<Option<String>, RoutineFailure> {
    let meta = client.get_latest_version(subject, None).await;
    let meta = match meta {
        Ok(rs) => rs,
        Err(SchemaRegistryError::ResponseError(r)) if r.status == 404 => return Ok(None),
        Err(e) => {
            return Err(RoutineFailure::new(
                Message::new("Schema Registry".to_string(), "request failed".to_string()),
                e,
            ))
        }
    };
    if meta.schema_type.is_none_or(|t| t != "JSON") {
        return Ok(None);
    }
    Ok(meta.schema)
}

fn generate_typescript_bundle(
    schema_items: &[(String, String)],
    out_path: &Path,
) -> Result<(), anyhow::Error> {
    use std::io::Write;
    let mut combined = String::new();
    for (type_name, schema_json) in schema_items {
        let mut child = std::process::Command::new("npx")
            .arg("--yes")
            .arg("json-schema-to-typescript")
            .arg("--stdin")
            .arg("--no-banner")
            .arg("--name")
            .arg(type_name)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(schema_json.as_bytes())?;
        }
        let output = child.wait_with_output()?;
        if !output.status.success() {
            anyhow::bail!(
                "json-schema-to-typescript failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        combined.push_str(&String::from_utf8_lossy(&output.stdout));
        if !combined.ends_with('\n') {
            combined.push('\n');
        }
    }
    fs::write(out_path, combined.as_bytes()).map_err(|e| e.into())
}

fn generate_python_bundle(
    schema_items: &[(String, String)],
    out_path: &Path,
) -> Result<(), anyhow::Error> {
    use std::io::Write;
    let mut combined = String::new();
    for (class_name, schema_json) in schema_items {
        // Write schema to a temp file because some versions of datamodel-codegen do not support '-' stdin
        let mut tmp_schema = tempfile::NamedTempFile::new()?;
        tmp_schema.write_all(schema_json.as_bytes())?;
        tmp_schema.flush()?;
        let tmp_schema_path = tmp_schema.into_temp_path();

        // Create a temp output file to capture generated code
        let tmp_out = tempfile::NamedTempFile::new()?;
        let tmp_out_path = tmp_out.path().to_path_buf();
        drop(tmp_out); // Allow the tool to write to this path

        let mut cmd = std::process::Command::new("datamodel-codegen");
        cmd.arg("--input")
            .arg(&tmp_schema_path)
            .arg("--output")
            .arg(&tmp_out_path)
            .arg("--input-file-type")
            .arg("jsonschema")
            .arg("--class-name")
            .arg(class_name)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                crate::cli::display::show_message_wrapper(
                    MessageType::Highlight,
                    Message::new(
                        "Python".to_string(),
                        "datamodel-code-generator not found. Install with: pip install datamodel-code-generator".to_string(),
                    ),
                );
                return Ok(());
            }
            Err(e) => return Err(e.into()),
        };
        let output = child.wait_with_output()?;
        if !output.status.success() {
            anyhow::bail!(
                "datamodel-codegen failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        let code = fs::read_to_string(&tmp_out_path)?;
        combined.push_str(&code);
        if !combined.ends_with('\n') {
            combined.push('\n');
        }
        // Best-effort cleanup; ignore errors
        let _ = std::fs::remove_file(&tmp_out_path);
    }
    fs::write(out_path, combined.as_bytes()).map_err(|e| e.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ts_sanitize_with_dots_and_hyphens() {
        assert_eq!(
            sanitize_typescript_identifier("orders.events-v1"),
            "OrdersEventsV1"
        );
        assert_eq!(sanitize_typescript_identifier("foo-bar.baz"), "FooBarBaz");
    }

    #[test]
    fn test_py_sanitize_with_dots_and_hyphens() {
        assert_eq!(
            map_to_python_snake_identifier("orders.events-v1"),
            "orders_events_v_1"
        );
        assert_eq!(map_to_python_snake_identifier("foo-bar.baz"), "foo_bar_baz");
    }

    #[test]
    fn test_ts_sanitize_leading_digit() {
        assert_eq!(
            sanitize_typescript_identifier("1-topic.name"),
            "_1TopicName"
        );
    }

    #[test]
    fn test_py_sanitize_leading_digit() {
        assert_eq!(
            map_to_python_snake_identifier("1-topic.name"),
            "_1_topic_name"
        );
    }
}
