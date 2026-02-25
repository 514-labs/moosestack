use std::collections::HashMap;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;

use super::{display, templates, Message, MessageType};
use crate::cli::commands::AddComponent;
use crate::cli::prompt_user;
use crate::cli::routines::{RoutineFailure, RoutineSuccess};
use crate::framework::languages::SupportedLanguages;
use crate::project::Project;
use crate::utilities::constants::{CLI_VERSION, PYTHON_MAIN_FILE, TYPESCRIPT_MAIN_FILE};
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
    /// Component identifier, e.g. `"mcp-server"`.
    name: String,
    /// Must match the target project's language.
    language: SupportedLanguages,
    /// Template archive to download. Defaults to `name` (v1: each component has its own archive).
    template: Option<String>,
    /// Directory inside the unpacked archive where component files live, e.g. `"packages/web-app"`.
    base_path: Option<String>,
    /// Files to copy from the archive into the target project.
    files: Vec<FileEntry>,
    /// Export line appended to the moose entry file. `None` for non-moose components.
    moose_main_exports: Option<String>,
    /// Env vars to append to the target project's env files.
    env: Vec<EnvEntry>,
    /// npm packages to install.
    npm_deps: Vec<String>,
    /// shadcn/ui components to add. Requires `components.json` in the target directory.
    shadcn_components: Vec<String>,
    /// "Next steps" text printed after a successful install.
    docs: String,
}

pub async fn run_add(component: &AddComponent) -> Result<RoutineSuccess, RoutineFailure> {
    let (args, manifest) = match component {
        AddComponent::McpServer(args) => (
            args,
            load_manifest(include_str!("add/mcp-server/component.json"), "mcp-server")?,
        ),
        AddComponent::Chat(args) => (
            args,
            load_manifest(include_str!("add/chat/component.json"), "chat")?,
        ),
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
    let file_contents = fetch_component_files(&manifest).await?;
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

fn load_manifest(json: &str, component: &str) -> Result<ComponentManifest, RoutineFailure> {
    serde_json::from_str(json).map_err(|e| {
        RoutineFailure::error(Message::new(
            "Internal error".to_string(),
            format!("{component}/component.json is invalid: {e}"),
        ))
    })
}

fn fail(
    msg: impl Into<String>,
    detail: impl std::fmt::Display,
    e: std::io::Error,
) -> RoutineFailure {
    RoutineFailure::new(Message::new(msg.into(), detail.to_string()), e)
}

fn print_plan(manifest: &ComponentManifest) {
    show_message!(
        MessageType::Info,
        Message::new("Adding".to_string(), manifest.name.clone())
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
            show_message!(
                MessageType::Error,
                Message::new(
                    "Conflict".to_string(),
                    "These files already exist (use --overwrite to replace):".to_string(),
                )
            );
            display::write_detail_lines(&file_list);
            return Err(RoutineFailure::error(Message::new(
                "Aborted".to_string(),
                "No files were written.".to_string(),
            )));
        }

        show_message!(
            MessageType::Warning,
            Message::new(
                "Overwrite".to_string(),
                "These files will be replaced:".to_string(),
            )
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

/// Downloads the template archive, unpacks it into a temp dir, then reads the
/// files listed in the manifest into a `src → content` map.
async fn fetch_component_files(
    manifest: &ComponentManifest,
) -> Result<HashMap<String, String>, RoutineFailure> {
    let archive_name = manifest.template.as_deref().unwrap_or(&manifest.name);
    let base_path = manifest.base_path.as_deref().unwrap_or("");

    show_message!(
        MessageType::Info,
        Message::new(
            "Fetching".to_string(),
            format!("{archive_name} template...")
        )
    );

    let tmp = tempfile::tempdir().map_err(|e| {
        RoutineFailure::error(Message::new("Fetch failed".to_string(), e.to_string()))
    })?;

    templates::download_and_unpack(archive_name, CLI_VERSION, tmp.path())
        .await
        .map_err(|e| {
            RoutineFailure::error(Message::new(
                "Fetch failed".to_string(),
                format!("Could not download {archive_name}: {e}"),
            ))
        })?;

    let mut result = HashMap::new();
    for f in &manifest.files {
        let path = tmp.path().join(base_path).join(&f.src);
        let content = std::fs::read_to_string(&path).map_err(|e| {
            RoutineFailure::error(Message::new(
                "Fetch failed".to_string(),
                format!("'{}' not found in {archive_name} template: {e}", f.src),
            ))
        })?;
        result.insert(f.src.clone(), content);
    }

    Ok(result)
}

fn write_files(
    manifest: &ComponentManifest,
    file_contents: &HashMap<String, String>,
    target_dir: &Path,
) -> Result<(), RoutineFailure> {
    for f in &manifest.files {
        let content = file_contents.get(&f.src).ok_or_else(|| {
            RoutineFailure::error(Message::new(
                "Internal error".to_string(),
                format!("'{}' missing from fetched files", f.src),
            ))
        })?;

        let dest = target_dir.join(&f.dest);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| fail("Write failed", parent.display(), e))?;
        }
        std::fs::write(&dest, content).map_err(|e| fail("Write failed", dest.display(), e))?;
        show_message!(
            MessageType::Info,
            Message::new("Wrote".to_string(), f.dest.clone())
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

    show_message!(
        MessageType::Info,
        Message::new("Updated".to_string(), "moose main".to_string())
    );
    Ok(())
}

fn update_env_files(manifest: &ComponentManifest, target_dir: &Path) -> Result<(), RoutineFailure> {
    for entry in &manifest.env {
        let env_file = target_dir.join(&entry.file);
        append_env_var(&env_file, &entry.key, &entry.placeholder)
            .map_err(|e| fail("Update failed", &entry.file, e))?;
        show_message!(
            MessageType::Info,
            Message::new(
                "Updated".to_string(),
                format!("{} ({})", entry.file, entry.key),
            )
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

    let prefix = format!("{key}=");
    if existing.lines().any(|l| l.starts_with(&prefix)) {
        return Ok(());
    }

    let mut content = existing;
    if !content.ends_with('\n') && !content.is_empty() {
        content.push('\n');
    }
    content.push_str(&format!("{key}={placeholder}\n"));
    std::fs::write(path, content)
}

fn install_dependencies(
    manifest: &ComponentManifest,
    target_dir: &Path,
    pkg_manager: &PackageManager,
) -> Result<(), RoutineFailure> {
    if !manifest.shadcn_components.is_empty() {
        show_message!(
            MessageType::Info,
            Message::new("Installing".to_string(), "shadcn components...".to_string())
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
        show_message!(
            MessageType::Success,
            Message::new("Installed".to_string(), "shadcn components".to_string())
        );
    }

    if !manifest.npm_deps.is_empty() {
        show_message!(
            MessageType::Info,
            Message::new(
                "Installing".to_string(),
                format!("{} dependencies...", pkg_manager),
            )
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
        show_message!(
            MessageType::Success,
            Message::new("Installed".to_string(), "npm dependencies".to_string())
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
        return Err(std::io::Error::other(format!(
            "{} shadcn add exited with status {}",
            program, status
        )));
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
        return Err(std::io::Error::other(format!(
            "{} add exited with status {}",
            pkg_manager, status
        )));
    }
    Ok(())
}

fn print_next_steps(manifest: &ComponentManifest) {
    show_message!(
        MessageType::Success,
        Message::new("Next steps".to_string(), manifest.name.clone())
    );
    println!("\n{}", manifest.docs);
}
