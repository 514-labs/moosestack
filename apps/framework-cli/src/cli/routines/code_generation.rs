use crate::cli::display::{Message, MessageType};
use crate::cli::prompt_user;
use crate::cli::routines::RoutineFailure;
use crate::framework::core::infrastructure::table::Table;
use crate::framework::core::infrastructure_map::InfrastructureMap;
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::framework::languages::SupportedLanguages;
use crate::framework::python::generate::tables_to_python;
use crate::framework::typescript::generate::tables_to_typescript;
use crate::infrastructure::olap::clickhouse::ConfiguredDBClient;
use crate::infrastructure::olap::OlapOperations;
use crate::project::Project;
use crate::utilities::constants::{
    APP_DIR, PYTHON_EXTERNAL_FILE, PYTHON_MAIN_FILE, TYPESCRIPT_EXTERNAL_FILE, TYPESCRIPT_MAIN_FILE,
};
use crate::utilities::git::create_code_generation_commit;
use log::debug;
use reqwest::Url;
use std::borrow::Cow;
use std::env;
use std::io::Write;
use std::path::Path;

pub fn prompt_user_for_remote_ch_http() -> Result<String, RoutineFailure> {
    let base = prompt_user(
        "Enter ClickHouse host and port",
        None,
        Some("Format: https://your-service-id.region.clickhouse.cloud:8443\n  🔗 Get your URL: https://clickhouse.cloud/\n  📖 Troubleshooting: https://docs.fiveonefour.com/moose/getting-started/from-clickhouse#troubleshooting")
    )?.trim_end_matches('/').trim_start_matches("https://").to_string();
    let user = prompt_user("Enter username", Some("default"), None)?;
    let pass = prompt_user("Enter password", None, None)?;
    let db = prompt_user("Enter database name", Some("default"), None)?;

    let mut url = reqwest::Url::parse(&format!("https://{base}")).map_err(|e| {
        RoutineFailure::new(
            Message::new("Malformed".to_string(), format!("host and port: {base}")),
            e,
        )
    })?;
    url.set_username(&user).map_err(|()| {
        RoutineFailure::error(Message::new("Malformed".to_string(), format!("URL: {url}")))
    })?;

    if !pass.is_empty() {
        url.set_password(Some(&pass)).map_err(|()| {
            RoutineFailure::error(Message::new("Malformed".to_string(), format!("URL: {url}")))
        })?
    }

    url.query_pairs_mut().append_pair("database", &db);
    Ok(url.to_string())
}

fn should_be_externally_managed(table: &Table) -> bool {
    table.columns.iter().any(|c| c.name.starts_with("_peerdb_"))
}

// Shared helpers
pub async fn create_client_and_db(
    remote_url: &str,
) -> Result<(ConfiguredDBClient, String), RoutineFailure> {
    let mut url = Url::parse(remote_url).map_err(|e| {
        RoutineFailure::error(Message::new(
            "Invalid URL".to_string(),
            format!("Failed to parse remote_url '{remote_url}': {e}"),
        ))
    })?;

    if url.scheme() == "clickhouse" {
        debug!("Only HTTP(s) supported. Transforming native protocol connection string.");
        let is_secure = match (url.host_str(), url.port()) {
            (_, Some(9000)) => false,
            (_, Some(9440)) => true,
            (Some(host), _) if host == "localhost" || host == "127.0.0.1" => false,
            _ => true,
        };
        let (new_port, new_scheme) = if is_secure {
            (8443, "https")
        } else {
            (8123, "http")
        };
        url = Url::parse(&remote_url.replacen("clickhouse", new_scheme, 1)).unwrap();
        url.set_port(Some(new_port)).unwrap();

        let path_segments = url.path().split('/').collect::<Vec<&str>>();
        if path_segments.len() == 2 && path_segments[0].is_empty() {
            let database = path_segments[1].to_string();
            url.set_path("");
            url.query_pairs_mut().append_pair("database", &database);
        };

        let display_url = if url.password().is_some() {
            let mut cloned = url.clone();
            cloned.set_password(Some("******")).unwrap();
            Cow::Owned(cloned)
        } else {
            Cow::Borrowed(&url)
        };
        show_message!(
            MessageType::Highlight,
            Message {
                action: "Protocol".to_string(),
                details: format!("native protocol detected. Converting to HTTP(s): {display_url}"),
            }
        );
    }

    let mut client = clickhouse::Client::default().with_url(remote_url);
    let url_username = url.username();
    let url_username = if !url_username.is_empty() {
        url_username.to_string()
    } else {
        match url.query_pairs().find(|(key, _)| key == "user") {
            None => String::new(),
            Some((_, v)) => v.to_string(),
        }
    };
    if !url_username.is_empty() {
        client = client
            .with_user(percent_encoding::percent_decode_str(&url_username).decode_utf8_lossy())
    }
    if let Some(password) = url.password() {
        client = client
            .with_password(percent_encoding::percent_decode_str(password).decode_utf8_lossy());
    }

    let url_db = url
        .query_pairs()
        .filter_map(|(k, v)| {
            if k == "database" {
                Some(v.to_string())
            } else {
                None
            }
        })
        .last();

    let client = ConfiguredDBClient {
        client,
        config: Default::default(),
    };

    let db = match url_db {
        None => client
            .client
            .query("select database()")
            .fetch_one::<String>()
            .await
            .map_err(|e| {
                RoutineFailure::new(
                    Message::new("Failure".to_string(), "fetching database".to_string()),
                    e,
                )
            })?,
        Some(db) => db,
    };

    Ok((client, db))
}

fn write_external_models_file(
    language: SupportedLanguages,
    tables: &[Table],
    file_path: Option<&str>,
) -> Result<(), RoutineFailure> {
    let file = match (language, file_path) {
        (_, Some(path)) => Cow::Borrowed(path),
        (SupportedLanguages::Typescript, None) => {
            Cow::Owned(format!("{APP_DIR}/{TYPESCRIPT_EXTERNAL_FILE}"))
        }
        (SupportedLanguages::Python, None) => {
            Cow::Owned(format!("{APP_DIR}/{PYTHON_EXTERNAL_FILE}"))
        }
    };
    match language {
        SupportedLanguages::Typescript => {
            let table_definitions =
                tables_to_typescript(tables, Some(LifeCycle::ExternallyManaged));
            let header = "// AUTO-GENERATED FILE. DO NOT EDIT.\n// This file will be replaced when you run `moose db pull`.";
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&*file)
                .map_err(|e| {
                    RoutineFailure::new(
                        Message::new("Failure".to_string(), format!("opening {file}")),
                        e,
                    )
                })?;
            writeln!(file, "{}\n\n{}", header, table_definitions).map_err(|e| {
                RoutineFailure::new(
                    Message::new(
                        "Failure".to_string(),
                        "writing externally managed table definitions".to_string(),
                    ),
                    e,
                )
            })?
        }
        SupportedLanguages::Python => {
            let table_definitions = tables_to_python(tables, Some(LifeCycle::ExternallyManaged));
            let header = "# AUTO-GENERATED FILE. DO NOT EDIT.\n# This file will be replaced when you run `moose db pull`.";
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&*file)
                .map_err(|e| {
                    RoutineFailure::new(
                        Message::new("Failure".to_string(), format!("opening {file}")),
                        e,
                    )
                })?;
            writeln!(file, "{}\n\n{}", header, table_definitions).map_err(|e| {
                RoutineFailure::new(
                    Message::new(
                        "Failure".to_string(),
                        "writing externally managed table definitions".to_string(),
                    ),
                    e,
                )
            })?
        }
    }

    Ok(())
}

pub async fn db_to_dmv2(remote_url: &str, dir_path: &Path) -> Result<(), RoutineFailure> {
    let (client, db) = create_client_and_db(remote_url).await?;
    env::set_current_dir(dir_path).map_err(|e| {
        RoutineFailure::new(
            Message::new("Failure".to_string(), "changing directory".to_string()),
            e,
        )
    })?;

    let mut project = crate::cli::load_project()?;

    // Enable only Data Model v2 and OLAP; disable others
    project.features.data_model_v2 = true;
    project.features.olap = true;
    project.features.streaming_engine = false;
    project.features.workflows = false;
    project.features.ddl_plan = false;

    // Persist updated features to moose.config.toml
    project.write_to_disk().map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Failure".to_string(),
                "writing updated project features".to_string(),
            ),
            e,
        )
    })?;
    let (tables, unsupported) = client.list_tables(&db, &project).await.map_err(|e| {
        RoutineFailure::new(
            Message::new("Failure".to_string(), "listing tables".to_string()),
            e,
        )
    })?;

    if !unsupported.is_empty() {
        show_message!(
            MessageType::Highlight,
            Message {
                action: "Table(s)".to_string(),
                details: format!(
                    "with types unsupported: {}",
                    unsupported
                        .iter()
                        .map(|t| t.name.as_str())
                        .collect::<Vec<&str>>()
                        .join(", ")
                ),
            }
        );
    }

    let (externally_managed, managed): (Vec<_>, Vec<_>) =
        tables.into_iter().partition(should_be_externally_managed);

    match project.language {
        SupportedLanguages::Typescript => {
            if !externally_managed.is_empty() {
                let table_definitions =
                    tables_to_typescript(&externally_managed, Some(LifeCycle::ExternallyManaged));
                let header = "// AUTO-GENERATED FILE. DO NOT EDIT.\n// This file will be replaced when you run `moose db pull`.";
                let mut file = std::fs::OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(format!("{APP_DIR}/{TYPESCRIPT_EXTERNAL_FILE}"))
                    .map_err(|e| {
                        RoutineFailure::new(
                            Message::new(
                                "Failure".to_string(),
                                format!("opening {TYPESCRIPT_EXTERNAL_FILE}"),
                            ),
                            e,
                        )
                    })?;
                writeln!(file, "{}\n\n{}", header, table_definitions).map_err(|e| {
                    RoutineFailure::new(
                        Message::new(
                            "Failure".to_string(),
                            "writing externally managed table definitions".to_string(),
                        ),
                        e,
                    )
                })?;
                let main_path = format!("{APP_DIR}/{TYPESCRIPT_MAIN_FILE}");
                let import_stmt = "import \"./externalModels\";";
                let needs_import = match std::fs::read_to_string(&main_path) {
                    Ok(contents) => !contents.contains(import_stmt),
                    Err(_) => true,
                };
                if needs_import {
                    let mut file = std::fs::OpenOptions::new()
                        .append(true)
                        .open(&main_path)
                        .map_err(|e| {
                            RoutineFailure::new(
                                Message::new(
                                    "Failure".to_string(),
                                    format!("opening {TYPESCRIPT_MAIN_FILE}"),
                                ),
                                e,
                            )
                        })?;
                    writeln!(file, "\n{import_stmt}").map_err(|e| {
                        RoutineFailure::new(
                            Message::new(
                                "Failure".to_string(),
                                "writing externalModels import".to_string(),
                            ),
                            e,
                        )
                    })?;
                }
            }

            if !managed.is_empty() {
                let table_definitions = tables_to_typescript(&managed, None);
                let mut file = std::fs::OpenOptions::new()
                    .append(true)
                    .open(format!("{APP_DIR}/{TYPESCRIPT_MAIN_FILE}"))
                    .map_err(|e| {
                        RoutineFailure::new(
                            Message::new(
                                "Failure".to_string(),
                                format!("opening {TYPESCRIPT_MAIN_FILE}"),
                            ),
                            e,
                        )
                    })?;
                writeln!(file, "\n\n{table_definitions}").map_err(|e| {
                    RoutineFailure::new(
                        Message::new(
                            "Failure".to_string(),
                            "writing managed table definitions".to_string(),
                        ),
                        e,
                    )
                })?;
            }
        }
        SupportedLanguages::Python => {
            if !externally_managed.is_empty() {
                let table_definitions =
                    tables_to_python(&externally_managed, Some(LifeCycle::ExternallyManaged));
                let header = "# AUTO-GENERATED FILE. DO NOT EDIT.\n# This file will be replaced when you run `moose db pull`.";
                let mut file = std::fs::OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(format!("{APP_DIR}/{PYTHON_EXTERNAL_FILE}"))
                    .map_err(|e| {
                        RoutineFailure::new(
                            Message::new(
                                "Failure".to_string(),
                                format!("opening {PYTHON_EXTERNAL_FILE}"),
                            ),
                            e,
                        )
                    })?;
                writeln!(file, "{}\n\n{}", header, table_definitions).map_err(|e| {
                    RoutineFailure::new(
                        Message::new(
                            "Failure".to_string(),
                            "writing externally managed table definitions".to_string(),
                        ),
                        e,
                    )
                })?;
                let main_path = format!("{APP_DIR}/{PYTHON_MAIN_FILE}");
                let import_stmt = "from .external_models import *";
                let needs_import = match std::fs::read_to_string(&main_path) {
                    Ok(contents) => !contents.contains(import_stmt),
                    Err(_) => true,
                };
                if needs_import {
                    let mut file = std::fs::OpenOptions::new()
                        .append(true)
                        .open(&main_path)
                        .map_err(|e| {
                            RoutineFailure::new(
                                Message::new(
                                    "Failure".to_string(),
                                    format!("opening {PYTHON_MAIN_FILE}"),
                                ),
                                e,
                            )
                        })?;
                    writeln!(file, "\n{import_stmt}").map_err(|e| {
                        RoutineFailure::new(
                            Message::new(
                                "Failure".to_string(),
                                "writing external_models import".to_string(),
                            ),
                            e,
                        )
                    })?;
                }
            }
            if !managed.is_empty() {
                let table_definitions = tables_to_python(&managed, None);
                let mut file = std::fs::OpenOptions::new()
                    .append(true)
                    .open(format!("{APP_DIR}/{PYTHON_MAIN_FILE}"))
                    .map_err(|e| {
                        RoutineFailure::new(
                            Message::new(
                                "Failure".to_string(),
                                format!("opening {PYTHON_MAIN_FILE}"),
                            ),
                            e,
                        )
                    })?;
                writeln!(file, "\n\n{table_definitions}").map_err(|e| {
                    RoutineFailure::new(
                        Message::new(
                            "Failure".to_string(),
                            "writing managed table definitions".to_string(),
                        ),
                        e,
                    )
                })?;
            }
        }
    };
    // Create a git commit capturing generated code changes
    match create_code_generation_commit(
        // we have `cd`ed above
        ".".as_ref(),
        "chore(cli): commit code generation outputs",
    ) {
        Ok(Some(oid)) => {
            show_message!(
                MessageType::Info,
                Message {
                    action: "Git".to_string(),
                    details: format!("created commit {}", &oid.to_string()[..7]),
                }
            );
        }
        Ok(None) => {
            // No changes to commit; proceed silently
        }
        Err(e) => {
            return Err(RoutineFailure::new(
                Message::new(
                    "Failure".to_string(),
                    "creating code generation commit".to_string(),
                ),
                e,
            ));
        }
    }

    Ok(())
}

/// Pulls schema for ExternallyManaged tables and regenerates only external model files.
/// Does not modify `main.py` or `index.ts`.
pub async fn db_pull(
    remote_url: &str,
    project: &Project,
    file_path: Option<&str>,
) -> Result<(), RoutineFailure> {
    let (client, db) = create_client_and_db(remote_url).await?;

    debug!("Loading InfrastructureMap from user code (DMV2)");
    let infra_map = InfrastructureMap::load_from_user_code(project)
        .await
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Failure".to_string(),
                format!("loading infra map: {e:?}"),
            ))
        })?;

    let externally_managed_names: std::collections::HashSet<String> = infra_map
        .tables
        .values()
        .filter(|t| t.life_cycle == LifeCycle::ExternallyManaged)
        .map(|t| t.name.clone())
        .collect();

    // Names of all known tables in the project (managed or external)
    let known_table_names: std::collections::HashSet<String> =
        infra_map.tables.values().map(|t| t.name.clone()).collect();

    let (tables, _unsupported) = client.list_tables(&db, project).await.map_err(|e| {
        RoutineFailure::new(
            Message::new("Failure".to_string(), "listing tables".to_string()),
            e,
        )
    })?;

    // Overwrite the external models file with:
    // - existing external tables (from infra map)
    // - plus any unknown (not present in infra map) tables, marked as external
    let mut tables_for_external_file: Vec<Table> = tables
        .into_iter()
        .filter(|t| {
            externally_managed_names.contains(&t.name) || !known_table_names.contains(&t.name)
        })
        .collect();

    // Keep a stable ordering for deterministic output
    tables_for_external_file.sort_by(|a, b| a.name.cmp(&b.name));

    write_external_models_file(project.language, &tables_for_external_file, file_path)?;

    match create_code_generation_commit(
        ".".as_ref(),
        "chore(cli): commit db pull external model refresh",
    ) {
        Ok(Some(oid)) => {
            show_message!(
                MessageType::Info,
                Message {
                    action: "Git".to_string(),
                    details: format!("created commit {}", &oid.to_string()[..7]),
                }
            );
        }
        Ok(None) => {}
        Err(e) => {
            return Err(RoutineFailure::new(
                Message::new(
                    "Failure".to_string(),
                    "creating code generation commit".to_string(),
                ),
                e,
            ));
        }
    }

    Ok(())
}
