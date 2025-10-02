use crate::cli::display::{Message, MessageType};
use crate::cli::routines::RoutineFailure;
use crate::framework::languages::SupportedLanguages;
use crate::infrastructure::stream::kafka::client::fetch_topics;
use crate::project::Project;
use convert_case::{Case, Casing};
use globset::Glob;
use log::{info, warn};
use schema_registry_client::rest::apis::Error as SchemaRegistryError;
use schema_registry_client::rest::schema_registry_client::{
    Client as SrClientTrait, SchemaRegistryClient,
};
use std::fs;
use std::io::Write;
use std::path::Path;

fn build_matchers(
    include: &str,
    exclude: &Option<String>,
) -> Result<(globset::GlobMatcher, Option<globset::GlobMatcher>), RoutineFailure> {
    let inc = Glob::new(include).map_err(|e| {
        RoutineFailure::new(
            Message::new("Kafka".to_string(), format!("invalid include glob: {e}")),
            e,
        )
    })?;
    let inc_matcher = inc.compile_matcher();

    let exc_matcher = match exclude {
        Some(pat) => match Glob::new(pat) {
            Ok(g) => Some(g.compile_matcher()),
            Err(e) => {
                warn!("Ignoring invalid exclude glob '{}': {:?}", pat, e);
                None
            }
        },
        None => None,
    };
    Ok((inc_matcher, exc_matcher))
}

pub async fn write_external_topics(
    project: &Project,
    bootstrap: &str,
    path: &str,
    include: &str,
    exclude: Option<String>,
    schema_registry: &Option<String>,
) -> Result<(), RoutineFailure> {
    info!(
        "Fetching topics from {} with include='{}' exclude='{:?}'",
        bootstrap, include, exclude
    );

    let mut kafka_cfg = project.redpanda_config.clone();
    kafka_cfg.broker = bootstrap.to_string();

    let (inc, exc) = build_matchers(include, &exclude)?;

    let topics = fetch_topics(&kafka_cfg).await.map_err(|e| {
        RoutineFailure::new(
            Message::new("Kafka".to_string(), "failed to fetch topics".to_string()),
            e,
        )
    })?;

    let mut names: Vec<String> = topics
        .into_iter()
        .map(|t| t.name)
        .filter(|n| inc.is_match(n) && exc.as_ref().map(|m| !m.is_match(n)).unwrap_or(true))
        .collect();
    names.sort();

    fs::create_dir_all(path).map_err(|e| {
        RoutineFailure::new(
            Message::new("Kafka".to_string(), format!("creating directory {path}")),
            e,
        )
    })?;

    // Build type maps by fetching schemas first (if configured)
    let mut ts_type_map: std::collections::HashMap<String, (String, String)> = Default::default();
    let mut py_type_map: std::collections::HashMap<String, (String, String)> = Default::default();
    if let Some(sr_url) = schema_registry {
        let config = schema_registry_client::rest::client_config::ClientConfig {
            base_urls: vec![sr_url.to_string()],
            ..Default::default()
        };
        let sr_client = SchemaRegistryClient::new(config);
        for topic in &names {
            let subject = format!("{}-value", topic);
            match fetch_latest_json_schema(&sr_client, &subject).await {
                Ok(Some(schema_json)) => match project.language {
                    SupportedLanguages::Typescript => {
                        let type_name = sanitize_ts_ident(topic);
                        let file_stem = type_name.clone();
                        let out = Path::new(path).join(format!("{file_stem}.ts"));
                        if let Err(e) =
                            generate_typescript_from_schema_named(&schema_json, &out, &type_name)
                        {
                            warn!("Failed to generate TS for {}: {:?}", subject, e);
                        } else {
                            ts_type_map.insert(topic.clone(), (type_name, file_stem));
                        }
                    }
                    SupportedLanguages::Python => {
                        // Ensure package for relative imports
                        let init_py = Path::new(path).join("__init__.py");
                        if !init_py.exists() {
                            let _ = fs::write(&init_py, b"");
                        }
                        let class_name = sanitize_ts_ident(topic); // PascalCase class name
                        let module_stem = sanitize_py_ident(topic);
                        let out = Path::new(path).join(format!("{module_stem}.py"));
                        if let Err(e) =
                            generate_python_from_schema_named(&schema_json, &out, &class_name)
                        {
                            warn!("Failed to generate Python for {}: {:?}", subject, e);
                        } else {
                            py_type_map.insert(topic.clone(), (class_name, module_stem));
                        }
                    }
                },
                Ok(None) => {
                    println!("No such schema found for {}", topic);
                    // No JSON schema for this subject
                }
                Err(e) => {
                    println!("Failed to fetch schema for {}: {:?}", subject, e);
                    warn!("Failed to fetch schema for {}: {:?}", subject, e);
                }
            }
        }
    }

    // Now write stream declarations with imports referencing generated types where available
    match project.language {
        SupportedLanguages::Typescript => {
            let file_path = Path::new(path).join("externalTopics.ts");
            let contents = render_typescript_streams(&names, &ts_type_map);
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
            let contents = render_python_streams(&names, &py_type_map);
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

fn sanitize_ts_ident(topic: &str) -> String {
    let mut ident = topic.to_case(Case::Pascal);
    if ident.is_empty() || !ident.chars().next().unwrap().is_ascii_alphabetic() {
        ident.insert(0, '_');
    }
    ident
}

fn sanitize_py_ident(topic: &str) -> String {
    let mut ident = topic.to_case(Case::Snake);
    if ident.is_empty() || !ident.chars().next().unwrap().is_ascii_alphabetic() {
        ident.insert(0, '_');
    }
    ident
}

fn render_typescript_streams(
    topics: &[String],
    type_map: &std::collections::HashMap<String, (String, String)>,
) -> String {
    let mut out = String::new();
    out.push_str("// AUTO-GENERATED FILE. DO NOT EDIT.\n");
    out.push_str("// This file will be replaced when you run `moose kafka pull`.\n\n");
    out.push_str("import { Stream } from \"@514labs/moose-lib\";\n");
    for (_topic, (type_name, file_stem)) in type_map.iter() {
        out.push_str(&format!(
            "import type {{ {type_name} }} from \"./{file_stem}\";\n"
        ));
    }
    out.push_str("\n");

    for t in topics {
        let var_name = sanitize_ts_ident(t);
        if let Some((type_name, _)) = type_map.get(t) {
            out.push_str(&format!(
                "export const {var_name} = new Stream<{type_name}>(\"{t}\");\n"
            ));
        } else {
            out.push_str(&format!(
                "export const {var_name} = new Stream<{{}}>(\"{t}\");\n"
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
    out.push_str("from moose_lib import Stream\n");
    for (_topic, (class_name, module_stem)) in type_map.iter() {
        out.push_str(&format!("from .{module_stem} import {class_name}\n"));
    }
    out.push_str("\n");

    for t in topics {
        let var_name = sanitize_py_ident(t);
        if let Some((class_name, _)) = type_map.get(t) {
            out.push_str(&format!("{var_name} = Stream[{class_name}](\"{t}\")\n"));
        } else {
            out.push_str(&format!("{var_name} = Stream(\"{t}\")\n"));
        }
    }
    out
}

/// returns None if the
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
    if !meta.schema_type.is_some_and(|t| t == "JSON") {
        return Ok(None);
    }
    Ok(meta.schema)
}

fn generate_typescript_from_schema_named(
    schema_json: &str,
    out_path: &Path,
    type_name: &str,
) -> Result<(), anyhow::Error> {
    let mut child = std::process::Command::new("npx")
        .arg("--yes")
        .arg("json-schema-to-typescript")
        .arg("--stdin")
        .arg("--no-banner")
        .arg("--name")
        .arg(type_name)
        .arg("-o")
        .arg(out_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(schema_json.as_bytes())?;
    }
    let output = child.wait_with_output()?;
    println!("stdout {}", String::from_utf8_lossy(&output.stdout));
    println!("stderr {}", String::from_utf8_lossy(&output.stderr));

    if !output.status.success() {
        anyhow::bail!("json-schema-to-typescript failed");
    }
    Ok(())
}

fn generate_python_from_schema_named(
    schema_json: &str,
    out_path: &Path,
    class_name: &str,
) -> Result<(), anyhow::Error> {
    use std::io::Write;
    // Write schema to a temp file because some versions of datamodel-codegen do not support '-' stdin
    let mut tmp = tempfile::NamedTempFile::new()?;
    tmp.write_all(schema_json.as_bytes())?;
    tmp.flush()?;
    let tmp_path = tmp.into_temp_path();

    let mut cmd = std::process::Command::new("datamodel-codegen");
    cmd.arg("--input")
        .arg(tmp_path.to_path_buf())
        .arg("--output")
        .arg(out_path)
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
    println!("stdout {}", String::from_utf8_lossy(&output.stdout));
    println!("stderr {}", String::from_utf8_lossy(&output.stderr));

    if !output.status.success() {
        anyhow::bail!(
            "datamodel-codegen failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(())
}
