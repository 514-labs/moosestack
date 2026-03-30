use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::time::Duration;

use tokio::io::AsyncReadExt;

use crate::cli::display::{Message, MessageType};

use super::agents::{AgentInfo, JsonMcpFormat, LspConfig, McpConfig};

const MOOSE_DEV_URL: &str = "http://localhost:4000/mcp";
const CONTEXT7_URL: &str = "https://mcp.context7.com/mcp";
const HARNESS_COMMAND_TIMEOUT: Duration = Duration::from_secs(300);

pub(crate) async fn install_lsp() -> Result<bool, Box<dyn std::error::Error>> {
    if !command_exists("npm") {
        show_message!(
            MessageType::Warning,
            Message::new(
                "Harness".to_string(),
                "moosestack-lsp not installed. Node.js 20+ and npm are required.".to_string(),
            )
        );
        return Ok(false);
    }

    show_message!(
        MessageType::Info,
        Message::new(
            "Harness".to_string(),
            "Installing moosestack-lsp...".to_string(),
        )
    );

    let output = run_command_with_timeout(
        "npm",
        &["install", "-g", "@514labs/moose-lsp"],
        HARNESS_COMMAND_TIMEOUT,
    )
    .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        show_message!(
            MessageType::Warning,
            Message::new(
                "Harness".to_string(),
                format!("Failed to install moosestack-lsp: {}", stderr.trim()),
            )
        );
        return Ok(false);
    }

    show_message!(
        MessageType::Success,
        Message::new(
            "Harness".to_string(),
            "Installed moosestack-lsp globally".to_string(),
        )
    );
    Ok(true)
}

pub(crate) async fn install_plugin(agent: &AgentInfo) -> Result<bool, Box<dyn std::error::Error>> {
    let config = match &agent.plugin {
        Some(config) => config,
        None => return Ok(false),
    };

    let commands = config.setup.iter().chain(std::iter::once(&config.install));

    for command in commands {
        if !command_exists(command.program) {
            show_message!(
                MessageType::Warning,
                Message::new(
                    "Harness".to_string(),
                    format!(
                        "{} not found on PATH. {} failed for {}.",
                        command.program, command.description, agent.display_name
                    ),
                )
            );
            return Ok(false);
        }

        show_message!(
            MessageType::Info,
            Message::new("Harness".to_string(), format!("{}...", command.description))
        );

        let output =
            run_command_with_timeout(command.program, command.args, HARNESS_COMMAND_TIMEOUT)
                .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            show_message!(
                MessageType::Warning,
                Message::new(
                    "Harness".to_string(),
                    format!("{} failed: {}", command.description, stderr.trim()),
                )
            );
            return Ok(false);
        }
    }

    show_message!(
        MessageType::Success,
        Message::new(
            "Harness".to_string(),
            format!("Installed {} plugin", agent.display_name),
        )
    );
    Ok(true)
}

pub(crate) fn write_agent_mcp(
    agent: &AgentInfo,
    home: &Path,
) -> Result<bool, Box<dyn std::error::Error>> {
    let config = match &agent.user_scope_mcp {
        Some(config) => config,
        None => return Ok(false),
    };

    let written = match config {
        McpConfig::JsonFile {
            target,
            key,
            format,
        } => {
            let mut wrote_any = false;
            let mut all_written = true;
            for path in target.resolve_paths(home)? {
                let wrote = write_mcp_json_to_path(&path, *key, *format)?;
                wrote_any |= wrote;
                all_written &= wrote;
            }
            wrote_any && all_written
        }
        McpConfig::TomlFile { target } => {
            let mut wrote_any = false;
            for path in target.resolve_paths(home)? {
                wrote_any = write_mcp_toml_to_path(&path)? || wrote_any;
            }
            wrote_any
        }
        McpConfig::YamlFile { target } => {
            let mut wrote_any = false;
            for path in target.resolve_paths(home)? {
                wrote_any = write_mcp_yaml_to_path(&path)? || wrote_any;
            }
            wrote_any
        }
    };

    if written {
        show_message!(
            MessageType::Success,
            Message::new(
                "Harness".to_string(),
                format!("Configured MCP for {}", agent.display_name),
            )
        );
    }
    Ok(written)
}

pub(crate) fn write_agent_lsp(
    agent: &AgentInfo,
    home: &Path,
) -> Result<bool, Box<dyn std::error::Error>> {
    let config = match &agent.user_scope_lsp {
        Some(config) => config,
        None => return Ok(false),
    };

    let written = match config {
        LspConfig::JsonFile {
            target,
            key,
            payload,
        } => {
            let mut wrote_any = false;
            let payload = payload.json();
            for path in target.resolve_paths(home)? {
                wrote_any = write_lsp_json_to_path(&path, key, &payload)? || wrote_any;
            }
            wrote_any
        }
    };

    if written {
        show_message!(
            MessageType::Success,
            Message::new(
                "Harness".to_string(),
                format!("Configured LSP for {}", agent.display_name),
            )
        );
    }
    Ok(written)
}

fn backup_file(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        let bak = match path.extension() {
            Some(ext) => path.with_extension(format!("{}.bak", ext.to_string_lossy())),
            None => path.with_extension("bak"),
        };
        if !bak.exists() {
            std::fs::copy(path, bak)?;
        }
    }
    Ok(())
}

fn invalid_config_error(message: impl Into<String>) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message.into())
}

fn format_command(program: &str, args: &[&str]) -> String {
    std::iter::once(program)
        .chain(args.iter().copied())
        .collect::<Vec<_>>()
        .join(" ")
}

async fn run_command_with_timeout(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<Output, Box<dyn std::error::Error>> {
    let mut child = tokio::process::Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| invalid_config_error("Failed to capture command stdout"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| invalid_config_error("Failed to capture command stderr"))?;

    let stdout_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        stdout.read_to_end(&mut buffer).await.map(|_| buffer)
    });
    let stderr_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        stderr.read_to_end(&mut buffer).await.map(|_| buffer)
    });

    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(status) => status?,
        Err(_) => {
            let _ = child.kill().await;
            let _ = tokio::time::timeout(Duration::from_secs(1), child.wait()).await;
            let _ = stdout_task.await;
            let _ = stderr_task.await;

            return Err(invalid_config_error(format!(
                "Command `{}` timed out after {}s",
                format_command(program, args),
                timeout.as_secs()
            ))
            .into());
        }
    };

    let stdout = stdout_task
        .await
        .map_err(|e| invalid_config_error(format!("Failed to join stdout reader: {e}")))??;
    let stderr = stderr_task
        .await
        .map_err(|e| invalid_config_error(format!("Failed to join stderr reader: {e}")))??;

    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn mcp_json_servers(format: JsonMcpFormat) -> serde_json::Value {
    match format {
        JsonMcpFormat::StdioBridge => serde_json::json!({
            "moose-dev": {
                "command": { "path": "npx", "args": ["-y", "mcp-remote", MOOSE_DEV_URL] }
            },
            "context7": {
                "command": { "path": "npx", "args": ["-y", "mcp-remote", CONTEXT7_URL] }
            }
        }),
        JsonMcpFormat::HttpServers => serde_json::json!({
            "moose-dev": { "type": "http", "url": MOOSE_DEV_URL },
            "context7": { "type": "http", "url": CONTEXT7_URL }
        }),
        JsonMcpFormat::RemoteServers => serde_json::json!({
            "moose-dev": { "url": MOOSE_DEV_URL },
            "context7": { "url": CONTEXT7_URL }
        }),
    }
}

fn write_mcp_json_to_path(
    path: &Path,
    key: Option<&str>,
    format: JsonMcpFormat,
) -> Result<bool, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    backup_file(path)?;

    let servers = mcp_json_servers(format);
    let mut root: serde_json::Value = if path.exists() {
        let content = std::fs::read_to_string(path)?;
        match serde_json::from_str(&content) {
            Ok(value) => value,
            Err(e) => {
                let snippet = match key {
                    Some(section) => {
                        serde_json::to_string_pretty(&serde_json::json!({ section: servers }))?
                    }
                    None => serde_json::to_string_pretty(&servers)?,
                };
                eprintln!(
                    "Could not parse {} (backup at {}.bak): {}\nPlease manually add the following to your config:\n{}",
                    path.display(),
                    path.display(),
                    e,
                    snippet,
                );
                return Ok(false);
            }
        }
    } else {
        serde_json::json!({})
    };

    match key {
        Some(section_key) => {
            let root_obj = root.as_object_mut().ok_or("Config is not a JSON object")?;
            let section = root_obj
                .entry(section_key.to_string())
                .or_insert_with(|| serde_json::json!({}));
            let section_obj = section
                .as_object_mut()
                .ok_or("Config key exists but is not a JSON object")?;
            if let Some(servers_obj) = servers.as_object() {
                for (server_name, server_value) in servers_obj {
                    section_obj.insert(server_name.clone(), server_value.clone());
                }
            }
        }
        None => {
            let obj = root.as_object_mut().ok_or("Config is not a JSON object")?;
            if let Some(servers_obj) = servers.as_object() {
                for (server_name, server_value) in servers_obj {
                    obj.insert(server_name.clone(), server_value.clone());
                }
            }
        }
    }

    std::fs::write(path, serde_json::to_string_pretty(&root)? + "\n")?;
    Ok(true)
}

fn write_lsp_json_to_path(
    path: &Path,
    key: &str,
    payload: &serde_json::Value,
) -> Result<bool, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    backup_file(path)?;

    let mut root: serde_json::Value = if path.exists() {
        let content = std::fs::read_to_string(path)?;
        match serde_json::from_str(&content) {
            Ok(value) => value,
            Err(e) => {
                let snippet = serde_json::to_string_pretty(&serde_json::json!({ key: payload }))?;
                eprintln!(
                    "Could not parse {} (backup at {}.bak): {}\nPlease manually add the following to your config:\n{}",
                    path.display(),
                    path.display(),
                    e,
                    snippet,
                );
                return Ok(false);
            }
        }
    } else {
        serde_json::json!({})
    };

    let payload_obj = payload
        .as_object()
        .ok_or_else(|| invalid_config_error("LSP payload must be a JSON object"))?;
    let lsp_section = root
        .as_object_mut()
        .ok_or("Config is not a JSON object")?
        .entry(key)
        .or_insert_with(|| serde_json::json!({}));

    let obj = lsp_section.as_object_mut().ok_or_else(|| {
        invalid_config_error(format!(
            "Config key '{key}' exists but is not a JSON object"
        ))
    })?;
    for (payload_key, payload_value) in payload_obj {
        obj.insert(payload_key.clone(), payload_value.clone());
    }

    std::fs::write(path, serde_json::to_string_pretty(&root)? + "\n")?;
    Ok(true)
}

fn write_mcp_toml_to_path(path: &Path) -> Result<bool, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    backup_file(path)?;

    let mut root: toml::Value = if path.exists() {
        let content = std::fs::read_to_string(path)?;
        match content.parse() {
            Ok(value) => value,
            Err(e) => {
                eprintln!(
                    "Could not parse {} (backup at {}.bak): {}\nPlease manually add the following to your config:\n\n[mcp_servers.moose-dev]\nurl = \"{}\"\n\n[mcp_servers.context7]\nurl = \"{}\"",
                    path.display(),
                    path.display(),
                    e,
                    MOOSE_DEV_URL,
                    CONTEXT7_URL,
                );
                return Ok(false);
            }
        }
    } else {
        toml::Value::Table(toml::map::Map::new())
    };

    let table = root.as_table_mut().ok_or("Config is not a TOML table")?;
    let mcp_servers = table
        .entry("mcp_servers")
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
    let servers = mcp_servers.as_table_mut().ok_or_else(|| {
        invalid_config_error("Config key `mcp_servers` exists but is not a TOML table")
    })?;

    let mut moose_dev = toml::map::Map::new();
    moose_dev.insert("url".into(), toml::Value::String(MOOSE_DEV_URL.into()));
    servers.insert("moose-dev".into(), toml::Value::Table(moose_dev));

    let mut context7 = toml::map::Map::new();
    context7.insert("url".into(), toml::Value::String(CONTEXT7_URL.into()));
    servers.insert("context7".into(), toml::Value::Table(context7));

    std::fs::write(path, toml::to_string_pretty(&root)?)?;
    Ok(true)
}

fn write_mcp_yaml_to_path(path: &Path) -> Result<bool, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    backup_file(path)?;

    let mut root: serde_yaml::Value = if path.exists() {
        let content = std::fs::read_to_string(path)?;
        match serde_yaml::from_str(&content) {
            Ok(serde_yaml::Value::Null) => serde_yaml::Value::Mapping(Default::default()),
            Ok(value) => value,
            Err(e) => {
                eprintln!(
                    "Could not parse {} (backup at {}.bak): {}\nPlease manually add the following to your config:\n\nmcpServers:\n  - name: moose-dev\n    url: {}\n  - name: context7\n    url: {}",
                    path.display(),
                    path.display(),
                    e,
                    MOOSE_DEV_URL,
                    CONTEXT7_URL,
                );
                return Ok(false);
            }
        }
    } else {
        serde_yaml::Value::Mapping(Default::default())
    };

    let mapping = root
        .as_mapping_mut()
        .ok_or("Config is not a YAML mapping")?;

    let key = serde_yaml::Value::String("mcpServers".into());
    let mut merged: Vec<serde_yaml::Value> = match mapping.get(&key) {
        Some(value) => value
            .as_sequence()
            .map(|sequence| sequence.to_vec())
            .ok_or_else(|| {
                invalid_config_error("Config key `mcpServers` exists but is not a YAML sequence")
            })?,
        None => Vec::new(),
    };

    merged.retain(|entry| {
        entry
            .as_mapping()
            .and_then(|mapping| {
                let name_key = serde_yaml::Value::String("name".into());
                mapping.get(&name_key)
            })
            .and_then(|value| value.as_str())
            .map(|name| name != "moose-dev" && name != "context7")
            .unwrap_or(true)
    });

    merged.push(serde_yaml::Value::Mapping(yaml_server(
        "moose-dev",
        MOOSE_DEV_URL,
    )));
    merged.push(serde_yaml::Value::Mapping(yaml_server(
        "context7",
        CONTEXT7_URL,
    )));
    mapping.insert(key, serde_yaml::Value::Sequence(merged));

    std::fs::write(path, serde_yaml::to_string(&root)?)?;
    Ok(true)
}

fn yaml_server(name: &str, url: &str) -> serde_yaml::Mapping {
    let mut mapping = serde_yaml::Mapping::new();
    mapping.insert(
        serde_yaml::Value::String("name".into()),
        serde_yaml::Value::String(name.to_string()),
    );
    mapping.insert(
        serde_yaml::Value::String("url".into()),
        serde_yaml::Value::String(url.to_string()),
    );
    mapping
}

fn command_exists(program: &str) -> bool {
    let path_dirs = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .unwrap_or_default();

    path_dirs
        .into_iter()
        .flat_map(|dir| executable_candidates(dir, program))
        .any(|path| path.is_file())
}

fn executable_candidates(dir: PathBuf, program: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let pathext = std::env::var_os("PATHEXT")
            .unwrap_or_else(|| ".EXE;.CMD;.BAT;.COM".into())
            .to_string_lossy()
            .split(';')
            .filter(|ext| !ext.is_empty())
            .map(|ext| dir.join(format!("{program}{ext}")))
            .collect::<Vec<_>>();

        if Path::new(program).extension().is_some() {
            let mut candidates = vec![dir.join(program)];
            candidates.extend(pathext);
            return candidates;
        }

        pathext
    }

    #[cfg(not(windows))]
    {
        vec![dir.join(program)]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::routines::harness::agents::{ConfigTarget, JsonMcpFormat, LspPayload};
    use tempfile::TempDir;

    #[test]
    fn test_write_mcp_json_creates_new_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(".zed/settings.json");
        write_mcp_json_to_path(&path, Some("context_servers"), JsonMcpFormat::StdioBridge).unwrap();

        let content = std::fs::read_to_string(path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(parsed["context_servers"]["moose-dev"].is_object());
        assert!(parsed["context_servers"]["context7"].is_object());
    }

    #[test]
    fn test_write_mcp_toml_creates_new_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(".codex/config.toml");
        write_mcp_toml_to_path(&path).unwrap();

        let content = std::fs::read_to_string(path).unwrap();
        assert!(content.contains("[mcp_servers.moose-dev]"));
        assert!(content.contains("[mcp_servers.context7]"));
    }

    #[test]
    fn test_write_mcp_yaml_creates_new_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(".continue/config.yaml");
        write_mcp_yaml_to_path(&path).unwrap();

        let content = std::fs::read_to_string(path).unwrap();
        assert!(content.contains("mcpServers:"));
        assert!(content.contains("name: moose-dev"));
        assert!(content.contains("name: context7"));
    }

    #[test]
    fn test_write_lsp_json() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(".config/zed/settings.json");
        let payload = LspPayload::Zed.json();

        write_lsp_json_to_path(&path, "lsp", &payload).unwrap();

        let content = std::fs::read_to_string(path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(parsed["lsp"]["moosestack-lsp"].is_object());
    }

    #[test]
    fn test_write_lsp_json_errors_on_non_object_section() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(".config/opencode/opencode.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{ "lsp": [] }"#).unwrap();

        let error = write_lsp_json_to_path(&path, "lsp", &LspPayload::OpenCode.json()).unwrap_err();

        assert!(error.to_string().contains("not a JSON object"));
    }

    #[test]
    fn test_write_mcp_toml_errors_on_non_table_section() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(".codex/config.toml");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "mcp_servers = []\n").unwrap();

        let error = write_mcp_toml_to_path(&path).unwrap_err();

        assert!(error.to_string().contains("not a TOML table"));
    }

    #[test]
    fn test_write_mcp_yaml_errors_on_non_sequence_section() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(".continue/config.yaml");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "mcpServers: {}\n").unwrap();

        let error = write_mcp_yaml_to_path(&path).unwrap_err();

        assert!(error.to_string().contains("not a YAML sequence"));
    }

    #[test]
    fn test_run_command_with_timeout_kills_hung_process() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let (program, args): (&str, &[&str]) = timeout_test_command();
        let error = runtime
            .block_on(run_command_with_timeout(
                program,
                args,
                Duration::from_millis(50),
            ))
            .unwrap_err();

        assert!(error.to_string().contains("timed out"));
    }

    #[test]
    fn test_claude_code_uses_file_backed_mcp_and_plugin_install() {
        let agent = super::super::agents::find_agent_by_id("claude-code").unwrap();
        assert!(matches!(
            agent.user_scope_mcp,
            Some(McpConfig::JsonFile {
                target: ConfigTarget::HomeRelative(".claude.json"),
                key: Some("mcpServers"),
                format: JsonMcpFormat::HttpServers,
            })
        ));
        let plugin = agent.plugin.as_ref().unwrap();
        assert_eq!(plugin.setup.len(), 1);
        assert_eq!(plugin.setup[0].program, "claude");
        assert_eq!(plugin.install.program, "claude");
    }

    #[test]
    fn test_write_agent_mcp_returns_false_if_any_vscode_profile_is_skipped() {
        let tmp = TempDir::new().unwrap();
        let default_path = ConfigTarget::VsCodeUserMcpJson
            .resolve_paths(tmp.path())
            .unwrap()
            .into_iter()
            .next()
            .expect("vscode config path should resolve");
        let user_dir = default_path
            .parent()
            .expect("vscode config path should have a parent")
            .to_path_buf();
        let broken_profile = user_dir.join("profiles").join("broken");

        std::fs::create_dir_all(&broken_profile).unwrap();
        std::fs::write(broken_profile.join("mcp.json"), "{ invalid json").unwrap();

        let agent = super::super::agents::find_agent_by_id("vscode").unwrap();
        let written = write_agent_mcp(agent, tmp.path()).unwrap();

        assert!(!written);

        let default_config = std::fs::read_to_string(user_dir.join("mcp.json"))
            .expect("default config should exist");
        assert!(default_config.contains("\"moose-dev\""));
        assert!(default_config.contains("\"context7\""));
    }

    #[cfg(not(windows))]
    fn timeout_test_command() -> (&'static str, &'static [&'static str]) {
        ("sh", &["-c", "sleep 5"])
    }

    #[cfg(windows)]
    fn timeout_test_command() -> (&'static str, &'static [&'static str]) {
        ("cmd", &["/C", "ping -n 6 127.0.0.1 > NUL"])
    }
}
