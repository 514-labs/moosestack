/// # Component Commands (`moose add`, `moose component list`)
///
/// Installs a pre-built component into an existing project (`moose add`) and lists
/// available components (`moose component list`). Each component is described by a
/// `component.toml` manifest that declares which files to copy, which env vars to
/// append, and which npm/shadcn dependencies to install.
///
/// ## Architecture note — why manifests are embedded
///
/// Components are not yet standalone archives in the registry. Until they are, manifests
/// are baked into the binary via `include_str!` and component files are extracted from a
/// shared template archive (e.g. `typescript-mcp.tgz`) using the `template` and
/// `base_path` fields.
///
/// When each component ships its own archive (zip containing `component.toml` + source
/// files), the flow will mirror `moose init`: fetch a registry manifest → download the
/// component zip → read `component.toml` from inside it. At that point `include_str!`,
/// `template`, and `base_path` can all be dropped.
use std::collections::HashMap;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;

use super::{display, templates, Message, MessageType};
use crate::cli::commands::{AddArgs, AddComponent};
use crate::cli::prompt_user;
use crate::cli::routines::{RoutineFailure, RoutineSuccess};
use crate::framework::languages::SupportedLanguages;
use crate::project::Project;
use crate::utilities::constants::CLI_VERSION;
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

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum ComponentKind {
    /// Installed into a Moose project. Validates language and resolves `{{source_dir}}` in paths.
    Moose,
    /// Installed into a Next.js app. Requires shadcn to be initialized.
    Nextjs,
}

#[derive(Deserialize)]
struct ComponentManifest {
    /// Component identifier.
    name: String,
    /// One-line description shown in `moose component list`.
    description: String,
    /// Whether this targets a Moose project, Next.js app, etc.
    kind: ComponentKind,
    /// Language this component targets.
    language: SupportedLanguages,
    /// Template archive to download. Defaults to `name` (v1: each component has its own archive).
    template: Option<String>,
    /// Directory inside the unpacked archive where component files live.
    base_path: Option<String>,
    /// Files to copy from the archive into the target project.
    files: Vec<FileEntry>,
    /// Env vars to append to the target project's env files.
    env: Vec<EnvEntry>,
    /// npm packages to install.
    npm_deps: Vec<String>,
    /// shadcn/ui components to add. Requires `components.json` in the target directory.
    shadcn_components: Vec<String>,
    /// Export lines to append to the Moose entry file
    moose_exports: Vec<String>,
    /// "Next steps" text printed after a successful install.
    docs: String,
}

/// Entry point for `moose add`. Loads the manifest and dispatches to the appropriate
/// kind-specific flow.
pub async fn add_component(component: &AddComponent) -> Result<RoutineSuccess, RoutineFailure> {
    let (args, manifest) = match component {
        AddComponent::McpServer(args) => (
            args,
            load_manifest(
                include_str!("components/mcp-server/component.toml"),
                "mcp-server",
            )?,
        ),
        AddComponent::Chat(args) => (
            args,
            load_manifest(include_str!("components/chat/component.toml"), "chat")?,
        ),
    };

    let target_dir = resolve_target_dir(args.dir.as_deref())?;
    let pkg_manager = detect_package_manager(&target_dir);

    match manifest.kind {
        ComponentKind::Moose => run_add_moose(manifest, args, target_dir, pkg_manager).await,
        ComponentKind::Nextjs => run_add_nextjs(manifest, args, target_dir, pkg_manager).await,
    }
}

/// Prints all available components to stdout. Used by `moose component list`.
pub fn list_components(cli_version: &str) -> Result<RoutineSuccess, RoutineFailure> {
    // Components don't have standalone registry archives yet, so manifests are embedded
    // in the binary. Once each component ships its own zip, this will fetch a registry
    // manifest instead (same pattern as `moose template list`).
    let components = [
        load_manifest(
            include_str!("components/mcp-server/component.toml"),
            "mcp-server",
        )?,
        load_manifest(include_str!("components/chat/component.toml"), "chat")?,
    ];

    let lines: Vec<String> = components
        .iter()
        .map(|m| {
            let lang = match m.language {
                SupportedLanguages::Typescript => "typescript",
                SupportedLanguages::Python => "python",
            };
            format!("  - {} ({}) - {}", m.name, lang, m.description)
        })
        .collect();

    let output = format!(
        "Available components for version {}:\n{}",
        cli_version,
        lines.join("\n")
    );

    Ok(RoutineSuccess::success(Message::new(
        "Components".to_string(),
        output,
    )))
}

async fn run_add_moose(
    manifest: ComponentManifest,
    args: &AddArgs,
    target_dir: PathBuf,
    pkg_manager: PackageManager,
) -> Result<RoutineSuccess, RoutineFailure> {
    let source_dir = resolve_moose_source_dir(&manifest, &target_dir)?;

    print_plan(&manifest, &target_dir, Some(&source_dir));
    println!();
    confirm_plan(
        &manifest,
        &target_dir,
        Some(&source_dir),
        args.overwrite,
        args.yes,
    )?;
    println!();
    let file_contents = fetch_component_files(&manifest).await?;
    write_files(&manifest, &file_contents, &target_dir, Some(&source_dir))?;
    update_env_files(&manifest, &target_dir)?;
    append_moose_exports(
        &target_dir,
        &source_dir,
        &manifest.language,
        &manifest.moose_exports,
    )?;
    install_dependencies(&manifest, &target_dir, &pkg_manager)?;
    println!();
    print_next_steps(&manifest);

    Ok(RoutineSuccess::success(Message::new(
        "Done".to_string(),
        format!("{} installed successfully", manifest.name),
    )))
}

async fn run_add_nextjs(
    manifest: ComponentManifest,
    args: &AddArgs,
    target_dir: PathBuf,
    pkg_manager: PackageManager,
) -> Result<RoutineSuccess, RoutineFailure> {
    check_nextjs_project(&target_dir)?;
    check_shadcn_initialized(&target_dir, &pkg_manager)?;

    print_plan(&manifest, &target_dir, None);
    println!();
    confirm_plan(&manifest, &target_dir, None, args.overwrite, args.yes)?;
    println!();
    let file_contents = fetch_component_files(&manifest).await?;
    write_files(&manifest, &file_contents, &target_dir, None)?;
    update_env_files(&manifest, &target_dir)?;
    install_dependencies(&manifest, &target_dir, &pkg_manager)?;
    println!();
    print_next_steps(&manifest);

    Ok(RoutineSuccess::success(Message::new(
        "Done".to_string(),
        format!("{} installed successfully", manifest.name),
    )))
}

fn resolve_target_dir(dir: Option<&str>) -> Result<PathBuf, RoutineFailure> {
    let target_dir = match dir {
        Some(d) => PathBuf::from(d).canonicalize().map_err(|e| {
            fail(
                "Not found",
                format!("{d} does not exist or is not accessible"),
                e,
            )
        })?,
        None => std::env::current_dir()
            .map_err(|e| fail("Failed to get current directory", e.to_string(), e))?,
    };
    if !target_dir.is_dir() {
        return Err(RoutineFailure::error(Message::new(
            "Not found".to_string(),
            format!("{} is not a directory", target_dir.display()),
        )));
    }
    Ok(target_dir)
}

fn load_manifest(toml: &str, component: &str) -> Result<ComponentManifest, RoutineFailure> {
    toml::from_str(toml).map_err(|e| {
        RoutineFailure::error(Message::new(
            "Internal error".to_string(),
            format!("{component}/component.toml is invalid: {e}"),
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

/// Loads the Moose project from `target_dir`, validates language compatibility,
/// and returns the configured `source_dir`.
fn resolve_moose_source_dir(
    manifest: &ComponentManifest,
    target_dir: &Path,
) -> Result<String, RoutineFailure> {
    let project = Project::load(&target_dir.to_path_buf(), MooseEnvironment::Development).map_err(
        |e| match e {
            ConfigError::Foreign(_) => RoutineFailure::error(Message::new(
                "Wrong directory".to_string(),
                format!(
                    "No moose.config.toml found in {}.\nUse --dir to point to your moose project.",
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
        },
    )?;

    if project.language != manifest.language {
        return Err(RoutineFailure::error(Message::new(
            "Lang mismatch".to_string(),
            format!(
                "This component requires {} but your project uses {}.",
                manifest.language, project.language
            ),
        )));
    }

    if project.source_dir.is_empty() {
        return Err(RoutineFailure::error(Message::new(
            "Config error".to_string(),
            "source_dir in moose.config.toml must not be empty".to_string(),
        )));
    }

    Ok(project.source_dir.clone())
}

/// Returns true if `export_line` appears as an active (non-commented) line in `content`.
/// Both sides are normalised — trailing `// comments` are stripped and trailing semicolons
/// are removed — before an exact (`==`) comparison. This avoids false positives from
/// longer paths (e.g. `"./apis/mcp/extra"`) and false negatives from semicolon/comment style.
fn export_line_present(content: &str, export_line: &str) -> bool {
    let normalized = export_line.trim().trim_end_matches(';');
    content.lines().any(|l| {
        let code = l
            .trim()
            .split("//")
            .next()
            .unwrap_or("")
            .trim()
            .trim_end_matches(';');
        code == normalized
    })
}

/// Returns the conventional entry filename for a language (`index.ts` / `main.py`).
fn entry_filename(language: &SupportedLanguages) -> &'static str {
    match language {
        SupportedLanguages::Typescript => "index.ts",
        SupportedLanguages::Python => "main.py",
    }
}

/// Resolves `{{source_dir}}` placeholders in a dest path.
fn resolve_dest(dest: &str, source_dir: Option<&str>) -> String {
    match source_dir {
        Some(sd) => dest.replace("{{source_dir}}", sd),
        None => dest.to_string(),
    }
}

fn print_plan(manifest: &ComponentManifest, target_dir: &Path, source_dir: Option<&str>) {
    show_message!(
        MessageType::Info,
        Message::new("Adding".to_string(), manifest.name.clone())
    );

    let file_dests: Vec<String> = manifest
        .files
        .iter()
        .map(|f| resolve_dest(&f.dest, source_dir))
        .collect();
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

    if !manifest.moose_exports.is_empty() {
        if let Some(sd) = source_dir {
            let entry_path = target_dir.join(sd).join(entry_filename(&manifest.language));
            let existing = std::fs::read_to_string(&entry_path).unwrap_or_default();
            let export_lines: Vec<String> = manifest
                .moose_exports
                .iter()
                .map(|line| {
                    if export_line_present(&existing, line) {
                        format!("{line}  (already present)")
                    } else {
                        line.clone()
                    }
                })
                .collect();
            display::infrastructure::infra_added_detailed("Exports", &export_lines);
        }
    }
}

fn check_nextjs_project(target_dir: &Path) -> Result<(), RoutineFailure> {
    let has_next_config = [
        "next.config.js",
        "next.config.ts",
        "next.config.mjs",
        "next.config.mts",
    ]
    .iter()
    .any(|f| target_dir.join(f).exists());

    if !has_next_config {
        return Err(RoutineFailure::error(Message::new(
            "Next.js required".to_string(),
            format!(
                "No next.config.* found in {}.\nThis component targets Next.js App Router projects.",
                target_dir.display()
            ),
        )));
    }

    let has_app_dir = target_dir.join("app").is_dir() || target_dir.join("src/app").is_dir();

    if !has_app_dir {
        return Err(RoutineFailure::error(Message::new(
            "App Router required".to_string(),
            format!(
                "No app/ directory found in {}.\nThis component requires Next.js App Router.\nIf you're on Pages Router, see: https://nextjs.org/docs/app/building-your-application/upgrading/app-router-migration",
                target_dir.display()
            ),
        )));
    }

    Ok(())
}

fn check_shadcn_initialized(
    target_dir: &Path,
    pkg_manager: &PackageManager,
) -> Result<(), RoutineFailure> {
    if target_dir.join("components.json").exists() {
        return Ok(());
    }
    let init_cmd = match pkg_manager {
        PackageManager::Pnpm => "pnpm dlx shadcn@latest init",
        PackageManager::Npm => "npx shadcn@latest init",
    };
    Err(RoutineFailure::error(Message::new(
        "Shadcn required".to_string(),
        format!(
            "No components.json found in {}.\nRun: {}",
            target_dir.display(),
            init_cmd
        ),
    )))
}

/// Prompts the user to confirm the plan before executing.
/// If there are conflicts and `--overwrite` is not set, errors immediately.
/// If there are conflicts and `--overwrite` is set, warns which files will be replaced.
/// Skips the prompt when `--yes` is set or stdin is not a TTY.
fn confirm_plan(
    manifest: &ComponentManifest,
    target_dir: &Path,
    source_dir: Option<&str>,
    overwrite: bool,
    yes: bool,
) -> Result<(), RoutineFailure> {
    let conflicts: Vec<String> = manifest
        .files
        .iter()
        .map(|f| resolve_dest(&f.dest, source_dir))
        .filter(|dest| target_dir.join(dest).exists())
        .collect();

    if !conflicts.is_empty() {
        if !overwrite {
            show_message!(
                MessageType::Error,
                Message::new(
                    "Conflict".to_string(),
                    "These files already exist (use --overwrite to replace):".to_string(),
                )
            );
            display::write_detail_lines(&conflicts);
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
        display::write_detail_lines(&conflicts);
    }

    if yes || !std::io::stdin().is_terminal() {
        return Ok(());
    }

    let input = prompt_user("\nProceed? [y/N]", Some("N"), None)?;
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
    source_dir: Option<&str>,
) -> Result<(), RoutineFailure> {
    for f in &manifest.files {
        let content = file_contents.get(&f.src).ok_or_else(|| {
            RoutineFailure::error(Message::new(
                "Internal error".to_string(),
                format!("'{}' missing from fetched files", f.src),
            ))
        })?;

        let dest_str = resolve_dest(&f.dest, source_dir);
        let dest = target_dir.join(&dest_str);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| fail("Write failed", parent.display(), e))?;
        }
        std::fs::write(&dest, content).map_err(|e| fail("Write failed", dest.display(), e))?;
        show_message!(
            MessageType::Info,
            Message::new("Wrote".to_string(), dest_str)
        );
    }
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

/// Appends a `KEY=value` entry to `path` if no `KEY=` line already exists. Creates the file if needed.
///
/// If `placeholder` starts with `#` it is treated as an instruction comment and written on the line
/// above an empty `KEY=`, so that `.env` parsers don't interpret the comment as the value.
fn append_env_var(path: &Path, key: &str, placeholder: &str) -> std::io::Result<()> {
    let existing = if path.exists() {
        std::fs::read_to_string(path)?
    } else {
        String::new()
    };

    let prefix = format!("{key}=");
    if existing
        .lines()
        .any(|l| l.trim_start().starts_with(&prefix))
    {
        return Ok(());
    }

    let mut content = existing;
    if !content.ends_with('\n') && !content.is_empty() {
        content.push('\n');
    }
    if placeholder.starts_with('#') {
        content.push_str(&format!("{placeholder}\n{key}=\n"));
    } else {
        content.push_str(&format!("{key}={placeholder}\n"));
    }
    std::fs::write(path, content)
}

/// Appends any missing export lines to the language entry file.
fn append_moose_exports(
    target_dir: &Path,
    source_dir: &str,
    language: &SupportedLanguages,
    exports: &[String],
) -> Result<(), RoutineFailure> {
    if exports.is_empty() {
        return Ok(());
    }

    let entry_path = target_dir.join(source_dir).join(entry_filename(language));
    let rel = entry_path
        .strip_prefix(target_dir)
        .unwrap_or(&entry_path)
        .display()
        .to_string();

    if !entry_path.exists() {
        show_message!(
            MessageType::Warning,
            Message::new(
                "Skipped".to_string(),
                format!("{rel} not found — add exports manually"),
            )
        );
        return Ok(());
    }

    let existing = std::fs::read_to_string(&entry_path).map_err(|e| {
        fail(
            "Update failed",
            format!("Could not read {}", entry_path.display()),
            e,
        )
    })?;

    let missing: Vec<&str> = exports
        .iter()
        .filter(|line| !export_line_present(&existing, line))
        .map(String::as_str)
        .collect();

    if missing.is_empty() {
        show_message!(
            MessageType::Info,
            Message::new(
                "Skipped".to_string(),
                format!("{rel} (exports already present)")
            )
        );
        return Ok(());
    }

    let mut content = existing;
    if !content.ends_with('\n') && !content.is_empty() {
        content.push('\n');
    }
    for line in &missing {
        content.push_str(line);
        content.push('\n');
    }

    std::fs::write(&entry_path, content).map_err(|e| {
        fail(
            "Update failed",
            format!("Could not write {}", entry_path.display()),
            e,
        )
    })?;

    show_message!(
        MessageType::Info,
        Message::new("Updated".to_string(), format!("{rel} (exports)"))
    );

    Ok(())
}

fn install_dependencies(
    manifest: &ComponentManifest,
    target_dir: &Path,
    pkg_manager: &PackageManager,
) -> Result<(), RoutineFailure> {
    install_shadcn_components(&manifest.shadcn_components, target_dir, pkg_manager)?;
    install_npm_deps(&manifest.npm_deps, target_dir, pkg_manager)
}

fn install_shadcn_components(
    components: &[String],
    target_dir: &Path,
    pkg_manager: &PackageManager,
) -> Result<(), RoutineFailure> {
    if components.is_empty() {
        return Ok(());
    }
    show_message!(
        MessageType::Info,
        Message::new("Installing".to_string(), "shadcn components...".to_string())
    );
    let refs: Vec<&str> = components.iter().map(String::as_str).collect();
    run_shadcn_add(target_dir, &refs, pkg_manager).map_err(|e| {
        let add_cmd = match pkg_manager {
            PackageManager::Pnpm => "pnpm dlx shadcn add",
            PackageManager::Npm => "npx shadcn add",
        };
        fail(
            "Install failed",
            format!("Run manually: {} {}", add_cmd, components.join(" ")),
            e,
        )
    })?;
    show_message!(
        MessageType::Success,
        Message::new("Installed".to_string(), "shadcn components".to_string())
    );
    Ok(())
}

fn install_npm_deps(
    deps: &[String],
    target_dir: &Path,
    pkg_manager: &PackageManager,
) -> Result<(), RoutineFailure> {
    if deps.is_empty() {
        return Ok(());
    }
    show_message!(
        MessageType::Info,
        Message::new(
            "Installing".to_string(),
            format!("{pkg_manager} dependencies..."),
        )
    );
    let refs: Vec<&str> = deps.iter().map(String::as_str).collect();
    run_pkg_add(target_dir, &refs, pkg_manager).map_err(|e| {
        fail(
            "Install failed",
            format!("Run manually: {} add {}", pkg_manager, deps.join(" ")),
            e,
        )
    })?;
    show_message!(
        MessageType::Success,
        Message::new("Installed".to_string(), "npm dependencies".to_string())
    );
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
