pub mod clickhouse_local;
pub mod errors;

use std::collections::HashSet;
use std::sync::Arc;

use bytes::{Bytes, BytesMut};
use http_body_util::Full;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tracing::{error, info};

use crate::cli::display::{show_message_wrapper, Message, MessageType};
use crate::cli::settings::Settings;
use crate::framework::core::plan::load_target_infrastructure;
use crate::framework::languages::SupportedLanguages;
use crate::infrastructure::processes::consumption_registry::ConsumptionProcessRegistry;
use crate::project::Project;
use errors::FunctionError;

use std::time::Duration;

/// Default database name for the function-mode clickhouse-local instance.
const FUNCTION_DB_NAME: &str = "default";

/// Run the `moose function` command.
///
/// Boots clickhouse-local, creates S3/IcebergS3 tables, starts the consumption API
/// subprocess, and serves HTTP requests. Designed for serverless deployments
/// (AWS Lambda via Web Adapter, GCP Cloud Run, or local testing).
pub async fn run_function(
    project: &Project,
    _settings: &Settings,
    mut port: u16,
    ch_port: u16,
) -> Result<(), FunctionError> {
    // Override port from PORT env var if set (Lambda Web Adapter / Cloud Run)
    if let Ok(env_port) = std::env::var("PORT") {
        if let Ok(p) = env_port.parse::<u16>() {
            port = p;
        }
    }

    show_message_wrapper(
        MessageType::Info,
        Message {
            action: "Function".to_string(),
            details: "Starting serverless mode...".to_string(),
        },
    );

    // 1. Compile TypeScript if needed
    if project.language == SupportedLanguages::Typescript {
        compile_typescript(project)?;
    }

    // 2. Boot clickhouse-local
    show_message_wrapper(
        MessageType::Info,
        Message {
            action: "Function".to_string(),
            details: "Downloading ClickHouse binary...".to_string(),
        },
    );
    let binary = clickhouse_local::ensure_binary()?;

    show_message_wrapper(
        MessageType::Info,
        Message {
            action: "Function".to_string(),
            details: "Writing clickhouse-local config...".to_string(),
        },
    );
    let config = clickhouse_local::write_config(&project.project_location, ch_port)?;

    show_message_wrapper(
        MessageType::Info,
        Message {
            action: "Function".to_string(),
            details: "Starting clickhouse-local...".to_string(),
        },
    );
    let _ch_process = clickhouse_local::start(&binary, &config)?;

    // 3. Wait for clickhouse-local to be healthy
    clickhouse_local::wait_healthy(ch_port, Duration::from_secs(30)).await?;

    show_message_wrapper(
        MessageType::Success,
        Message {
            action: "Function".to_string(),
            details: format!("clickhouse-local ready on port {ch_port}"),
        },
    );

    // 4. Create database
    clickhouse_local::ensure_database(ch_port, FUNCTION_DB_NAME).await?;

    // 5. Load infrastructure map from user code
    show_message_wrapper(
        MessageType::Info,
        Message {
            action: "Function".to_string(),
            details: "Loading infrastructure map...".to_string(),
        },
    );
    let infra_map = load_target_infrastructure(project)
        .await
        .map_err(|e| FunctionError::InfraMap(format!("Failed to load infrastructure map: {e}")))?;

    // 6. Validate and create S3/IcebergS3 tables
    let (compatible, incompatible) = clickhouse_local::validate_tables(&infra_map);

    if !incompatible.is_empty() {
        show_message_wrapper(
            MessageType::Warning,
            Message {
                action: "Function".to_string(),
                details: format!(
                    "Skipping {} table(s) with unsupported engines: {}",
                    incompatible.len(),
                    incompatible.join(", ")
                ),
            },
        );
    }

    if compatible.is_empty() {
        show_message_wrapper(
            MessageType::Warning,
            Message {
                action: "Function".to_string(),
                details:
                    "No S3/IcebergS3 tables found. Consumption APIs will have no tables to query."
                        .to_string(),
            },
        );
    }

    let created = clickhouse_local::create_tables(&infra_map, ch_port, FUNCTION_DB_NAME).await?;

    show_message_wrapper(
        MessageType::Success,
        Message {
            action: "Function".to_string(),
            details: format!("Created {created} table(s)"),
        },
    );

    // 7. Start consumption API subprocess
    let proxy_port = project.http_server_config.proxy_port;

    // Override the clickhouse config to point to our local instance
    let mut ch_config = project.clickhouse_config.clone();
    ch_config.host = "localhost".to_string();
    ch_config.host_port = ch_port as i32;
    ch_config.user = "default".to_string();
    ch_config.password = String::new();
    ch_config.db_name = FUNCTION_DB_NAME.to_string();
    ch_config.use_ssl = false;

    let mut consumption_registry = ConsumptionProcessRegistry::new(
        project.language,
        ch_config,
        project.jwt.clone(),
        project.project_location.clone(),
        project.clone(),
        Some(proxy_port),
    );

    consumption_registry.start()?;

    show_message_wrapper(
        MessageType::Success,
        Message {
            action: "Function".to_string(),
            details: format!("Consumption API subprocess started on port {proxy_port}"),
        },
    );

    // 8. Register known consumption APIs for routing
    let consumption_apis: Arc<RwLock<HashSet<String>>> = Arc::new(RwLock::new(HashSet::new()));

    // Register API endpoints from the infra map
    {
        let mut apis = consumption_apis.write().await;
        for name in infra_map.api_endpoints.keys() {
            apis.insert(name.clone());
        }
        info!("Registered {} consumption API endpoint(s)", apis.len());
    }

    // 9. Start HTTP server
    show_message_wrapper(
        MessageType::Success,
        Message {
            action: "Function".to_string(),
            details: format!(
                "Listening on http://0.0.0.0:{port} (proxying to consumption APIs on port {proxy_port})"
            ),
        },
    );

    serve_http(port, proxy_port)
        .await
        .map_err(FunctionError::HttpServer)?;

    Ok(())
}

/// Compile TypeScript using moose-tspc (same as production mode).
fn compile_typescript(project: &Project) -> Result<(), FunctionError> {
    show_message_wrapper(
        MessageType::Info,
        Message {
            action: "Function".to_string(),
            details: "Compiling TypeScript...".to_string(),
        },
    );

    let output = std::process::Command::new("npx")
        .arg("moose-tspc")
        .current_dir(&project.project_location)
        .env("MOOSE_SOURCE_DIR", &project.source_dir)
        .output()
        .map_err(|e| FunctionError::TsCompilation(format!("Failed to run moose-tspc: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(FunctionError::TsCompilation(stderr.to_string()));
    }

    show_message_wrapper(
        MessageType::Success,
        Message {
            action: "Function".to_string(),
            details: "TypeScript compiled".to_string(),
        },
    );

    Ok(())
}

/// Minimal HTTP server that proxies all requests to the consumption API subprocess.
async fn serve_http(
    port: u16,
    proxy_port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = TcpListener::bind(format!("0.0.0.0:{port}")).await?;

    loop {
        let (stream, _addr) = listener.accept().await?;
        let io = TokioIo::new(stream);

        tokio::spawn(async move {
            let service = service_fn(move |req: Request<hyper::body::Incoming>| {
                handle_request(req, proxy_port)
            });

            if let Err(e) = http1::Builder::new().serve_connection(io, service).await {
                error!("HTTP connection error: {e}");
            }
        });
    }
}

/// Handle an incoming HTTP request by proxying to the consumption API subprocess.
async fn handle_request(
    req: Request<hyper::body::Incoming>,
    proxy_port: u16,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let query = req.uri().query().map_or(String::new(), |q| format!("?{q}"));

    // Health check endpoint
    if path == "/health" || path == "/ping" {
        return Ok(Response::builder()
            .status(StatusCode::OK)
            .body(Full::new(Bytes::from("ok")))
            .unwrap());
    }

    // Proxy everything else to the consumption API subprocess.
    // Use "localhost" (not 127.0.0.1) because the TS runner binds to "localhost"
    // which may resolve to IPv6 [::1] on some platforms.
    let target_url = format!("http://localhost:{proxy_port}{path}{query}");

    let client = reqwest::Client::new();
    let mut proxy_req = client.request(method, &target_url);

    // Forward headers
    for (key, value) in req.headers() {
        proxy_req = proxy_req.header(key.as_str(), value.as_bytes());
    }

    // Forward body
    let body_bytes = read_body(req).await;
    if !body_bytes.is_empty() {
        proxy_req = proxy_req.body(body_bytes.clone());
    }

    match proxy_req.send().await {
        Ok(resp) => {
            let status = resp.status();
            let mut builder = Response::builder().status(status);

            // Copy response headers
            for (key, value) in resp.headers() {
                builder = builder.header(key, value);
            }

            let body = resp.bytes().await.unwrap_or_default();
            Ok(builder.body(Full::new(body)).unwrap())
        }
        Err(e) => {
            error!("Proxy error: {e}");
            Ok(Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Full::new(Bytes::from(format!("Proxy error: {e}"))))
                .unwrap())
        }
    }
}

/// Read the full request body into bytes.
async fn read_body(req: Request<hyper::body::Incoming>) -> Bytes {
    use http_body_util::BodyExt;

    let mut body_bytes = BytesMut::new();
    let mut body = req.into_body();

    while let Some(frame) = body.frame().await {
        match frame {
            Ok(frame) => {
                if let Some(data) = frame.data_ref() {
                    body_bytes.extend_from_slice(data);
                }
            }
            Err(_) => break,
        }
    }

    body_bytes.freeze()
}
