use std::path::{Path, PathBuf};

use tracing::debug;

#[derive(Clone, Copy)]
pub(crate) enum JsonMcpFormat {
    HttpServers,
    RemoteServers,
    StdioBridge,
}

#[derive(Clone, Copy)]
pub(crate) enum ConfigTarget {
    HomeRelative(&'static str),
    VsCodeUserMcpJson,
}

impl ConfigTarget {
    pub(crate) fn resolve_paths(
        &self,
        home: &Path,
    ) -> Result<Vec<PathBuf>, Box<dyn std::error::Error>> {
        match self {
            Self::HomeRelative(path) => Ok(vec![home.join(path)]),
            Self::VsCodeUserMcpJson => collect_vscode_mcp_paths(&vscode_user_dir(home)?),
        }
    }
}

#[allow(clippy::enum_variant_names)]
pub(crate) enum McpConfig {
    JsonFile {
        target: ConfigTarget,
        key: Option<&'static str>,
        format: JsonMcpFormat,
    },
    TomlFile {
        target: ConfigTarget,
    },
    YamlFile {
        target: ConfigTarget,
    },
}

#[derive(Clone, Copy)]
pub(crate) enum LspPayload {
    OpenCode,
    Zed,
}

impl LspPayload {
    pub(crate) fn json(self) -> serde_json::Value {
        match self {
            Self::Zed => serde_json::json!({
                "moosestack-lsp": {
                    "binary": { "path": "moosestack-lsp", "arguments": ["--stdio"] }
                }
            }),
            Self::OpenCode => serde_json::json!({
                "moosestack": {
                    "command": ["moosestack-lsp", "--stdio"],
                    "extensions": [".ts", ".tsx", ".py"]
                }
            }),
        }
    }
}

pub(crate) enum LspConfig {
    JsonFile {
        target: ConfigTarget,
        key: &'static str,
        payload: LspPayload,
    },
}

#[derive(Clone, Copy)]
pub(crate) struct PluginCommand {
    pub(crate) description: &'static str,
    pub(crate) program: &'static str,
    pub(crate) args: &'static [&'static str],
}

pub(crate) struct PluginConfig {
    pub(crate) setup: &'static [PluginCommand],
    pub(crate) install: PluginCommand,
}

#[derive(Clone, Copy)]
enum DetectionStrategy {
    HomeRelativeDir(&'static str),
    VsCodeUserDir,
}

impl DetectionStrategy {
    fn exists(self, home: &Path) -> bool {
        match self {
            Self::HomeRelativeDir(path) => home.join(path).is_dir(),
            Self::VsCodeUserDir => match vscode_user_dir(home) {
                Ok(path) => path.is_dir(),
                Err(error) => {
                    debug!("Failed to resolve VS Code user directory: {error}");
                    false
                }
            },
        }
    }
}

pub(crate) struct AgentInfo {
    pub(crate) id: &'static str,
    pub(crate) display_name: &'static str,
    pub(crate) skills_dir: &'static str,
    detection: DetectionStrategy,
    location_hint: &'static str,
    pub(crate) user_scope_mcp: Option<McpConfig>,
    pub(crate) user_scope_lsp: Option<LspConfig>,
    pub(crate) plugin: Option<PluginConfig>,
}

impl AgentInfo {
    pub(crate) fn is_installed(&self, home: &Path) -> bool {
        self.detection.exists(home)
    }

    pub(crate) fn location_hint(&self) -> &'static str {
        self.location_hint
    }

    pub(crate) fn skill_root(&self, home: &Path) -> PathBuf {
        home.join(self.skills_dir)
    }
}

pub(crate) const AGENT_REGISTRY: &[AgentInfo] = &[
    AgentInfo {
        id: "claude-code",
        display_name: "Claude Code",
        skills_dir: ".claude/skills",
        detection: DetectionStrategy::HomeRelativeDir(".claude"),
        location_hint: "~/.claude",
        user_scope_mcp: Some(McpConfig::JsonFile {
            target: ConfigTarget::HomeRelative(".claude.json"),
            key: Some("mcpServers"),
            format: JsonMcpFormat::HttpServers,
        }),
        user_scope_lsp: None,
        plugin: Some(PluginConfig {
            setup: &[PluginCommand {
                description: "Claude Code marketplace setup",
                program: "claude",
                args: &[
                    "plugin",
                    "marketplace",
                    "add",
                    "514-labs/fiveonefour-marketplace",
                    "--scope",
                    "user",
                ],
            }],
            install: PluginCommand {
                description: "Claude Code plugin install",
                program: "claude",
                args: &[
                    "plugin",
                    "install",
                    "moosestack@fiveonefour-marketplace",
                    "--scope",
                    "user",
                ],
            },
        }),
    },
    AgentInfo {
        id: "cursor",
        display_name: "Cursor",
        skills_dir: ".cursor/skills",
        detection: DetectionStrategy::HomeRelativeDir(".cursor"),
        location_hint: "~/.cursor",
        user_scope_mcp: None,
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "vscode",
        display_name: "VS Code",
        skills_dir: ".vscode-copilot/skills",
        detection: DetectionStrategy::VsCodeUserDir,
        location_hint:
            "VS Code user config dir (mcp.json, path varies by OS) + ~/.vscode-copilot/skills",
        user_scope_mcp: Some(McpConfig::JsonFile {
            target: ConfigTarget::VsCodeUserMcpJson,
            key: Some("servers"),
            format: JsonMcpFormat::HttpServers,
        }),
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "copilot-cli",
        display_name: "GitHub Copilot CLI",
        skills_dir: ".copilot/skills",
        detection: DetectionStrategy::HomeRelativeDir(".copilot"),
        location_hint: "~/.copilot (skills + mcp-config.json)",
        user_scope_mcp: Some(McpConfig::JsonFile {
            target: ConfigTarget::HomeRelative(".copilot/mcp-config.json"),
            key: Some("mcpServers"),
            format: JsonMcpFormat::HttpServers,
        }),
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "kiro",
        display_name: "Kiro",
        skills_dir: ".kiro/skills",
        detection: DetectionStrategy::HomeRelativeDir(".kiro"),
        location_hint: "~/.kiro",
        user_scope_mcp: Some(McpConfig::JsonFile {
            target: ConfigTarget::HomeRelative(".kiro/settings/mcp.json"),
            key: Some("mcpServers"),
            format: JsonMcpFormat::RemoteServers,
        }),
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "windsurf",
        display_name: "Windsurf",
        skills_dir: ".codeium/windsurf/skills",
        detection: DetectionStrategy::HomeRelativeDir(".codeium/windsurf"),
        location_hint: "~/.codeium/windsurf",
        user_scope_mcp: None,
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "opencode",
        display_name: "OpenCode",
        skills_dir: ".opencode/skills",
        detection: DetectionStrategy::HomeRelativeDir(".opencode"),
        location_hint: "~/.opencode",
        user_scope_mcp: Some(McpConfig::JsonFile {
            target: ConfigTarget::HomeRelative(".config/opencode/opencode.json"),
            key: Some("mcp"),
            format: JsonMcpFormat::HttpServers,
        }),
        user_scope_lsp: Some(LspConfig::JsonFile {
            target: ConfigTarget::HomeRelative(".config/opencode/opencode.json"),
            key: "lsp",
            payload: LspPayload::OpenCode,
        }),
        plugin: None,
    },
    AgentInfo {
        id: "continue",
        display_name: "Continue",
        skills_dir: ".continue/skills",
        detection: DetectionStrategy::HomeRelativeDir(".continue"),
        location_hint: "~/.continue",
        user_scope_mcp: Some(McpConfig::YamlFile {
            target: ConfigTarget::HomeRelative(".continue/config.yaml"),
        }),
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "cline",
        display_name: "Cline",
        skills_dir: ".cline/skills",
        detection: DetectionStrategy::HomeRelativeDir(".cline"),
        location_hint: "~/.cline",
        user_scope_mcp: None,
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "codex",
        display_name: "Codex",
        skills_dir: ".codex/skills",
        detection: DetectionStrategy::HomeRelativeDir(".codex"),
        location_hint: "~/.codex",
        user_scope_mcp: Some(McpConfig::TomlFile {
            target: ConfigTarget::HomeRelative(".codex/config.toml"),
        }),
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "amp",
        display_name: "Amp",
        skills_dir: ".amp/skills",
        detection: DetectionStrategy::HomeRelativeDir(".amp"),
        location_hint: "~/.amp",
        user_scope_mcp: None,
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "aider",
        display_name: "Aider",
        skills_dir: ".aider/skills",
        detection: DetectionStrategy::HomeRelativeDir(".aider"),
        location_hint: "~/.aider",
        user_scope_mcp: None,
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "roo-code",
        display_name: "Roo Code",
        skills_dir: ".roo-cline/skills",
        detection: DetectionStrategy::HomeRelativeDir(".roo-cline"),
        location_hint: "~/.roo-cline",
        user_scope_mcp: None,
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "zed",
        display_name: "Zed",
        skills_dir: ".zed/skills",
        detection: DetectionStrategy::HomeRelativeDir(".zed"),
        location_hint: "~/.zed",
        user_scope_mcp: Some(McpConfig::JsonFile {
            target: ConfigTarget::HomeRelative(".config/zed/settings.json"),
            key: Some("context_servers"),
            format: JsonMcpFormat::StdioBridge,
        }),
        user_scope_lsp: Some(LspConfig::JsonFile {
            target: ConfigTarget::HomeRelative(".config/zed/settings.json"),
            key: "lsp",
            payload: LspPayload::Zed,
        }),
        plugin: None,
    },
    AgentInfo {
        id: "augment-code",
        display_name: "Augment Code",
        skills_dir: ".augment-code/skills",
        detection: DetectionStrategy::HomeRelativeDir(".augment-code"),
        location_hint: "~/.augment-code",
        user_scope_mcp: None,
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "trae",
        display_name: "Trae",
        skills_dir: ".trae/skills",
        detection: DetectionStrategy::HomeRelativeDir(".trae"),
        location_hint: "~/.trae",
        user_scope_mcp: None,
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "kilo-code",
        display_name: "Kilo Code",
        skills_dir: ".kilocode/skills",
        detection: DetectionStrategy::HomeRelativeDir(".kilocode"),
        location_hint: "~/.kilocode",
        user_scope_mcp: None,
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "void",
        display_name: "Void",
        skills_dir: ".void/skills",
        detection: DetectionStrategy::HomeRelativeDir(".void"),
        location_hint: "~/.void",
        user_scope_mcp: None,
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "pearai",
        display_name: "PearAI",
        skills_dir: ".pearai/skills",
        detection: DetectionStrategy::HomeRelativeDir(".pearai"),
        location_hint: "~/.pearai",
        user_scope_mcp: Some(McpConfig::YamlFile {
            target: ConfigTarget::HomeRelative(".pearai/config.yaml"),
        }),
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "melty",
        display_name: "Melty",
        skills_dir: ".melty/skills",
        detection: DetectionStrategy::HomeRelativeDir(".melty"),
        location_hint: "~/.melty",
        user_scope_mcp: None,
        user_scope_lsp: None,
        plugin: None,
    },
    AgentInfo {
        id: "supermaven",
        display_name: "Supermaven",
        skills_dir: ".supermaven/skills",
        detection: DetectionStrategy::HomeRelativeDir(".supermaven"),
        location_hint: "~/.supermaven",
        user_scope_mcp: None,
        user_scope_lsp: None,
        plugin: None,
    },
];

pub(crate) fn detect_installed_agents(home: &Path) -> Vec<&'static AgentInfo> {
    AGENT_REGISTRY
        .iter()
        .filter(|agent| agent.is_installed(home))
        .collect()
}

pub(crate) fn find_agent_by_id(id: &str) -> Option<&'static AgentInfo> {
    AGENT_REGISTRY.iter().find(|agent| agent.id == id)
}

fn vscode_user_dir(home: &Path) -> Result<PathBuf, Box<dyn std::error::Error>> {
    Ok(user_config_dir(home)?.join("Code").join("User"))
}

fn user_config_dir(home: &Path) -> Result<PathBuf, Box<dyn std::error::Error>> {
    #[cfg(target_os = "windows")]
    {
        return std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| "Could not determine APPDATA".into());
    }

    #[cfg(target_os = "macos")]
    {
        Ok(home.join("Library").join("Application Support"))
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Ok(std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config")))
    }
}

fn collect_vscode_mcp_paths(user_dir: &Path) -> Result<Vec<PathBuf>, Box<dyn std::error::Error>> {
    let mut paths = vec![user_dir.join("mcp.json")];
    let profiles_dir = user_dir.join("profiles");
    if profiles_dir.is_dir() {
        for entry in std::fs::read_dir(&profiles_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let profile_mcp = entry.path().join("mcp.json");
                if profile_mcp.exists() {
                    paths.push(profile_mcp);
                }
            }
        }
    }
    paths.sort();
    paths.dedup();
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_collect_vscode_mcp_paths_includes_default_and_existing_profiles() {
        let tmp = TempDir::new().unwrap();
        let user_dir = tmp.path().join("Code").join("User");
        std::fs::create_dir_all(user_dir.join("profiles").join("alpha")).unwrap();
        std::fs::create_dir_all(user_dir.join("profiles").join("beta")).unwrap();
        std::fs::write(
            user_dir.join("profiles").join("alpha").join("mcp.json"),
            "{}",
        )
        .unwrap();

        let paths = collect_vscode_mcp_paths(&user_dir).unwrap();

        assert!(paths.contains(&user_dir.join("mcp.json")));
        assert!(paths.contains(&user_dir.join("profiles").join("alpha").join("mcp.json")));
        assert!(!paths.contains(&user_dir.join("profiles").join("beta").join("mcp.json")));
    }

    #[test]
    fn test_find_copilot_cli_agent_by_id() {
        let agent = find_agent_by_id("copilot-cli").unwrap();
        assert_eq!(agent.id, "copilot-cli");
    }
}
