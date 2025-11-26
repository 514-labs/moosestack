use flate2::read::GzDecoder;
use futures::StreamExt;
use home::home_dir;
use regex::Regex;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use tar::Archive;
use toml::Value;
use tracing::warn;

use super::RoutineFailure;
use super::RoutineSuccess;
use crate::cli::display::{Message, MessageType};
use crate::cli::settings::user_directory;
use crate::framework::languages::SupportedLanguages;
use crate::project::Project;
use crate::utilities::constants::CLI_VERSION;
use crate::utilities::git::is_git_repo;

const TEMPLATE_REGISTRY_URL: &str = "https://templates.514.dev";
const DOWNLOAD_DIR: &str = "templates";
const LOCAL_TEMPLATE_DIR: &str = "template-packages";

// Add a new struct to represent template config
#[derive(Debug)]
pub struct TemplateConfig {
    pub language: String,
    pub description: String,
    pub post_install_print: String,
    pub visible: bool,
}

impl TemplateConfig {
    fn from_toml(value: &Value) -> Option<Self> {
        Some(TemplateConfig {
            language: value.get("language")?.as_str()?.to_string(),
            description: value.get("description")?.as_str()?.to_string(),
            post_install_print: value.get("post_install_print")?.as_str()?.to_string(),
            visible: value
                .get("visible")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
        })
    }
}

// TODO - no need to download every time, once cached once, use the cached version
fn templates_download_dir() -> PathBuf {
    let mut path = user_directory();
    path.push(DOWNLOAD_DIR);
    path
}

fn template_file_archive(template_name: &str, template_version: &str) -> PathBuf {
    let mut path = templates_download_dir();
    path.push(template_version);
    path.push(format!("{template_name}.tgz"));
    path
}

async fn download_from_local(template_name: &str) -> anyhow::Result<()> {
    let bin_dir = std::env::current_exe()?;
    let local_template_path = bin_dir
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join(LOCAL_TEMPLATE_DIR)
        .join(format!("{template_name}.tgz"));

    if !local_template_path.exists() {
        anyhow::bail!("Local template not found. Did you run scripts/package-templates.js?")
    }

    let mut dest: PathBuf = templates_download_dir();
    dest.push("0.0.1"); // In local mode, we always use "latest"

    // Create the directory if it doesn't exist
    if !dest.exists() {
        std::fs::create_dir_all(&dest)?;
    }

    dest.push(format!("{template_name}.tgz"));
    std::fs::copy(local_template_path, dest)?;

    Ok(())
}

async fn download(template_name: &str, template_version: &str) -> anyhow::Result<()> {
    // If we're in test mode (0.0.1), use local templates
    if template_version == "0.0.1" {
        return download_from_local(template_name).await;
    }

    let res = reqwest::get(format!(
        "{TEMPLATE_REGISTRY_URL}/{template_version}/{template_name}.tgz"
    ))
    .await?;

    if res.status() == 404 {
        anyhow::bail!("Template not found")
    }

    res.error_for_status_ref()?;

    let mut dest = templates_download_dir();
    dest.push(template_version);

    // Create the directory if it doesn't exist
    if !dest.exists() {
        std::fs::create_dir_all(&dest)?;
    }

    dest.push(format!("{template_name}.tgz"));

    let mut stream = res.bytes_stream();
    let mut out = File::create(dest)?;
    while let Some(item) = stream.next().await {
        let chunk = item?;
        out.write_all(&chunk)?;
    }

    Ok(())
}

fn unpack(template_name: &str, template_version: &str, target_dir: &PathBuf) -> anyhow::Result<()> {
    let template_archive = template_file_archive(template_name, template_version);
    let tar_gz = File::open(template_archive)?;
    let tar = GzDecoder::new(tar_gz);
    let mut archive = Archive::new(tar);

    // Filter out macOS metadata files during extraction
    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?;

        // Skip macOS metadata files
        if path.to_string_lossy().contains("/._") || path.to_string_lossy().starts_with("._") {
            continue;
        }

        entry.unpack_in(target_dir)?;
    }

    Ok(())
}

async fn download_and_unpack(
    template_name: &str,
    template_version: &str,
    target_dir: &Path,
) -> anyhow::Result<()> {
    let canonnical_path = target_dir.canonicalize()?;

    download(template_name, template_version).await?;
    unpack(template_name, template_version, &canonnical_path)
}

pub async fn generate_template(
    template_name: &str,
    template_version: &str,
    target_dir: &Path,
) -> Result<(), RoutineFailure> {
    match download_and_unpack(template_name, template_version, target_dir).await {
        Ok(()) => {
            show_message!(
                MessageType::Success,
                Message {
                    action: "Created".to_string(),
                    details: "template".to_string(),
                }
            );
            Ok(())
        }
        Err(e) => Err(RoutineFailure::error(Message {
            action: "Template".to_string(),
            details: format!("Failed to generate template: {e:?}"),
        })),
    }
}

pub async fn get_template_manifest(template_version: &str) -> anyhow::Result<Value> {
    // If we're in test mode (0.0.1), use local manifest
    if template_version == "0.0.1" {
        let bin_dir = std::env::current_exe()?;
        let manifest_path = bin_dir
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join(LOCAL_TEMPLATE_DIR)
            .join("manifest.toml");

        if !manifest_path.exists() {
            anyhow::bail!(
                "Local manifest not found. Did you run scripts/package-templates.js? {}",
                manifest_path.display()
            )
        }
        let content = std::fs::read_to_string(manifest_path)?;
        let manifest: Value = toml::from_str(&content)?;
        Ok(manifest)
    } else {
        let res = reqwest::get(format!(
            "{TEMPLATE_REGISTRY_URL}/{template_version}/manifest.toml"
        ))
        .await?
        .error_for_status()?;

        let content = res.text().await?;
        let manifest: Value = toml::from_str(&content)?;
        Ok(manifest)
    }
}

pub async fn get_template_config(
    template_name: &str,
    template_version: &str,
) -> Result<TemplateConfig, RoutineFailure> {
    let manifest = get_template_manifest(template_version).await.map_err(|e| {
        RoutineFailure::error(Message {
            action: "Template".to_string(),
            details: format!("Failed to load template manifest: {e:?}"),
        })
    })?;

    let templates = manifest.get("templates").ok_or_else(|| {
        RoutineFailure::error(Message {
            action: "Template".to_string(),
            details: "Invalid manifest: missing templates section".to_string(),
        })
    })?;

    // If template not found, create helpful error message with available templates
    if templates.get(template_name).is_none() {
        let available_templates: Vec<String> = templates
            .as_table()
            .map(|table| {
                table
                    .iter()
                    .filter_map(|(name, config)| {
                        TemplateConfig::from_toml(config).map(|config| {
                            format!(
                                "  - {} ({}) - {}",
                                name, config.language, config.description
                            )
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        return Err(RoutineFailure::error(Message {
            action: "Template".to_string(),
            details: format!(
                "Template '{}' not found. Available templates:\n{}",
                template_name,
                available_templates.join("\n")
            ),
        }));
    }

    let template_config = TemplateConfig::from_toml(templates.get(template_name).unwrap())
        .ok_or_else(|| {
            RoutineFailure::error(Message {
                action: "Template".to_string(),
                details: format!("Invalid configuration for template '{template_name}'"),
            })
        })?;

    Ok(template_config)
}

pub async fn list_available_templates(
    template_version: &str,
) -> Result<RoutineSuccess, RoutineFailure> {
    let manifest = get_template_manifest(template_version).await.map_err(|e| {
        RoutineFailure::error(Message {
            action: "Templates".to_string(),
            details: format!("Failed to load template manifest: {e:?}"),
        })
    })?;

    let templates = manifest.get("templates").ok_or_else(|| {
        RoutineFailure::error(Message {
            action: "Templates".to_string(),
            details: "Invalid manifest: missing templates section".to_string(),
        })
    })?;

    let available_templates: Vec<String> = templates
        .as_table()
        .map(|table| {
            table
                .iter()
                .filter_map(|(name, config)| {
                    TemplateConfig::from_toml(config).and_then(|config| {
                        // Filter out templates with visible=false
                        if config.visible {
                            Some(format!(
                                "  - {} ({}) - {}",
                                name, config.language, config.description
                            ))
                        } else {
                            None
                        }
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let output = format!(
        "Available templates for version {}:
{}",
        template_version,
        available_templates.join(
            "
"
        )
    );

    Ok(RoutineSuccess::success(Message::new(
        "Templates".to_string(),
        output,
    )))
}

pub async fn create_project_from_template(
    template: &str,
    name: &str,
    dir_path: &Path,
    no_fail_already_exists: bool,
) -> Result<String, RoutineFailure> {
    let template_config = get_template_config(template, CLI_VERSION).await?;

    // Special case: If name is ".", use current directory without creating a new folder
    let is_current_dir = name == ".";

    if !no_fail_already_exists && dir_path.exists() && !is_current_dir {
        return Err(RoutineFailure::error(Message {
            action: "Init".to_string(),
            details:
            "Directory already exists, please use the --no-fail-already-exists flag if this is expected."
                .to_string(),
        }));
    }

    if !is_current_dir {
        std::fs::create_dir_all(dir_path).map_err(|e| {
            RoutineFailure::error(Message {
                action: "Init".into(),
                details: format!("Failed to create directory: {e}"),
            })
        })?;
    }

    if dir_path.canonicalize().unwrap() == home_dir().unwrap().canonicalize().unwrap() {
        return Err(RoutineFailure::error(Message {
            action: "Init".to_string(),
            details: "You cannot create a project in your home directory".to_string(),
        }));
    }

    let language = match template_config.language.as_str() {
        "typescript" => SupportedLanguages::Typescript,
        "python" => SupportedLanguages::Python,
        lang => {
            warn!("Unknown language {} in template {}", lang, template);
            SupportedLanguages::Typescript
        }
    };

    generate_template(template, CLI_VERSION, dir_path).await?;

    // For current directory case, use the directory name as the project name if name is "."
    let project_name = if is_current_dir {
        dir_path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "moose-project".to_string())
    } else {
        name.to_string()
    };

    let project = Project::new(dir_path, project_name.clone(), language);
    let project_arc = Arc::new(project);

    // Update project configuration based on language
    match language {
        SupportedLanguages::Typescript => {
            let package_json_path = dir_path.join("package.json");
            if package_json_path.exists() {
                let mut package_json: serde_json::Value = serde_json::from_str(
                    &std::fs::read_to_string(&package_json_path).map_err(|e| {
                        RoutineFailure::error(Message {
                            action: "Init".to_string(),
                            details: format!("Failed to read package.json: {e}"),
                        })
                    })?,
                )
                .map_err(|e| {
                    RoutineFailure::error(Message {
                        action: "Init".to_string(),
                        details: format!("Failed to parse package.json: {e}"),
                    })
                })?;

                if let Some(obj) = package_json.as_object_mut() {
                    obj.insert(
                        "name".to_string(),
                        serde_json::Value::String(project_name.clone()),
                    );
                    std::fs::write(
                        &package_json_path,
                        serde_json::to_string_pretty(&package_json).map_err(|e| {
                            RoutineFailure::error(Message {
                                action: "Init".to_string(),
                                details: format!("Failed to serialize package.json: {e}"),
                            })
                        })?,
                    )
                    .map_err(|e| {
                        RoutineFailure::error(Message {
                            action: "Init".to_string(),
                            details: format!("Failed to write package.json: {e}"),
                        })
                    })?;
                }
            }
        }
        SupportedLanguages::Python => {
            let setup_py_path = dir_path.join("setup.py");
            if setup_py_path.exists() {
                let setup_py_content = std::fs::read_to_string(&setup_py_path).map_err(|e| {
                    RoutineFailure::error(Message {
                        action: "Init".to_string(),
                        details: format!("Failed to read setup.py: {e}"),
                    })
                })?;

                // Replace the name in setup.py
                let name_pattern = Regex::new(r"name='[^']*'").map_err(|e| {
                    RoutineFailure::error(Message {
                        action: "Init".to_string(),
                        details: format!("Failed to create regex pattern: {e}"),
                    })
                })?;
                let new_setup_py =
                    name_pattern.replace(&setup_py_content, &format!("name='{name}'"));

                std::fs::write(&setup_py_path, new_setup_py.as_bytes()).map_err(|e| {
                    RoutineFailure::error(Message {
                        action: "Init".to_string(),
                        details: format!("Failed to write setup.py: {e}"),
                    })
                })?;
            }
        }
    }

    maybe_create_git_repo(dir_path, project_arc, is_current_dir);

    Ok(template_config
        .post_install_print
        .replace("{project_dir}", &dir_path.to_string_lossy()))
}

fn maybe_create_git_repo(dir_path: &Path, project_arc: Arc<Project>, is_current_dir: bool) {
    let is_git_repo = is_git_repo(dir_path).expect("Failed to check if directory is a git repo");

    if !is_git_repo {
        crate::utilities::git::create_init_commit(project_arc, dir_path);
        show_message!(
            MessageType::Info,
            Message {
                action: "Init".to_string(),
                details: "Created a new git repository".to_string(),
            }
        );
    }

    {
        let message = if is_current_dir {
            "Created project in current directory 🚀".to_string()
        } else {
            format!("Created project at {} 🚀", dir_path.to_string_lossy())
        };

        show_message!(
            MessageType::Success,
            Message {
                action: "Success!".to_string(),
                details: message,
            }
        );
    }

    {
        show_message!(
            MessageType::Info,
            Message {
                action: "".to_string(),
                details: "\n".to_string(),
            }
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::Once;

    static SETUP: Once = Once::new();

    // Helper function to set up the test environment by copying necessary files
    fn setup_test_environment() -> anyhow::Result<()> {
        let crate_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?);
        let workspace_root = crate_dir.parent().unwrap().parent().unwrap();

        let source_dir = workspace_root.join("template-packages");
        let target_dir = workspace_root.join("target/template-packages");

        // Run the package-templates.js script to generate the templates
        println!("Running scripts/package-templates.js to generate templates...");
        let script_path = workspace_root.join("scripts/package-templates.js");

        let status = Command::new("node")
            .current_dir(workspace_root)
            .arg(script_path)
            .status()?;

        if !status.success() {
            anyhow::bail!("Failed to run scripts/package-templates.js");
        }

        if !source_dir.exists() {
            anyhow::bail!(
                "Source template package directory not found even after running scripts/package-templates.js: {:?}",
                source_dir
            );
        }

        // Ensure the target directory exists
        fs::create_dir_all(&target_dir)?;

        // Files to copy (add more if other tests need different template .tgz files)
        let files_to_copy = ["manifest.toml", "default.tgz", "python.tgz"];

        for file_name in files_to_copy {
            let source_file = source_dir.join(file_name);
            let target_file = target_dir.join(file_name);

            if source_file.exists() {
                fs::copy(&source_file, &target_file)?;
            } else {
                // Optionally warn or error if a source file is missing
                eprintln!(
                    "Warning: Source file {} not found, skipping copy.",
                    source_file.display()
                );
            }
        }

        Ok(())
    }

    fn ensure_test_environment() {
        SETUP.call_once(|| {
            setup_test_environment().expect("Failed to set up test environment");
        });
    }

    #[tokio::test]
    async fn test_list_available_templates_local() {
        ensure_test_environment();
        // Use version "0.0.1" to test against the local manifest
        let result = list_available_templates("0.0.1").await;

        assert!(
            result.is_ok(),
            "Failed to list available templates: {:?}",
            result.err()
        );
        let success_message = result.unwrap().message.details;

        // Basic check to see if the output contains expected template info structure
        assert!(success_message.contains("Available templates for version 0.0.1"));
        // Check for specific templates expected in the local manifest
        assert!(success_message.contains("- typescript (typescript)"));
        assert!(success_message.contains("- python (python)"));
    }

    #[tokio::test]
    async fn test_get_template_config_success() {
        ensure_test_environment();
        // Test getting a valid template config ("default") using the local manifest
        let result = get_template_config("typescript", "0.0.1").await;
        assert!(result.is_ok());
        let config = result.unwrap();
        assert_eq!(config.language, "typescript");
        assert_eq!(
            config.description,
            "Default TypeScript project, seeded with foobar example components."
        );
        // Add more assertions if needed for post_install_print etc.
    }

    #[tokio::test]
    async fn test_get_template_config_not_found() {
        ensure_test_environment();
        // Test getting a non-existent template config using the local manifest
        let result = get_template_config("non_existent_template", "0.0.1").await;
        assert!(result.is_err());
        let error_message = result.unwrap_err().message.details;
        assert!(error_message.contains("Template 'non_existent_template' not found"));
        assert!(error_message.contains("Available templates:")); // Check if it lists available templates
    }

    #[tokio::test]
    async fn test_get_template_manifest_local() {
        ensure_test_environment();
        // Test getting the local manifest (version "0.0.1")
        let result = get_template_manifest("0.0.1").await;
        assert!(
            result.is_ok(),
            "Failed to get local manifest: {:?}",
            result.err()
        );
        let manifest = result.unwrap();

        // Check if the manifest has the 'templates' table
        assert!(manifest.get("templates").is_some());
        assert!(manifest["templates"].is_table());

        // Check for the existence of specific template configurations within the 'templates' table
        let templates_table = manifest["templates"].as_table().unwrap();
        assert!(templates_table.contains_key("typescript"));
        assert!(templates_table.contains_key("python"));
    }
}
