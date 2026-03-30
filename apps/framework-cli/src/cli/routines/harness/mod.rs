mod agents;
mod config;

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};

use home::home_dir;
use serde::Deserialize;

use self::agents::{detect_installed_agents, find_agent_by_id, AgentInfo, AGENT_REGISTRY};
use self::config::{install_lsp, install_plugin, write_agent_lsp, write_agent_mcp};
use crate::cli::commands::{HarnessInitAction, HarnessInitArgs};
use crate::cli::display::{Message, MessageType};
use crate::cli::routines::project_init::{
    initialize_project, ProjectInitOptions, RemoteBootstrapSource,
};
use crate::cli::routines::templates::{get_visible_template_infos, TemplateInfo};
use crate::cli::settings::Settings;
use crate::cli::{check_project_name, prompt_user};
use crate::utilities::capture::{capture_usage, wait_for_usage_capture, ActivityType};
use crate::utilities::constants::CLI_VERSION;

use super::{RoutineFailure, RoutineSuccess};

const DEFAULT_SKILLS_BRANCH: &str = "main";
const GITHUB_REPO_OWNER: &str = "514-labs";
const GITHUB_REPO_NAME: &str = "agent-skills";
const SKILLS_DIR_PREFIX: &str = "skills/";
const HARNESS_INIT_SCHEMA_VERSION: u32 = 1;
const LOCAL_SKILLS_DIR_ENV: &str = "MOOSE_HARNESS_SKILLS_DIR";

#[derive(Debug, Deserialize)]
struct HarnessInitRequest {
    version: u32,
    name: Option<String>,
    template: Option<String>,
    location: Option<String>,
    no_fail_already_exists: Option<bool>,
    custom_dockerfile: Option<bool>,
    from_remote: Option<String>,
    #[serde(default)]
    agents: Vec<String>,
    install_lsp: Option<bool>,
    branch: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitTreeResponse {
    tree: Vec<GitTreeEntry>,
}

#[derive(Debug, Deserialize)]
struct GitTreeEntry {
    path: String,
    #[serde(rename = "type")]
    entry_type: String,
}

#[derive(Debug, Clone)]
enum AgentSelection {
    AutoDetect,
    Explicit(Vec<String>),
    None,
}

struct ResolvedHarnessOptions {
    name: String,
    template: String,
    location: Option<String>,
    no_fail_already_exists: bool,
    custom_dockerfile: bool,
    from_remote: Option<String>,
    branch: String,
    install_lsp: bool,
    agent_selection: AgentSelection,
}

enum SkillFileSource {
    GitHubPath(String),
    LocalPath(PathBuf),
}

struct SkillFileSpec {
    relative_path: String,
    source: SkillFileSource,
}

struct SkillInfo {
    name: String,
    files: Vec<SkillFileSpec>,
}

struct HarnessSetupOutcome {
    selected_agents: Vec<String>,
    installed_skills: Vec<String>,
    configured_mcp_agents: Vec<String>,
    configured_lsp_agents: Vec<String>,
    plugin_agents: Vec<String>,
    install_lsp_requested: bool,
    lsp_installed: bool,
    warnings: Vec<String>,
}

pub async fn run_harness_init(
    flags: &HarnessInitArgs,
    settings: &Settings,
    machine_id: &str,
) -> Result<RoutineSuccess, RoutineFailure> {
    if let Some(HarnessInitAction::Schema { json }) = &flags.action {
        return emit_schema(*json);
    }

    let request = read_init_request_input(flags.input.as_deref())
        .and_then(|raw| raw.map(|input| parse_init_request(&input)).transpose())?;

    let home = home_dir().ok_or_else(|| {
        RoutineFailure::error(Message::new(
            "Harness".to_string(),
            "Could not determine home directory".to_string(),
        ))
    })?;

    let interactive = !has_cli_inputs(flags) && request.is_none();
    let resolved = if interactive {
        resolve_interactive_options(&home).await?
    } else {
        resolve_non_interactive_options(flags, request)?
    };

    check_project_name(&resolved.name)?;

    let project_dir = PathBuf::from(
        resolved
            .location
            .clone()
            .unwrap_or_else(|| resolved.name.clone()),
    );

    let capture_handle = capture_usage(
        ActivityType::InitTemplateCommand,
        Some(resolved.name.clone()),
        settings,
        machine_id.to_string(),
        HashMap::from([
            ("template".to_string(), resolved.template.clone()),
            ("flow".to_string(), "harness".to_string()),
        ]),
    );

    let project_outcome = initialize_project(&ProjectInitOptions {
        template: &resolved.template,
        project_name: &resolved.name,
        dir_path: &project_dir,
        no_fail_already_exists: resolved.no_fail_already_exists,
        custom_dockerfile: resolved.custom_dockerfile,
        remote_bootstrap: match resolved.from_remote.clone() {
            Some(url) => RemoteBootstrapSource::ConnectionString(url),
            None => RemoteBootstrapSource::None,
        },
    })
    .await?;

    let selected_agents = resolve_target_agents(&home, &resolved.agent_selection)?;
    let harness_outcome = install_harness_support(
        &home,
        &resolved.branch,
        &selected_agents,
        resolved.install_lsp,
    )
    .await?;

    wait_for_usage_capture(capture_handle).await;

    let harness_summary = format_harness_summary(&harness_outcome);
    let success_message = if harness_summary.is_empty() {
        format!("\n\n{}", project_outcome.post_install_message)
    } else {
        format!(
            "\n\n{}\n\n{}",
            project_outcome.post_install_message, harness_summary
        )
    };

    Ok(RoutineSuccess::highlight(Message::new(
        "Get Started".to_string(),
        success_message,
    )))
}

fn read_init_request_input(input_path: Option<&str>) -> Result<Option<String>, RoutineFailure> {
    let Some(path) = input_path else {
        return Ok(None);
    };

    let content = if path == "-" {
        let mut buf = String::new();
        std::io::stdin().read_to_string(&mut buf).map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Harness".to_string(),
                    "Failed to read harness init input from stdin".to_string(),
                ),
                e,
            )
        })?;
        buf
    } else {
        std::fs::read_to_string(path).map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Harness".to_string(),
                    format!("Failed to read harness init input file '{path}'"),
                ),
                e,
            )
        })?
    };

    if content.trim().is_empty() {
        return Err(RoutineFailure::error(Message::new(
            "Harness".to_string(),
            "Harness init input was empty".to_string(),
        )));
    }

    Ok(Some(content))
}

fn parse_init_request(raw: &str) -> Result<HarnessInitRequest, RoutineFailure> {
    let request: HarnessInitRequest = serde_json::from_str(raw).map_err(|e| {
        RoutineFailure::error(Message::new(
            "Harness".to_string(),
            format!("Failed to parse harness init input JSON: {e}"),
        ))
    })?;

    if request.version != HARNESS_INIT_SCHEMA_VERSION {
        return Err(RoutineFailure::error(Message::new(
            "Harness".to_string(),
            format!(
                "Unsupported harness init input version {} (expected {})",
                request.version, HARNESS_INIT_SCHEMA_VERSION
            ),
        )));
    }

    Ok(request)
}

fn has_cli_inputs(flags: &HarnessInitArgs) -> bool {
    flags.name.is_some()
        || flags.template.is_some()
        || flags.location.is_some()
        || flags.no_fail_already_exists
        || flags.from_remote.is_some()
        || flags.custom_dockerfile
        || !flags.agents.is_empty()
        || flags.lsp
        || flags.no_lsp
        || flags.branch.is_some()
        || flags.input.is_some()
}

fn resolve_non_interactive_options(
    flags: &HarnessInitArgs,
    request: Option<HarnessInitRequest>,
) -> Result<ResolvedHarnessOptions, RoutineFailure> {
    let request_name = request.as_ref().and_then(|value| value.name.clone());
    let request_template = request.as_ref().and_then(|value| value.template.clone());
    let request_location = request.as_ref().and_then(|value| value.location.clone());
    let request_no_fail = request
        .as_ref()
        .and_then(|value| value.no_fail_already_exists)
        .unwrap_or(false);
    let request_custom_dockerfile = request
        .as_ref()
        .and_then(|value| value.custom_dockerfile)
        .unwrap_or(false);
    let request_from_remote = request.as_ref().and_then(|value| value.from_remote.clone());
    let request_install_lsp = request
        .as_ref()
        .and_then(|value| value.install_lsp)
        .unwrap_or(false);
    let request_branch = request.as_ref().and_then(|value| value.branch.clone());
    let request_agents = request
        .as_ref()
        .map(|value| value.agents.clone())
        .unwrap_or_default();

    let name = flags.name.clone().or(request_name).ok_or_else(|| {
        RoutineFailure::error(Message::new(
            "Harness".to_string(),
            "Non-interactive harness init requires a project name. Provide it as an argument or in the input JSON.".to_string(),
        ))
    })?;

    let template = flags.template.clone().or(request_template).ok_or_else(|| {
        RoutineFailure::error(Message::new(
            "Harness".to_string(),
            "Non-interactive harness init requires a template name. Provide it as an argument or in the input JSON.".to_string(),
        ))
    })?;

    let from_remote = match &flags.from_remote {
        Some(Some(url)) => Some(url.clone()),
        Some(None) => {
            return Err(RoutineFailure::error(Message::new(
                "Harness".to_string(),
                "Non-interactive harness init requires `--from-remote <connection-string>`; bare `--from-remote` is interactive-only."
                    .to_string(),
            )))
        }
        None => request_from_remote,
    };

    Ok(ResolvedHarnessOptions {
        name,
        template: template.to_lowercase(),
        location: flags.location.clone().or(request_location),
        no_fail_already_exists: flags.no_fail_already_exists || request_no_fail,
        custom_dockerfile: flags.custom_dockerfile || request_custom_dockerfile,
        from_remote,
        branch: flags
            .branch
            .clone()
            .or(request_branch)
            .unwrap_or_else(|| DEFAULT_SKILLS_BRANCH.to_string()),
        install_lsp: if flags.lsp {
            true
        } else if flags.no_lsp {
            false
        } else {
            request_install_lsp
        },
        agent_selection: resolve_agent_selection(if !flags.agents.is_empty() {
            flags.agents.clone()
        } else {
            request_agents
        })?,
    })
}

async fn resolve_interactive_options(
    home: &Path,
) -> Result<ResolvedHarnessOptions, RoutineFailure> {
    show_message!(
        MessageType::Info,
        Message::new(
            "Harness".to_string(),
            "Starting interactive harness setup".to_string(),
        )
    );

    let name = loop {
        let value = prompt_user(
            "Project name",
            None,
            Some("Use '.' to initialize the current directory"),
        )?;
        if value.trim().is_empty() {
            show_message!(
                MessageType::Warning,
                Message::new(
                    "Harness".to_string(),
                    "Project name cannot be empty.".to_string(),
                )
            );
            continue;
        }

        match check_project_name(&value) {
            Ok(()) => break value,
            Err(error) => {
                show_message!(error.message_type, error.message);
            }
        }
    };

    let template = prompt_for_template().await?;
    let default_location = if name == "." {
        ".".to_string()
    } else {
        name.clone()
    };
    let location = prompt_user(
        "Project location",
        Some(&default_location),
        Some("Press enter to use the default path"),
    )?;
    let from_remote = if prompt_bool("Bootstrap from a remote ClickHouse cluster?", false)? {
        Some(crate::cli::routines::code_generation::prompt_user_for_remote_ch_http()?)
    } else {
        None
    };
    let agent_selection = prompt_for_agents(home)?;
    let install_lsp = prompt_bool("Install MooseStack LSP?", false)?;

    Ok(ResolvedHarnessOptions {
        name,
        template,
        location: Some(location),
        no_fail_already_exists: false,
        custom_dockerfile: false,
        from_remote,
        branch: DEFAULT_SKILLS_BRANCH.to_string(),
        install_lsp,
        agent_selection,
    })
}

async fn prompt_for_template() -> Result<String, RoutineFailure> {
    let mut default_template = "typescript".to_string();

    match get_visible_template_infos(CLI_VERSION).await {
        Ok(templates) if !templates.is_empty() => {
            if let Some(candidate) = choose_default_template(&templates) {
                default_template = candidate.to_string();
            }
            show_message!(
                MessageType::Info,
                Message::new(
                    "Harness".to_string(),
                    format!(
                        "Available templates:\n{}",
                        templates
                            .iter()
                            .map(|template| format!(
                                "  - {} ({}) - {}",
                                template.name, template.language, template.description
                            ))
                            .collect::<Vec<_>>()
                            .join("\n")
                    ),
                )
            );
        }
        Ok(_) => {}
        Err(error) => {
            show_message!(error.message_type, error.message);
        }
    }

    Ok(prompt_user(
        "Template name",
        Some(&default_template),
        Some("Run `moose template list` if you want the full catalog."),
    )?
    .to_lowercase())
}

fn choose_default_template(templates: &[TemplateInfo]) -> Option<&str> {
    templates
        .iter()
        .find(|template| template.name == "typescript")
        .or_else(|| templates.first())
        .map(|template| template.name.as_str())
}

fn prompt_for_agents(home: &Path) -> Result<AgentSelection, RoutineFailure> {
    let detected = detect_installed_agents(home);

    if detected.is_empty() {
        show_message!(
            MessageType::Warning,
            Message::new(
                "Harness".to_string(),
                format!(
                    "No supported coding agents auto-detected. Supported agents: {}",
                    AGENT_REGISTRY
                        .iter()
                        .map(|agent| format!("{} ({})", agent.id, agent.location_hint()))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            )
        );
    } else {
        show_message!(
            MessageType::Info,
            Message::new(
                "Harness".to_string(),
                format!(
                    "Detected coding agents: {}",
                    detected
                        .iter()
                        .map(|agent| agent.display_name)
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            )
        );
    }

    loop {
        let default = if detected.is_empty() { "none" } else { "auto" };
        let input = prompt_user(
            "Coding agents",
            Some(default),
            Some("Use `auto`, `none`, or a comma-separated list like `codex,cursor`."),
        )?;

        match resolve_agent_selection(
            input
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect(),
        ) {
            Ok(selection) => return Ok(selection),
            Err(error) => {
                show_message!(error.message_type, error.message);
            }
        }
    }
}

fn prompt_bool(prompt: &str, default: bool) -> Result<bool, RoutineFailure> {
    let default_value = if default { "y" } else { "n" };
    loop {
        let input = prompt_user(prompt, Some(default_value), None)?.to_lowercase();
        match input.as_str() {
            "y" | "yes" | "true" | "1" => return Ok(true),
            "n" | "no" | "false" | "0" => return Ok(false),
            _ => {
                show_message!(
                    MessageType::Warning,
                    Message::new(
                        "Harness".to_string(),
                        "Please answer yes or no.".to_string(),
                    )
                );
            }
        }
    }
}

fn resolve_agent_selection(agent_ids: Vec<String>) -> Result<AgentSelection, RoutineFailure> {
    if agent_ids.is_empty() {
        return Ok(AgentSelection::AutoDetect);
    }

    if agent_ids.len() == 1 {
        match agent_ids[0].trim().to_lowercase().as_str() {
            "auto" => return Ok(AgentSelection::AutoDetect),
            "none" => return Ok(AgentSelection::None),
            _ => {}
        }
    }

    let mut seen = HashSet::new();
    let mut resolved = Vec::new();
    for id in agent_ids {
        let normalized = id.trim().to_lowercase();
        if normalized == "auto" || normalized == "none" {
            return Err(RoutineFailure::error(Message::new(
                "Harness".to_string(),
                "Use either `auto`, `none`, or explicit agent ids, but do not mix them."
                    .to_string(),
            )));
        }
        if !seen.insert(normalized.clone()) {
            continue;
        }
        if find_agent_by_id(&normalized).is_none() {
            return Err(RoutineFailure::error(Message::new(
                "Harness".to_string(),
                format!(
                    "Unknown agent '{}'. Valid agents: {}",
                    normalized,
                    valid_agent_ids().join(", ")
                ),
            )));
        }
        resolved.push(normalized);
    }

    Ok(AgentSelection::Explicit(resolved))
}

fn resolve_target_agents(
    home: &Path,
    selection: &AgentSelection,
) -> Result<Vec<&'static AgentInfo>, RoutineFailure> {
    match selection {
        AgentSelection::AutoDetect => Ok(detect_installed_agents(home)),
        AgentSelection::None => Ok(Vec::new()),
        AgentSelection::Explicit(agent_ids) => {
            let mut agents = Vec::new();
            let mut seen = HashSet::new();
            for agent_id in agent_ids {
                if !seen.insert(agent_id.as_str()) {
                    continue;
                }
                let agent = find_agent_by_id(agent_id).ok_or_else(|| {
                    RoutineFailure::error(Message::new(
                        "Harness".to_string(),
                        format!(
                            "Unknown agent '{}'. Valid agents: {}",
                            agent_id,
                            valid_agent_ids().join(", ")
                        ),
                    ))
                })?;
                agents.push(agent);
            }
            Ok(agents)
        }
    }
}

fn valid_agent_ids() -> Vec<&'static str> {
    AGENT_REGISTRY.iter().map(|agent| agent.id).collect()
}

async fn install_harness_support(
    home: &Path,
    branch: &str,
    agents: &[&'static AgentInfo],
    install_lsp_requested: bool,
) -> Result<HarnessSetupOutcome, RoutineFailure> {
    let selected_agents = agents
        .iter()
        .map(|agent| agent.display_name.to_string())
        .collect::<Vec<_>>();

    if agents.is_empty() {
        return Ok(HarnessSetupOutcome {
            selected_agents,
            installed_skills: Vec::new(),
            configured_mcp_agents: Vec::new(),
            configured_lsp_agents: Vec::new(),
            plugin_agents: Vec::new(),
            install_lsp_requested,
            lsp_installed: false,
            warnings: vec![
                "Skipped skills and MCP configuration because no coding agents were selected or detected."
                    .to_string(),
            ],
        });
    }

    show_message!(
        MessageType::Info,
        Message::new(
            "Harness".to_string(),
            format!(
                "Installing harness support for {}",
                selected_agents.join(", ")
            ),
        )
    );

    let skills = load_skills(branch).await?;
    if skills.is_empty() {
        return Err(RoutineFailure::error(Message::new(
            "Harness".to_string(),
            "No skills were found in the agent skills catalog.".to_string(),
        )));
    }

    let installed_skills = skills
        .iter()
        .map(|skill| skill.name.clone())
        .collect::<Vec<_>>();

    for skill in &skills {
        install_skill(skill, agents, home, branch).await?;
    }

    let lsp_installed = if install_lsp_requested {
        install_lsp().await.map_err(|e| {
            RoutineFailure::error(Message::new(
                "Harness".to_string(),
                format!("Failed to install MooseStack LSP: {e}"),
            ))
        })?
    } else {
        false
    };

    let mut configured_mcp_agents = Vec::new();
    let mut configured_lsp_agents = Vec::new();
    let mut plugin_agents = Vec::new();

    for agent in agents {
        if agent.plugin.is_some()
            && install_plugin(agent).await.map_err(|e| {
                RoutineFailure::error(Message::new(
                    "Harness".to_string(),
                    format!("Failed to install plugin for {}: {e}", agent.display_name),
                ))
            })?
        {
            plugin_agents.push(agent.display_name.to_string());
        }

        if write_agent_mcp(agent, home).map_err(|e| {
            RoutineFailure::error(Message::new(
                "Harness".to_string(),
                format!("Failed to configure MCP for {}: {e}", agent.display_name),
            ))
        })? {
            configured_mcp_agents.push(agent.display_name.to_string());
        }

        if lsp_installed
            && write_agent_lsp(agent, home).map_err(|e| {
                RoutineFailure::error(Message::new(
                    "Harness".to_string(),
                    format!("Failed to configure LSP for {}: {e}", agent.display_name),
                ))
            })?
        {
            configured_lsp_agents.push(agent.display_name.to_string());
        }
    }

    Ok(HarnessSetupOutcome {
        selected_agents,
        installed_skills,
        configured_mcp_agents,
        configured_lsp_agents,
        plugin_agents,
        install_lsp_requested,
        lsp_installed,
        warnings: Vec::new(),
    })
}

fn format_harness_summary(outcome: &HarnessSetupOutcome) -> String {
    let mut lines = Vec::new();

    if !outcome.selected_agents.is_empty() {
        lines.push(format!(
            "Configured coding agents: {}",
            outcome.selected_agents.join(", ")
        ));
    }

    if !outcome.installed_skills.is_empty() {
        lines.push(format!(
            "Installed skills: {}",
            outcome.installed_skills.join(", ")
        ));
    }

    if !outcome.configured_mcp_agents.is_empty() {
        lines.push(format!(
            "MCP configured: {}",
            outcome.configured_mcp_agents.join(", ")
        ));
    }

    if outcome.install_lsp_requested {
        if outcome.lsp_installed {
            if outcome.configured_lsp_agents.is_empty() {
                lines.push("MooseStack LSP installed.".to_string());
            } else {
                lines.push(format!(
                    "LSP configured: {}",
                    outcome.configured_lsp_agents.join(", ")
                ));
            }
        } else {
            lines.push("MooseStack LSP was requested but could not be installed.".to_string());
        }
    }

    if !outcome.plugin_agents.is_empty() {
        lines.push(format!(
            "Plugins installed: {}",
            outcome.plugin_agents.join(", ")
        ));
    }

    if !outcome.warnings.is_empty() {
        lines.push("Warnings:".to_string());
        lines.extend(
            outcome
                .warnings
                .iter()
                .map(|warning| format!("- {warning}")),
        );
    }

    lines.join("\n")
}

async fn load_skills(branch: &str) -> Result<Vec<SkillInfo>, RoutineFailure> {
    if let Ok(root) = std::env::var(LOCAL_SKILLS_DIR_ENV) {
        return discover_local_skills(Path::new(&root));
    }

    show_message!(
        MessageType::Info,
        Message::new(
            "Harness".to_string(),
            format!(
                "Fetching skills from github.com/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME} (branch: {branch})"
            ),
        )
    );

    let client = reqwest::Client::new();
    let tree = fetch_repo_tree(&client, branch).await?;
    discover_skills_from_tree(&tree)
}

async fn fetch_repo_tree(
    client: &reqwest::Client,
    branch: &str,
) -> Result<GitTreeResponse, RoutineFailure> {
    let response = client
        .get(format!(
            "https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/git/trees/{branch}?recursive=1"
        ))
        .header("User-Agent", format!("moose-cli/{CLI_VERSION}"))
        .header("Accept", "application/vnd.github.v3+json")
        .bearer_auth_opt(std::env::var("GITHUB_TOKEN").ok())
        .send()
        .await
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Harness".to_string(),
                format!("Failed to fetch skill catalog from GitHub: {e}"),
            ))
        })?;

    let status = response.status();
    let body = response.text().await.map_err(|e| {
        RoutineFailure::error(Message::new(
            "Harness".to_string(),
            format!("Failed to read GitHub response body: {e}"),
        ))
    })?;

    if !status.is_success() {
        return Err(RoutineFailure::error(Message::new(
            "Harness".to_string(),
            format!("GitHub skill catalog request failed with HTTP {status}: {body}"),
        )));
    }

    serde_json::from_str(&body).map_err(|e| {
        RoutineFailure::error(Message::new(
            "Harness".to_string(),
            format!("Failed to parse GitHub skill catalog: {e}"),
        ))
    })
}

fn discover_skills_from_tree(tree: &GitTreeResponse) -> Result<Vec<SkillInfo>, RoutineFailure> {
    let skill_dirs = tree
        .tree
        .iter()
        .filter(|entry| {
            entry.entry_type == "blob"
                && entry.path.starts_with(SKILLS_DIR_PREFIX)
                && entry.path.ends_with("/SKILL.md")
        })
        .filter_map(|entry| {
            let (dir, _) = entry.path.rsplit_once('/')?;
            let name = dir.strip_prefix(SKILLS_DIR_PREFIX)?;
            Some((dir.to_string(), name.to_string()))
        })
        .collect::<Vec<_>>();

    let mut seen = HashSet::new();
    let mut skills = Vec::new();

    for (repo_dir, name) in skill_dirs {
        if !seen.insert(name.clone()) {
            continue;
        }

        validate_relative_path(&name)?;

        let files = tree
            .tree
            .iter()
            .filter(|entry| {
                entry.entry_type == "blob"
                    && (entry.path.starts_with(&format!("{repo_dir}/")) || entry.path == repo_dir)
            })
            .map(|entry| {
                let relative_path = entry
                    .path
                    .strip_prefix(&format!("{repo_dir}/"))
                    .unwrap_or("SKILL.md");
                validate_relative_path(relative_path)?;
                Ok(SkillFileSpec {
                    relative_path: relative_path.to_string(),
                    source: SkillFileSource::GitHubPath(entry.path.clone()),
                })
            })
            .collect::<Result<Vec<_>, RoutineFailure>>()?;

        skills.push(SkillInfo { name, files });
    }

    skills.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(skills)
}

fn discover_local_skills(root: &Path) -> Result<Vec<SkillInfo>, RoutineFailure> {
    let skills_root = root.join("skills");
    if !skills_root.is_dir() {
        return Err(RoutineFailure::error(Message::new(
            "Harness".to_string(),
            format!(
                "Local skills override at {} does not contain a skills/ directory.",
                root.display()
            ),
        )));
    }

    let mut skill_dirs = Vec::new();
    collect_skill_dirs(&skills_root, &mut skill_dirs)?;
    skill_dirs.sort();

    let mut skills = Vec::new();
    for skill_dir in skill_dirs {
        let relative = skill_dir.strip_prefix(&skills_root).map_err(|e| {
            RoutineFailure::error(Message::new(
                "Harness".to_string(),
                format!("Failed to resolve local skill path: {e}"),
            ))
        })?;
        let name = relative
            .iter()
            .map(|component| component.to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");

        validate_relative_path(&name)?;

        let mut files = Vec::new();
        collect_skill_files(&skill_dir, &skill_dir, &mut files)?;
        files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

        skills.push(SkillInfo { name, files });
    }

    Ok(skills)
}

fn collect_skill_dirs(dir: &Path, output: &mut Vec<PathBuf>) -> Result<(), RoutineFailure> {
    for entry in std::fs::read_dir(dir).map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Harness".to_string(),
                format!("Failed to read local skills directory {}", dir.display()),
            ),
            e,
        )
    })? {
        let entry = entry.map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Harness".to_string(),
                    "Failed to inspect local skill entry".to_string(),
                ),
                e,
            )
        })?;

        if entry
            .file_type()
            .map_err(|e| {
                RoutineFailure::new(
                    Message::new(
                        "Harness".to_string(),
                        "Failed to inspect local skill file type".to_string(),
                    ),
                    e,
                )
            })?
            .is_dir()
        {
            let path = entry.path();
            if path.join("SKILL.md").is_file() {
                output.push(path);
            } else {
                collect_skill_dirs(&path, output)?;
            }
        }
    }

    Ok(())
}

fn collect_skill_files(
    root: &Path,
    dir: &Path,
    output: &mut Vec<SkillFileSpec>,
) -> Result<(), RoutineFailure> {
    for entry in std::fs::read_dir(dir).map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Harness".to_string(),
                format!("Failed to read local skill files in {}", dir.display()),
            ),
            e,
        )
    })? {
        let entry = entry.map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Harness".to_string(),
                    "Failed to inspect local skill file".to_string(),
                ),
                e,
            )
        })?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Harness".to_string(),
                    "Failed to inspect local skill file type".to_string(),
                ),
                e,
            )
        })?;

        if file_type.is_dir() {
            collect_skill_files(root, &path, output)?;
            continue;
        }

        let relative = path.strip_prefix(root).map_err(|e| {
            RoutineFailure::error(Message::new(
                "Harness".to_string(),
                format!("Failed to resolve relative skill file path: {e}"),
            ))
        })?;
        let relative_path = relative
            .iter()
            .map(|component| component.to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        validate_relative_path(&relative_path)?;

        output.push(SkillFileSpec {
            relative_path,
            source: SkillFileSource::LocalPath(path),
        });
    }

    Ok(())
}

async fn install_skill(
    skill: &SkillInfo,
    agents: &[&'static AgentInfo],
    home: &Path,
    branch: &str,
) -> Result<(), RoutineFailure> {
    let canonical_dir = canonical_skill_dir(home, &skill.name);
    std::fs::create_dir_all(&canonical_dir).map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Harness".to_string(),
                format!(
                    "Failed to create canonical skill directory {}",
                    canonical_dir.display()
                ),
            ),
            e,
        )
    })?;

    let mut client: Option<reqwest::Client> = None;
    for file in &skill.files {
        let destination = canonical_dir.join(&file.relative_path);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                RoutineFailure::new(
                    Message::new(
                        "Harness".to_string(),
                        format!(
                            "Failed to create skill parent directory {}",
                            parent.display()
                        ),
                    ),
                    e,
                )
            })?;
        }

        match &file.source {
            SkillFileSource::GitHubPath(repo_path) => {
                let client = client.get_or_insert_with(reqwest::Client::new);
                let data = download_raw_file(&client, branch, repo_path).await?;
                std::fs::write(&destination, data).map_err(|e| {
                    RoutineFailure::new(
                        Message::new(
                            "Harness".to_string(),
                            format!("Failed to write skill file {}", destination.display()),
                        ),
                        e,
                    )
                })?;
            }
            SkillFileSource::LocalPath(path) => {
                std::fs::copy(path, &destination).map_err(|e| {
                    RoutineFailure::new(
                        Message::new(
                            "Harness".to_string(),
                            format!("Failed to copy local skill file {}", path.display()),
                        ),
                        e,
                    )
                })?;
            }
        }
    }

    let link_name = flatten_skill_name(&skill.name);
    let mut linked_paths = HashSet::new();
    for agent in agents {
        let skill_root = agent.skill_root(home);
        std::fs::create_dir_all(&skill_root).map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Harness".to_string(),
                    format!(
                        "Failed to create agent skill directory {}",
                        skill_root.display()
                    ),
                ),
                e,
            )
        })?;

        let link_path = skill_root.join(&link_name);
        if linked_paths.insert(link_path.clone()) {
            remove_path_entry(&link_path)?;

            #[cfg(unix)]
            std::os::unix::fs::symlink(&canonical_dir, &link_path).map_err(|e| {
                RoutineFailure::new(
                    Message::new(
                        "Harness".to_string(),
                        format!("Failed to link skill into {}", link_path.display()),
                    ),
                    e,
                )
            })?;

            #[cfg(windows)]
            std::os::windows::fs::symlink_dir(&canonical_dir, &link_path).map_err(|e| {
                RoutineFailure::new(
                    Message::new(
                        "Harness".to_string(),
                        format!("Failed to link skill into {}", link_path.display()),
                    ),
                    e,
                )
            })?;
        }
    }

    Ok(())
}

async fn download_raw_file(
    client: &reqwest::Client,
    branch: &str,
    path: &str,
) -> Result<Vec<u8>, RoutineFailure> {
    let response = client
        .get(format!(
            "https://raw.githubusercontent.com/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/{branch}/{path}"
        ))
        .send()
        .await
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Harness".to_string(),
                format!("Failed to download skill file {path}: {e}"),
            ))
        })?;

    let status = response.status();
    if !status.is_success() {
        return Err(RoutineFailure::error(Message::new(
            "Harness".to_string(),
            format!("Failed to download skill file {path}: HTTP {status}"),
        )));
    }

    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Harness".to_string(),
                format!("Failed to read downloaded skill file {path}: {e}"),
            ))
        })
}

fn validate_relative_path(path: &str) -> Result<(), RoutineFailure> {
    if path.starts_with('/')
        || path.contains('\0')
        || path.split('/').any(|segment| segment == "..")
    {
        return Err(RoutineFailure::error(Message::new(
            "Harness".to_string(),
            format!("Unsafe skill path encountered: {path}"),
        )));
    }

    Ok(())
}

fn flatten_skill_name(name: &str) -> String {
    name.replace('/', "--")
}

fn canonical_skill_dir(home: &Path, skill_name: &str) -> PathBuf {
    home.join(".agents").join("skills").join(skill_name)
}

fn remove_path_entry(path: &Path) -> Result<(), RoutineFailure> {
    let metadata = match path.symlink_metadata() {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(RoutineFailure::new(
                Message::new(
                    "Harness".to_string(),
                    format!("Failed to inspect {}", path.display()),
                ),
                error,
            ))
        }
    };

    if metadata.file_type().is_symlink() {
        #[cfg(unix)]
        std::fs::remove_file(path).map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Harness".to_string(),
                    format!("Failed to remove {}", path.display()),
                ),
                e,
            )
        })?;
        #[cfg(windows)]
        std::fs::remove_dir(path).map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Harness".to_string(),
                    format!("Failed to remove {}", path.display()),
                ),
                e,
            )
        })?;
    } else if metadata.is_file() {
        std::fs::remove_file(path).map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Harness".to_string(),
                    format!("Failed to remove {}", path.display()),
                ),
                e,
            )
        })?;
    } else if metadata.is_dir() {
        std::fs::remove_dir_all(path).map_err(|e| {
            RoutineFailure::new(
                Message::new(
                    "Harness".to_string(),
                    format!("Failed to remove {}", path.display()),
                ),
                e,
            )
        })?;
    }

    Ok(())
}

fn emit_schema(json: bool) -> Result<RoutineSuccess, RoutineFailure> {
    let schema = serde_json::json!({
        "version": HARNESS_INIT_SCHEMA_VERSION,
        "interactive_default": {
            "enabled": true,
            "when": "no_cli_args"
        },
        "transports": [
            { "type": "file", "flag": "--input <path>" },
            { "type": "stdin", "flag": "--input -" }
        ],
        "precedence": "cli_flags_override_json",
        "template_discovery": "moose template list --json",
        "fields": {
            "version": {
                "type": "integer",
                "required": true,
                "enum": [HARNESS_INIT_SCHEMA_VERSION]
            },
            "name": {
                "type": "string",
                "required_when_non_interactive": true
            },
            "template": {
                "type": "string",
                "required_when_non_interactive": true
            },
            "location": {
                "type": "string",
                "required": false
            },
            "no_fail_already_exists": {
                "type": "boolean",
                "required": false,
                "default": false
            },
            "custom_dockerfile": {
                "type": "boolean",
                "required": false,
                "default": false
            },
            "from_remote": {
                "type": "string",
                "required": false
            },
            "agents": {
                "type": "array<string>",
                "required": false,
                "description": "Use [\"auto\"] to auto-detect or [\"none\"] to skip agent setup.",
                "items": {
                    "type": "string",
                    "enum": valid_agent_ids(),
                }
            },
            "install_lsp": {
                "type": "boolean",
                "required": false,
                "default": false
            },
            "branch": {
                "type": "string",
                "required": false,
                "default": DEFAULT_SKILLS_BRANCH
            }
        },
        "examples": [
            {
                "description": "non_interactive_project_with_codex",
                "request": {
                    "version": HARNESS_INIT_SCHEMA_VERSION,
                    "name": "my-app",
                    "template": "typescript",
                    "agents": ["codex"],
                    "install_lsp": false
                }
            }
        ]
    });

    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&schema).map_err(|e| {
                RoutineFailure::error(Message::new(
                    "Harness".to_string(),
                    format!("Failed to serialize schema: {e}"),
                ))
            })?
        );
    } else {
        println!("Machine-readable schema for `moose harness init`");
        println!();
        println!("Interactive mode:");
        println!("  Run `moose harness init` with no arguments to start the wizard.");
        println!();
        println!("Input sources:");
        println!("  --input <path>");
        println!("  --input -        Read JSON from stdin");
        println!();
        println!("Precedence: explicit CLI flags override JSON input");
        println!("Schema version: {HARNESS_INIT_SCHEMA_VERSION}");
        println!("Template discovery: moose template list --json");
        println!();
        println!("Supported agents:");
        println!("  {}", valid_agent_ids().join(", "));
        println!();
        println!("Invocation examples:");
        println!("  moose harness init");
        println!("  moose harness init my-app typescript --agent codex");
        println!("  moose harness init --input request.json");
        println!("  cat request.json | moose harness init --input -");
        println!("  moose harness init schema --json");
        println!();
        println!("Request payload example:");
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "version": HARNESS_INIT_SCHEMA_VERSION,
                "name": "my-app",
                "template": "typescript",
                "agents": ["codex"],
                "install_lsp": false,
            }))
            .map_err(|e| {
                RoutineFailure::error(Message::new(
                    "Harness".to_string(),
                    format!("Failed to serialize schema example: {e}"),
                ))
            })?
        );
    }

    Ok(RoutineSuccess::success(Message::new(
        String::new(),
        String::new(),
    )))
}

trait RequestBuilderAuthExt {
    fn bearer_auth_opt(self, token: Option<String>) -> Self;
}

impl RequestBuilderAuthExt for reqwest::RequestBuilder {
    fn bearer_auth_opt(self, token: Option<String>) -> Self {
        if let Some(token) = token {
            self.bearer_auth(token)
        } else {
            self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_agent_selection_accepts_auto_and_none() {
        assert!(matches!(
            resolve_agent_selection(vec!["auto".to_string()]).unwrap(),
            AgentSelection::AutoDetect
        ));
        assert!(matches!(
            resolve_agent_selection(vec!["none".to_string()]).unwrap(),
            AgentSelection::None
        ));
    }

    #[test]
    fn resolve_agent_selection_rejects_unknown_agent() {
        let error = resolve_agent_selection(vec!["not-real".to_string()]).unwrap_err();
        assert!(error.message.details.contains("Unknown agent"));
    }
}
