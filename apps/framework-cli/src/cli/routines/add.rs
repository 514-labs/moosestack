use std::collections::HashMap;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;

use super::{display, Message, MessageType};
use crate::cli::commands::AddComponent;
use crate::cli::prompt_user;
use crate::cli::routines::{RoutineFailure, RoutineSuccess};
use crate::framework::languages::SupportedLanguages;
use crate::project::Project;
use crate::utilities::constants::{PYTHON_MAIN_FILE, TYPESCRIPT_MAIN_FILE};
use crate::utilities::dotenv::MooseEnvironment;
use crate::utilities::package_managers::{detect_package_manager, PackageManager};
use config::ConfigError;

#[derive(Deserialize)]
struct FileEntry {
    src: String,
    dest: String,
}

#[derive(Deserialize)]
struct EnvEntry {
    file: String,
    key: String,
    placeholder: String,
}

#[derive(Deserialize)]
struct ComponentManifest {
    name: String,
    language: SupportedLanguages,
    files: Vec<FileEntry>,
    moose_main_exports: Option<String>,
    env: Vec<EnvEntry>,
    npm_deps: Vec<String>,
    shadcn_components: Vec<String>,
    docs: String,
}

pub fn run_add(component: &AddComponent) -> Result<RoutineSuccess, RoutineFailure> {
    let (args, (manifest, file_contents)) = match component {
        AddComponent::McpServer(args) => (args, mcp_server_registry()?),
        AddComponent::Chat(args) => (args, chat_registry()?),
    };

    let target_dir = match args.dir.as_deref() {
        Some(d) => PathBuf::from(d),
        None => std::env::current_dir()
            .map_err(|e| fail("Failed to get current directory", e.to_string(), e))?,
    };

    if !target_dir.exists() {
        return Err(RoutineFailure::error(Message::new(
            "Not found".to_string(),
            target_dir.display().to_string(),
        )));
    }

    let pkg_manager = detect_package_manager(&target_dir);

    print_plan(&manifest);
    println!();
    preflight_checks(&manifest, &target_dir, &pkg_manager)?;
    confirm_plan(&manifest, &target_dir, args.overwrite, args.yes)?;
    println!();
    write_files(&manifest, &file_contents, &target_dir)?;
    update_moose_entry(&manifest, &target_dir)?;
    update_env_files(&manifest, &target_dir)?;
    install_dependencies(&manifest, &target_dir, &pkg_manager)?;
    println!();
    print_next_steps(&manifest);

    Ok(RoutineSuccess::success(Message::new(
        "Done".to_string(),
        format!("{} installed successfully", manifest.name),
    )))
}

fn fail(
    msg: impl Into<String>,
    detail: impl std::fmt::Display,
    e: std::io::Error,
) -> RoutineFailure {
    RoutineFailure::new(Message::new(msg.into(), detail.to_string()), e)
}

fn print_plan(manifest: &ComponentManifest) {
    display::show_message_wrapper(
        MessageType::Info,
        Message::new("Adding".to_string(), manifest.name.clone()),
    );

    let file_dests: Vec<String> = manifest.files.iter().map(|f| f.dest.clone()).collect();
    display::infrastructure::infra_added_detailed("Files", &file_dests);

    if !manifest.env.is_empty() {
        let env_lines: Vec<String> = manifest
            .env
            .iter()
            .map(|e| format!("{} \u{2192} {}", e.file, e.key))
            .collect();
        display::infrastructure::infra_added_detailed("Env vars", &env_lines);
    }

    if !manifest.npm_deps.is_empty() {
        display::infrastructure::infra_added_detailed("Dependencies", &manifest.npm_deps);
    }

    if !manifest.shadcn_components.is_empty() {
        display::infrastructure::infra_added_detailed(
            "Shadcn components",
            &manifest.shadcn_components,
        );
    }
}

fn preflight_checks(
    manifest: &ComponentManifest,
    target_dir: &Path,
    pkg_manager: &PackageManager,
) -> Result<(), RoutineFailure> {
    if manifest.moose_main_exports.is_some() {
        let target_dir_buf = target_dir.to_path_buf();
        let project =
            Project::load(&target_dir_buf, MooseEnvironment::Development).map_err(|e| match e {
                ConfigError::Foreign(_) => RoutineFailure::error(Message::new(
                    "Wrong directory".to_string(),
                    format!(
                        "No moose.config.toml found in {}.\nThis component modifies the moose entry file, use --dir to specify a moose project.",
                        target_dir.display()
                    ),
                )),
                _ => RoutineFailure::error(Message::new(
                    "Loading".to_string(),
                    format!(
                        "Could not load moose project from {}: {:?}",
                        target_dir.display(),
                        e
                    ),
                )),
            })?;

        if project.language != manifest.language {
            return Err(RoutineFailure::error(Message::new(
                "Lang mismatch".to_string(),
                format!(
                    "This component requires {} but your project uses {}.",
                    manifest.language, project.language
                ),
            )));
        }
    }

    if !manifest.shadcn_components.is_empty() && !target_dir.join("components.json").exists() {
        let init_cmd = match pkg_manager {
            PackageManager::Pnpm => "pnpm dlx shadcn@latest init",
            PackageManager::Npm => "npx shadcn@latest init",
        };
        return Err(RoutineFailure::error(Message::new(
            "Shadcn required".to_string(),
            format!(
                "No components.json found in {}.\nRun: {}",
                target_dir.display(),
                init_cmd
            ),
        )));
    }

    Ok(())
}

/// Prompts the user to confirm the plan before executing.
/// If there are conflicts and `--overwrite` is not set, errors immediately.
/// If there are conflicts and `--overwrite` is set, warns which files will be replaced.
/// Skips the prompt when `--yes` is set or stdin is not a TTY.
fn confirm_plan(
    manifest: &ComponentManifest,
    target_dir: &Path,
    overwrite: bool,
    yes: bool,
) -> Result<(), RoutineFailure> {
    let conflicts: Vec<&str> = manifest
        .files
        .iter()
        .filter(|f| target_dir.join(&f.dest).exists())
        .map(|f| f.dest.as_str())
        .collect();

    if !conflicts.is_empty() {
        let file_list: Vec<String> = conflicts.iter().map(|f| f.to_string()).collect();

        if !overwrite {
            display::show_message_wrapper(
                MessageType::Error,
                Message::new(
                    "Conflict".to_string(),
                    "These files already exist (use --overwrite to replace):".to_string(),
                ),
            );
            display::write_detail_lines(&file_list);
            return Err(RoutineFailure::error(Message::new(
                "Aborted".to_string(),
                "No files were written.".to_string(),
            )));
        }

        display::show_message_wrapper(
            MessageType::Warning,
            Message::new(
                "Overwrite".to_string(),
                "These files will be replaced:".to_string(),
            ),
        );
        display::write_detail_lines(&file_list);
    }

    if yes || !std::io::stdin().is_terminal() {
        return Ok(());
    }

    let input = prompt_user("Proceed? [y/N]", Some("N"), None)?;
    if !matches!(input.trim().to_lowercase().as_str(), "y" | "yes") {
        return Err(RoutineFailure::error(Message::new(
            "Cancelled".to_string(),
            "No files were written.".to_string(),
        )));
    }

    Ok(())
}

fn write_files(
    manifest: &ComponentManifest,
    file_contents: &HashMap<&str, &str>,
    target_dir: &Path,
) -> Result<(), RoutineFailure> {
    for f in &manifest.files {
        let content = file_contents.get(f.src.as_str()).ok_or_else(|| {
            RoutineFailure::error(Message::new(
                "Internal error".to_string(),
                format!(
                    "'{}' is in component.json but not embedded in the component",
                    f.src
                ),
            ))
        })?;

        let dest = target_dir.join(&f.dest);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| fail("Write failed", parent.display(), e))?;
        }
        std::fs::write(&dest, content).map_err(|e| fail("Write failed", dest.display(), e))?;
        display::show_message_wrapper(
            MessageType::Info,
            Message::new("Wrote".to_string(), f.dest.clone()),
        );
    }
    Ok(())
}

/// No-op when `moose_main_exports` is absent. Validation already done in preflight.
fn update_moose_entry(
    manifest: &ComponentManifest,
    target_dir: &Path,
) -> Result<(), RoutineFailure> {
    let Some(ref line) = manifest.moose_main_exports else {
        return Ok(());
    };

    let project =
        Project::load(&target_dir.to_path_buf(), MooseEnvironment::Development).map_err(|e| {
            RoutineFailure::error(Message::new(
                "Loading".to_string(),
                format!(
                    "Could not load moose project from {}: {:?}",
                    target_dir.display(),
                    e
                ),
            ))
        })?;

    let entry_file =
        project
            .project_location
            .join(&project.source_dir)
            .join(match manifest.language {
                SupportedLanguages::Typescript => TYPESCRIPT_MAIN_FILE,
                SupportedLanguages::Python => PYTHON_MAIN_FILE,
            });

    append_if_absent(&entry_file, line)
        .map_err(|e| fail("Update failed", entry_file.display(), e))?;

    display::show_message_wrapper(
        MessageType::Info,
        Message::new("Updated".to_string(), "moose main".to_string()),
    );
    Ok(())
}

fn update_env_files(manifest: &ComponentManifest, target_dir: &Path) -> Result<(), RoutineFailure> {
    for entry in &manifest.env {
        let env_file = target_dir.join(&entry.file);
        append_env_var(&env_file, &entry.key, &entry.placeholder)
            .map_err(|e| fail("Update failed", &entry.file, e))?;
        display::show_message_wrapper(
            MessageType::Info,
            Message::new(
                "Updated".to_string(),
                format!("{} ({})", entry.file, entry.key),
            ),
        );
    }
    Ok(())
}

/// Appends `line` to `path` if not already present. Creates the file if needed.
fn append_if_absent(path: &Path, line: &str) -> std::io::Result<()> {
    let existing = if path.exists() {
        std::fs::read_to_string(path)?
    } else {
        String::new()
    };

    if existing.lines().any(|l| l.trim() == line.trim()) {
        return Ok(());
    }

    let mut content = existing;
    if !content.ends_with('\n') && !content.is_empty() {
        content.push('\n');
    }
    content.push_str(line);
    content.push('\n');
    std::fs::write(path, content)
}

/// Appends `KEY=placeholder` to `path` if no `KEY=` line exists. Creates the file if needed.
fn append_env_var(path: &Path, key: &str, placeholder: &str) -> std::io::Result<()> {
    let existing = if path.exists() {
        std::fs::read_to_string(path)?
    } else {
        String::new()
    };

    let prefix = format!("{}=", key);
    if existing.lines().any(|l| l.starts_with(&prefix)) {
        return Ok(());
    }

    let mut content = existing;
    if !content.ends_with('\n') && !content.is_empty() {
        content.push('\n');
    }
    content.push_str(&format!("{}={}\n", key, placeholder));
    std::fs::write(path, content)
}

fn install_dependencies(
    manifest: &ComponentManifest,
    target_dir: &Path,
    pkg_manager: &PackageManager,
) -> Result<(), RoutineFailure> {
    if !manifest.shadcn_components.is_empty() {
        display::show_message_wrapper(
            MessageType::Info,
            Message::new("Installing".to_string(), "shadcn components...".to_string()),
        );
        let shadcn: Vec<&str> = manifest
            .shadcn_components
            .iter()
            .map(String::as_str)
            .collect();
        run_shadcn_add(target_dir, &shadcn, pkg_manager).map_err(|e| {
            let add_cmd = match pkg_manager {
                PackageManager::Pnpm => "pnpm dlx shadcn add",
                PackageManager::Npm => "npx shadcn add",
            };
            fail(
                "Install failed",
                format!(
                    "Run manually: {} {}",
                    add_cmd,
                    manifest.shadcn_components.join(" ")
                ),
                e,
            )
        })?;
        display::show_message_wrapper(
            MessageType::Success,
            Message::new("Installed".to_string(), "shadcn components".to_string()),
        );
    }

    if !manifest.npm_deps.is_empty() {
        display::show_message_wrapper(
            MessageType::Info,
            Message::new(
                "Installing".to_string(),
                format!("{} dependencies...", pkg_manager),
            ),
        );
        let deps: Vec<&str> = manifest.npm_deps.iter().map(String::as_str).collect();
        run_pkg_add(target_dir, &deps, pkg_manager).map_err(|e| {
            fail(
                "Install failed",
                format!(
                    "Run manually: {} add {}",
                    pkg_manager,
                    manifest.npm_deps.join(" ")
                ),
                e,
            )
        })?;
        display::show_message_wrapper(
            MessageType::Success,
            Message::new("Installed".to_string(), "npm dependencies".to_string()),
        );
    }
    Ok(())
}

fn run_shadcn_add(
    dir: &Path,
    components: &[&str],
    pkg_manager: &PackageManager,
) -> std::io::Result<()> {
    let (program, args): (&str, &[&str]) = match pkg_manager {
        PackageManager::Pnpm => ("pnpm", &["dlx", "shadcn@latest", "add"]),
        PackageManager::Npm => ("npx", &["shadcn@latest", "add"]),
    };

    let status = Command::new(program)
        .args(args)
        .args(components)
        .arg("--yes")
        .current_dir(dir)
        .status()?;

    if !status.success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("{} shadcn add exited with status {}", program, status),
        ));
    }
    Ok(())
}

fn run_pkg_add(dir: &Path, packages: &[&str], pkg_manager: &PackageManager) -> std::io::Result<()> {
    let status = Command::new(pkg_manager.to_string())
        .arg("add")
        .args(packages)
        .current_dir(dir)
        .status()?;

    if !status.success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("{} add exited with status {}", pkg_manager, status),
        ));
    }
    Ok(())
}

fn print_next_steps(manifest: &ComponentManifest) {
    display::show_message_wrapper(
        MessageType::Success,
        Message::new("Next steps".to_string(), manifest.name.clone()),
    );
    println!("\n{}", manifest.docs);
}

// ── Embedded component registries (v0 — temporary) ───────────────────────────
//
// Each component directory contains:
//   component.json  – the manifest (declares files, deps, env vars, docs)
//   <source files>  – the actual component source code to be copied
//
// Both the manifest and all source files are embedded into the binary at
// compile time via include_str!. The manifest's `src` field is used as a key
// to look up the right embedded content at runtime.
//
// This is a v0 approach. Because include_str! requires string literals, every
// file must be listed here manually — component.json and this are kept
// in sync by hand.
//
// v1 goal: reuse the template packaging infrastructure (the same GCS-hosted
// .tgz files that `moose init` downloads). The CLI will fetch a component
// archive at runtime instead of embedding files at compile time, so
// component.json becomes the single source of truth and this goes away.

const MCP_SERVER_FILES: &[(&str, &str)] = &[("mcp.ts", include_str!("add/mcp-server/mcp.ts"))];

const CHAT_FILES: &[(&str, &str)] = &[
    ("env-vars.ts", include_str!("add/chat/env-vars.ts")),
    (
        "hooks/use-mobile.ts",
        include_str!("add/chat/hooks/use-mobile.ts"),
    ),
    (
        "app/api/chat/route.ts",
        include_str!("add/chat/app/api/chat/route.ts"),
    ),
    (
        "app/api/chat/status/route.ts",
        include_str!("add/chat/app/api/chat/status/route.ts"),
    ),
    (
        "components/layout/chat-layout-wrapper.tsx",
        include_str!("add/chat/components/layout/chat-layout-wrapper.tsx"),
    ),
    (
        "components/layout/content-header.tsx",
        include_str!("add/chat/components/layout/content-header.tsx"),
    ),
    (
        "components/layout/resizable-chat-layout.tsx",
        include_str!("add/chat/components/layout/resizable-chat-layout.tsx"),
    ),
    (
        "features/chat/agent-config.ts",
        include_str!("add/chat/features/chat/agent-config.ts"),
    ),
    (
        "features/chat/chat-button.tsx",
        include_str!("add/chat/features/chat/chat-button.tsx"),
    ),
    (
        "features/chat/chat-input.tsx",
        include_str!("add/chat/features/chat/chat-input.tsx"),
    ),
    (
        "features/chat/chat-output-area.tsx",
        include_str!("add/chat/features/chat/chat-output-area.tsx"),
    ),
    (
        "features/chat/chat-ui.tsx",
        include_str!("add/chat/features/chat/chat-ui.tsx"),
    ),
    (
        "features/chat/clickhouse-tool-invocation.tsx",
        include_str!("add/chat/features/chat/clickhouse-tool-invocation.tsx"),
    ),
    (
        "features/chat/code-block.tsx",
        include_str!("add/chat/features/chat/code-block.tsx"),
    ),
    (
        "features/chat/get-agent-response.ts",
        include_str!("add/chat/features/chat/get-agent-response.ts"),
    ),
    (
        "features/chat/reasoning-section.tsx",
        include_str!("add/chat/features/chat/reasoning-section.tsx"),
    ),
    (
        "features/chat/source-section.tsx",
        include_str!("add/chat/features/chat/source-section.tsx"),
    ),
    (
        "features/chat/suggested-prompt.tsx",
        include_str!("add/chat/features/chat/suggested-prompt.tsx"),
    ),
    (
        "features/chat/system-prompt.ts",
        include_str!("add/chat/features/chat/system-prompt.ts"),
    ),
    (
        "features/chat/text-formatter.tsx",
        include_str!("add/chat/features/chat/text-formatter.tsx"),
    ),
    (
        "features/chat/tool-data-catalog.tsx",
        include_str!("add/chat/features/chat/tool-data-catalog.tsx"),
    ),
    (
        "features/chat/tool-invocation.tsx",
        include_str!("add/chat/features/chat/tool-invocation.tsx"),
    ),
    (
        "features/chat/use-anthropic-status.ts",
        include_str!("add/chat/features/chat/use-anthropic-status.ts"),
    ),
    (
        "components/theme-toggle.tsx",
        include_str!("add/chat/components/theme-toggle.tsx"),
    ),
    (
        "components/ui/resizable.tsx",
        include_str!("add/chat/components/ui/resizable.tsx"),
    ),
];

fn mcp_server_registry(
) -> Result<(ComponentManifest, HashMap<&'static str, &'static str>), RoutineFailure> {
    let manifest: ComponentManifest =
        serde_json::from_str(include_str!("add/mcp-server/component.json")).map_err(|e| {
            RoutineFailure::error(Message::new(
                "Internal error".to_string(),
                format!("mcp-server component.json is invalid: {}", e),
            ))
        })?;
    Ok((manifest, MCP_SERVER_FILES.iter().cloned().collect()))
}

fn chat_registry(
) -> Result<(ComponentManifest, HashMap<&'static str, &'static str>), RoutineFailure> {
    let manifest: ComponentManifest = serde_json::from_str(include_str!("add/chat/component.json"))
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Internal error".to_string(),
                format!("chat component.json is invalid: {}", e),
            ))
        })?;
    Ok((manifest, CHAT_FILES.iter().cloned().collect()))
}
