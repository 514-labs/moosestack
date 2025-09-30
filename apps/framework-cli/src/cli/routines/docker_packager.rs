use super::{RoutineFailure, RoutineSuccess};
use crate::cli::display::with_spinner_completion;
use crate::cli::routines::util::ensure_docker_running;
use crate::framework::languages::SupportedLanguages;
use crate::utilities::constants::{
    APP_DIR, OLD_PROJECT_CONFIG_FILE, PACKAGE_JSON, PROJECT_CONFIG_FILE, REQUIREMENTS_TXT,
    SETUP_PY, TSCONFIG_JSON,
};
use crate::utilities::docker::DockerClient;
use crate::utilities::nodejs_version::determine_node_version_from_package_json;
use crate::utilities::package_managers::get_lock_file_path;
use crate::utilities::{constants, system};
use crate::{cli::display::Message, project::Project};

use log::{debug, error, info};
use serde_json::Value as JsonValue;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
struct PackageInfo {
    name: String,
}

/// Helper function to safely create directories without unwrap() calls.
/// Replaces fs::create_dir_all(path.parent().unwrap()) pattern used throughout the codebase.
fn ensure_directory_exists(path: &Path) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
    } else {
        Ok(())
    }
}

/// Helper function to copy config files for monorepo builds
fn copy_project_config_files(project_root: &Path, build_context: &Path, internal_dir: &Path) {
    let temp_project_toml = build_context.join("project.toml");
    let temp_moose_config = build_context.join("moose.config.toml");

    // Copy project files
    if project_root.join(PROJECT_CONFIG_FILE).exists() {
        fs::copy(project_root.join(PROJECT_CONFIG_FILE), &temp_project_toml).ok();
    } else if project_root.join(OLD_PROJECT_CONFIG_FILE).exists() {
        fs::copy(
            project_root.join(OLD_PROJECT_CONFIG_FILE),
            &temp_project_toml,
        )
        .ok();
    }

    // Copy moose config
    if let Some(moose_config_src) = [
        internal_dir.join("packager/moose.config.toml"),
        project_root.join("moose.config.toml"),
    ]
    .iter()
    .find(|p| p.exists())
    {
        fs::copy(moose_config_src, &temp_moose_config).ok();
    }
}

#[derive(Debug)]
struct PathMapping {
    alias: String,
    original_path: String,
    package_name: String,
    package_directory: String, // The directory name from the filesystem path
}

/// Generates the TypeScript base Dockerfile with dynamic Node.js version
fn generate_ts_base_dockerfile(node_version: &str) -> String {
    format!(
        r#"
FROM node:{}-bookworm-slim

# This is to remove the notice to update NPM that will break the output from STDOUT
RUN npm config set update-notifier false

# Install alternative package managers globally
RUN npm install -g pnpm@latest
"#,
        node_version
    )
}

// Python and node 'slim' term is flipped
static PY_BASE_DOCKER_FILE: &str = r#"
FROM python:3.12-slim-bookworm
"#;

/// Generates the monorepo TypeScript Dockerfile with dynamic Node.js version and lock file
fn generate_ts_monorepo_dockerfile(node_version: &str, lock_file_name: Option<&str>) -> String {
    let lock_file_copy = match lock_file_name {
        Some(name) => format!("COPY {} ./", name),
        None => "# No lock file found".to_string(),
    };

    let install_command = match lock_file_name {
        Some("pnpm-lock.yaml") => "RUN pnpm install --frozen-lockfile",
        Some("package-lock.json") => "RUN npm ci",
        Some("yarn.lock") => "RUN yarn install --frozen-lockfile",
        Some(_) => "RUN pnpm install --frozen-lockfile", // fallback to pnpm
        None => "RUN pnpm install",                      // no lock file, regular install
    };

    format!(
        r#"
# Stage 1: Full monorepo context for dependency resolution
FROM node:{}-bookworm-slim AS monorepo-base

# This is to remove the notice to update NPM that will break the output from STDOUT
RUN npm config set update-notifier false

# Install alternative package managers globally
RUN npm install -g pnpm@latest

# Set working directory to monorepo root
WORKDIR /monorepo

# Copy workspace configuration files
COPY pnpm-workspace.yaml ./
{}

# Copy workspace package directories (will be replaced with actual patterns)
MONOREPO_PACKAGE_COPIES

# Install all dependencies from monorepo root
{}

# Stage 2: Production image  
FROM node:{}-bookworm-slim

# This is to remove the notice to update NPM that will break the output from STDOUT
RUN npm config set update-notifier false

# Install alternative package managers globally
RUN npm install -g pnpm@latest
"#,
        node_version, lock_file_copy, install_command, node_version
    )
}

static DOCKER_FILE_COMMON: &str = r#"
ARG DEBIAN_FRONTEND=noninteractive

# Update the package lists for upgrades for security purposes
RUN apt-get update && apt-get upgrade -y

# Install ca-certificates, tail and locales package
RUN apt-get install -y ca-certificates locales coreutils curl && update-ca-certificates

# moose depends on libc 2.40+, not available in stable
# This uses unstable, but unpinned because they delete older versions
RUN echo "deb http://deb.debian.org/debian/ unstable main" >> /etc/apt/sources.list \
    && apt-get update \
    && apt-get install -y libc6 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Generate locale files
RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8
ENV TZ=UTC
ENV DOCKER_IMAGE=true

# Install Moose
ARG FRAMEWORK_VERSION="0.0.0"
ARG DOWNLOAD_URL
RUN echo "DOWNLOAD_URL: ${DOWNLOAD_URL}"
RUN ldd --version
RUN curl -Lo /usr/local/bin/moose ${DOWNLOAD_URL}
RUN chmod +x /usr/local/bin/moose

RUN moose --version

# Setup healthcheck
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:4000/health || exit 1

# Sets up non-root user using 1001 because node creates a user with 1000
RUN groupadd --gid 1001 moose \
  && useradd --uid 1001 --gid moose --shell /bin/bash --create-home moose

# Set the working directory inside the container
WORKDIR /application

# Ensure application directory is owned by moose user
RUN chown -R moose:moose /application

# Placeholder for the language specific copy package file copy
COPY_PACKAGE_FILE

# https://stackoverflow.com/questions/70096208/dockerfile-copy-folder-if-it-exists-conditional-copy/70096420#70096420
COPY --chown=moose:moose ./project.tom[l] ./project.toml
COPY --chown=moose:moose ./moose.config.tom[l] ./moose.config.toml
COPY --chown=moose:moose ./versions .moose/versions


# Placeholder for the language specific install command
INSTALL_COMMAND


# all commands from here on will be run as the moose user
USER moose:moose

# Checks that the project is valid
RUN which moose
RUN moose check --write-infra-map || (echo "Error running moose check" && exit 1)

# Expose the ports on which the application will listen
EXPOSE 4000

# Set the command to run the application
CMD ["moose", "prod"]
"#;

/// Creates a Dockerfile for the given project, supporting both monorepo and standalone configurations.
///
/// ## Monorepo Multi-Stage Docker Build Process
///
/// For TypeScript projects in monorepos, this function implements a sophisticated multi-stage Docker build:
///
/// **Stage 1: Full Monorepo Context (`monorepo-base`)**
/// - Copies the entire workspace (pnpm-workspace.yaml, pnpm-lock.yaml, all packages)
/// - Runs `pnpm install --frozen-lockfile` to install all dependencies across the workspace
/// - This stage has access to all packages and their interdependencies
///
/// **Stage 2: Production Image**
/// - Uses `pnpm deploy` to extract only production dependencies for the specific project
/// - Copies the transformed tsconfig.json (with paths rewritten from relative to node_modules)
/// - Applies the "TYPESCRIPT_FIX_PLACEHOLDER" replacement for path transformations
///
/// ## TypeScript Path Transformation Challenge
///
/// The core problem: Monorepo TypeScript projects use relative path mappings like:
/// ```json
/// { "paths": { "@shared/*": ["../shared/src/*"] } }
/// ```
///
/// But in Docker's node_modules structure, these become:
/// ```json  
/// { "paths": { "@shared/*": ["./node_modules/@my-org/shared/*"] } }
/// ```
///
/// This function analyzes the workspace, finds package.json files for each path mapping,
/// and pre-transforms the tsconfig.json before copying it into the final image.
///
/// ## Fallback Behavior
///
/// If monorepo detection fails or path analysis encounters errors, gracefully falls back
/// to standard single-project Docker build to ensure robustness.
pub fn create_dockerfile(
    project: &Project,
    docker_client: &DockerClient,
) -> Result<RoutineSuccess, RoutineFailure> {
    let internal_dir = project.internal_dir_with_routine_failure_err()?;

    ensure_docker_running(docker_client).map_err(|err| {
        error!("Failed to ensure docker is running: {}", err);
        RoutineFailure::new(
            Message::new(
                "Failed".to_string(),
                "to ensure docker is running".to_string(),
            ),
            err,
        )
    })?;

    let versions_file_path = internal_dir.join("packager/versions/.gitkeep");

    info!("Creating versions at: {:?}", versions_file_path);
    ensure_directory_exists(&versions_file_path).map_err(|err| {
        error!("Failed to create directory for app versions: {}", err);
        RoutineFailure::new(
            Message::new(
                "Failed".to_string(),
                "to create directory for app versions".to_string(),
            ),
            err,
        )
    })?;

    let file_path = internal_dir.join("packager/Dockerfile");

    info!("Creating Dockerfile at: {:?}", file_path);
    ensure_directory_exists(&file_path).map_err(|err| {
        error!("Failed to create directory for project packaging: {}", err);
        RoutineFailure::new(
            Message::new(
                "Failed".to_string(),
                "to create directory for project packaging".to_string(),
            ),
            err,
        )
    })?;

    let docker_file = match project.language {
        SupportedLanguages::Typescript => {
            let project_root = project.project_location.clone();

            // Determine Node.js version from package.json
            let package_json_path = project_root.join("package.json");
            let node_version = determine_node_version_from_package_json(&package_json_path);
            let node_version_str = node_version.to_major_string();

            info!(
                "Using Node.js version {} for Docker image",
                node_version_str
            );

            // Check if we're in a pnpm workspace (monorepo)
            if let Some(workspace_root) = find_pnpm_workspace_root(&project_root) {
                info!("Detected pnpm workspace at: {:?}", workspace_root);

                // Detect lock file at workspace root
                let workspace_lock_file = get_lock_file_path(&workspace_root);
                let lock_file_name = workspace_lock_file
                    .as_ref()
                    .and_then(|path| path.file_name())
                    .and_then(|name| name.to_str());

                if let Some(name) = lock_file_name {
                    info!("Found lock file in workspace: {}", name);
                } else {
                    info!("No lock file found in workspace root");
                }

                // Calculate relative path from workspace root to project
                let relative_project_path = match project_root.strip_prefix(&workspace_root) {
                    Ok(path) => path,
                    Err(e) => {
                        error!("Failed to calculate relative project path: {}", e);
                        // Fall back to standard build if we can't determine the relative path
                        return create_standard_typescript_dockerfile(
                            project,
                            &internal_dir,
                            &node_version_str,
                        );
                    }
                };

                // Read pnpm-workspace.yaml to understand structure
                let workspace_config = match read_workspace_config(&workspace_root) {
                    Ok(config) => config,
                    Err(e) => {
                        error!("Failed to read workspace config: {:?}", e);
                        // Fall back to standard build if we can't read the workspace config
                        return create_standard_typescript_dockerfile(
                            project,
                            &internal_dir,
                            &node_version_str,
                        );
                    }
                };

                // Generate COPY commands for all workspace packages
                let package_copies =
                    generate_workspace_copy_commands(&workspace_root, &workspace_config);

                // Analyze TypeScript paths and transform tsconfig.json
                let typescript_mappings = match analyze_typescript_paths(
                    &workspace_root,
                    &relative_project_path.to_string_lossy(),
                ) {
                    Ok(mappings) => {
                        // Transform tsconfig.json for Docker with pre-computed paths
                        if let Err(e) = transform_tsconfig_for_docker(
                            &workspace_root,
                            &relative_project_path.to_string_lossy(),
                            &mappings,
                            &internal_dir,
                        ) {
                            error!("Failed to transform tsconfig.json for Docker: {}", e);
                        }
                        mappings
                    }
                    Err(e) => {
                        error!("Failed to analyze TypeScript paths: {}", e);
                        Vec::new()
                    }
                };

                // Build the monorepo Dockerfile
                let mut dockerfile =
                    generate_ts_monorepo_dockerfile(&node_version_str, lock_file_name);
                dockerfile = dockerfile.replace("MONOREPO_PACKAGE_COPIES", &package_copies);

                // Add the common Docker sections
                dockerfile.push_str(DOCKER_FILE_COMMON);

                // Generate COPY commands for all workspace directories
                let workspace_copies = workspace_config
                    .iter()
                    .filter_map(|pattern| {
                        let base_path = pattern.replace("/*", "");
                        let full_path = workspace_root.join(&base_path);
                        if full_path.exists() && full_path.is_dir() {
                            Some(format!(
                                "COPY --from=monorepo-base /monorepo/{base_path} ./{base_path}"
                            ))
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n");

                // Prepare lock file copy command for deployment stage
                let deploy_lock_file_copy = match lock_file_name {
                    Some(name) => format!("COPY --from=monorepo-base /monorepo/{} ./", name),
                    None => "# No lock file found".to_string(),
                };

                let deploy_install_command = format!(
                    "RUN pnpm --filter \"./{}\" deploy /temp-deploy --legacy",
                    relative_project_path.to_string_lossy()
                );

                // Modify the copy commands to copy from the build stage
                let copy_from_build = format!(
                    r#"
# Copy application files from monorepo stage
COPY --from=monorepo-base --chown=moose:moose /monorepo/{}/app ./app
COPY --from=monorepo-base --chown=moose:moose /monorepo/{}/package.json ./package.json
COPY --from=monorepo-base --chown=moose:moose /monorepo/{}/tsconfig.json ./tsconfig.json

# Use pnpm deploy from workspace context to create clean production dependencies
USER root:root
WORKDIR /temp-monorepo
COPY --from=monorepo-base /monorepo/pnpm-workspace.yaml ./
{}
COPY --from=monorepo-base /monorepo/{} ./{}
# Copy all workspace directories that exist
{}
# Use package manager to install only production dependencies
{}
RUN cp -r /temp-deploy/node_modules /application/node_modules
RUN chown -R moose:moose /application/node_modules

TYPESCRIPT_FIX_PLACEHOLDER
USER root:root
# Clean up temporary directories
RUN rm -rf /temp-deploy /temp-monorepo

RUN if [ -d "/application/node_modules/@514labs/moose-lib/dist/" ]; then ls -la /application/node_modules/@514labs/moose-lib/dist/; fi
USER moose:moose
WORKDIR /application"#,
                    relative_project_path.to_string_lossy(), // 1: /monorepo/{}/app
                    relative_project_path.to_string_lossy(), // 2: /monorepo/{}/package.json
                    relative_project_path.to_string_lossy(), // 3: /monorepo/{}/tsconfig.json
                    deploy_lock_file_copy,                   // 4: lock file copy or comment
                    relative_project_path.to_string_lossy(), // 5: /monorepo/{} ./{}
                    relative_project_path.to_string_lossy(), // 6: /monorepo/{} ./{}
                    workspace_copies,                        // 7: {} (workspace_copies)
                    deploy_install_command,                  // 8: package manager install command
                );

                dockerfile = dockerfile.replace("COPY_PACKAGE_FILE", &copy_from_build);
                dockerfile = dockerfile.replace(
                    "INSTALL_COMMAND",
                    "# Dependencies copied from monorepo build stage",
                );

                // Replace the placeholder with a simple comment (tsconfig.json is pre-transformed)
                let typescript_comment = if typescript_mappings.is_empty() {
                    "# No TypeScript path transformations needed"
                } else {
                    "# TypeScript paths pre-transformed in tsconfig.json"
                };
                dockerfile = dockerfile.replace("TYPESCRIPT_FIX_PLACEHOLDER", typescript_comment);

                // Store monorepo info for build phase
                let monorepo_info_path = internal_dir.join("packager/.monorepo-info");
                fs::create_dir_all(monorepo_info_path.parent().unwrap()).ok();
                fs::write(
                    &monorepo_info_path,
                    format!(
                        "{}\n{}",
                        workspace_root.to_string_lossy(),
                        relative_project_path.to_string_lossy()
                    ),
                )
                .ok();

                dockerfile
            } else {
                // Not a monorepo, use standard Dockerfile generation
                create_standard_typescript_dockerfile_content(project, &node_version_str)?
            }
        }
        SupportedLanguages::Python => {
            let install = DOCKER_FILE_COMMON
                .replace(
                    "COPY_PACKAGE_FILE",
                    r#"COPY --chown=moose:moose ./setup.py ./setup.py
COPY --chown=moose:moose ./requirements.txt ./requirements.txt
COPY --chown=moose:moose ./app ./app"#,
                )
                .replace("INSTALL_COMMAND", "RUN pip install -r requirements.txt");

            format!("{PY_BASE_DOCKER_FILE}{install}")
        }
    };

    fs::write(&file_path, docker_file).map_err(|err| {
        error!("Failed to write Docker file for project: {}", err);
        RoutineFailure::new(
            Message::new(
                "Failed".to_string(),
                "to write Docker file for project".to_string(),
            ),
            err,
        )
    })?;

    info!("Dockerfile created at: {:?}", file_path);
    Ok(RoutineSuccess::success(Message::new(
        "Successfully".to_string(),
        "created dockerfile".to_string(),
    )))
}

/// Builds Docker images from the generated Dockerfile for specified architectures.
/// Handles both monorepo and standalone builds, copying necessary files and managing
/// temporary build contexts appropriately for each build type.
pub fn build_dockerfile(
    project: &Project,
    docker_client: &DockerClient,
    is_amd64: bool,
    is_arm64: bool,
) -> Result<RoutineSuccess, RoutineFailure> {
    let internal_dir = project.internal_dir_with_routine_failure_err()?;

    ensure_docker_running(docker_client).map_err(|err| {
        error!("Failed to ensure docker is running: {}", err);
        RoutineFailure::new(
            Message::new(
                "Failed".to_string(),
                "to ensure docker is running".to_string(),
            ),
            err,
        )
    })?;

    let file_path = internal_dir.join("packager/Dockerfile");
    info!("Building Dockerfile at: {:?}", file_path);

    fs::create_dir_all(file_path.parent().unwrap()).map_err(|err| {
        error!("Failed to create directory for project packaging: {}", err);
        RoutineFailure::new(
            Message::new(
                "Failed".to_string(),
                "to create directory for project packaging".to_string(),
            ),
            err,
        )
    })?;

    // Copy app & etc to packager directory
    let project_root_path = project.project_location.clone();
    let items_to_copy = vec![
        APP_DIR,
        PACKAGE_JSON,
        SETUP_PY,
        REQUIREMENTS_TXT,
        TSCONFIG_JSON,
        PROJECT_CONFIG_FILE,
        OLD_PROJECT_CONFIG_FILE,
    ];

    // Handle lock file copying for TypeScript projects only (may be from parent directories for monorepos)
    if project.language == SupportedLanguages::Typescript {
        if let Some(lock_file_path) = get_lock_file_path(&project_root_path) {
            let lock_file_name = lock_file_path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| {
                    error!("Invalid lock file path: {:?}", lock_file_path);
                    RoutineFailure::new(
                        Message::new(
                            "Failed".to_string(),
                            "to extract lock file name from path".to_string(),
                        ),
                        std::io::Error::new(
                            std::io::ErrorKind::InvalidInput,
                            "Invalid lock file path",
                        ),
                    )
                })?;

            let destination_path = internal_dir.join("packager").join(lock_file_name);

            match fs::copy(&lock_file_path, &destination_path) {
                Ok(_) => {
                    info!(
                        "Copied lock file from {:?} to packager directory",
                        lock_file_path
                    );
                }
                Err(err) => {
                    error!("Failed to copy lock file {:?}: {}", lock_file_path, err);
                    return Err(RoutineFailure::new(
                        Message::new(
                            "Failed".to_string(),
                            format!("to copy lock file {lock_file_name}"),
                        ),
                        err,
                    ));
                }
            }
        }
    }

    for item in items_to_copy {
        if !project_root_path.join(item).exists() {
            continue;
        }

        let copy_result = system::copy_directory(
            &project_root_path.join(item),
            &internal_dir.join("packager"),
        );
        match copy_result {
            Ok(_) => {
                info!("Copied {} to packager directory", item);
            }
            Err(err) => {
                error!("Failed to copy {} to packager directory: {}", item, err);
                return Err(RoutineFailure::new(
                    Message::new(
                        "Failed".to_string(),
                        format!("to copy {item} to packager directory"),
                    ),
                    err,
                ));
            }
        }
    }

    // consts::CLI_VERSION is set from an environment variable during the CI/CD process
    // however, it's set to 0.0.1 in development,
    // so we set it to a recent version for the purpose of local dev testing.
    let mut cli_version = constants::CLI_VERSION;
    if cli_version == "0.0.1" {
        cli_version = "0.6.34";
    }

    // Check if this is a monorepo build
    // .monorepo-info is a temporary file generated by our docker_packager process.
    let monorepo_info_path = internal_dir.join("packager/.monorepo-info");
    let (build_context, dockerfile_path) = if monorepo_info_path.exists() {
        // Read monorepo info
        match fs::read_to_string(&monorepo_info_path) {
            Ok(content) => {
                let lines: Vec<&str> = content.lines().collect();
                if lines.len() >= 2 {
                    let workspace_root = PathBuf::from(lines[0]);
                    let relative_project_path = lines[1];
                    info!(
                        "Building monorepo Docker image from workspace root: {:?}",
                        workspace_root
                    );

                    // Create a temporary Dockerfile at the workspace root
                    let temp_dockerfile = workspace_root.join("Dockerfile");

                    // Read the generated Dockerfile and adjust paths for workspace root context
                    let dockerfile_content = fs::read_to_string(&file_path).map_err(|err| {
                        error!("Failed to read generated Dockerfile: {}", err);
                        RoutineFailure::new(
                            Message::new(
                                "Failed".to_string(),
                                "to read generated Dockerfile".to_string(),
                            ),
                            err,
                        )
                    })?;

                    // Replace relative paths in COPY commands for config files
                    let adjusted_dockerfile = dockerfile_content
                        .replace(
                            "COPY --chown=moose:moose ./project.tom[l]",
                                                &format!(
                        "COPY --chown=moose:moose {relative_project_path}/project.tom[l]"
                    ),
                        )
                        .replace(
                            "COPY --chown=moose:moose ./moose.config.tom[l]",
                            &format!(
                                "COPY --chown=moose:moose {relative_project_path}/moose.config.tom[l]"
                            ),
                        )
                        .replace(
                            "COPY --chown=moose:moose ./versions",
                            &format!(
                                "COPY --chown=moose:moose {relative_project_path}/.moose/packager/versions"
                            ),
                        );

                    // Write the adjusted Dockerfile to the workspace root
                    fs::write(&temp_dockerfile, adjusted_dockerfile).map_err(|err| {
                        error!("Failed to write temporary Dockerfile: {}", err);
                        RoutineFailure::new(
                            Message::new(
                                "Failed".to_string(),
                                "to write temporary Dockerfile".to_string(),
                            ),
                            err,
                        )
                    })?;

                    (workspace_root, temp_dockerfile)
                } else {
                    info!("Invalid monorepo info, falling back to standard build");
                    (internal_dir.join("packager"), file_path)
                }
            }
            Err(e) => {
                info!(
                    "Failed to read monorepo info: {}, falling back to standard build",
                    e
                );
                (internal_dir.join("packager"), file_path)
            }
        }
    } else {
        // Standard build
        (internal_dir.join("packager"), file_path)
    };

    let build_all = is_amd64 == is_arm64;

    if build_all || is_amd64 {
        info!("Creating docker linux/amd64 image");
        let buildx_result = with_spinner_completion(
            "Creating docker linux/amd64 image",
            "Docker linux/amd64 image created successfully",
            || {
                // For monorepo builds, we need to copy config files to workspace root
                if build_context != internal_dir.join("packager") {
                    copy_project_config_files(
                        &project.project_location,
                        &build_context,
                        &internal_dir,
                    );
                }

                docker_client.buildx(
                    &build_context,
                    cli_version,
                    "linux/amd64",
                    "x86_64-unknown-linux-gnu",
                )
            },
            !project.is_production,
        );
        match buildx_result {
            Ok(_) => {
                info!("Docker image created");
            }
            Err(err) => {
                error!("Failed to create docker image: {}", err);
                return Err(RoutineFailure::new(
                    Message::new("Failed".to_string(), "to create docker image".to_string()),
                    err,
                ));
            }
        }
    }

    if build_all || is_arm64 {
        info!("Creating docker linux/arm64 image");
        let buildx_result = with_spinner_completion(
            "Creating docker linux/arm64 image",
            "Docker linux/arm64 image created successfully",
            || {
                // For monorepo builds, we need to copy config files to workspace root
                if build_context != internal_dir.join("packager") {
                    copy_project_config_files(
                        &project.project_location,
                        &build_context,
                        &internal_dir,
                    );
                }

                docker_client.buildx(
                    &build_context,
                    cli_version,
                    "linux/arm64",
                    "aarch64-unknown-linux-gnu",
                )
            },
            !project.is_production,
        );
        match buildx_result {
            Ok(_) => {
                info!("Docker image created");
            }
            Err(err) => {
                error!("Failed to create docker image: {}", err);
                return Err(RoutineFailure::new(
                    Message::new("Failed".to_string(), "to create docker image".to_string()),
                    err,
                ));
            }
        }
    }

    // Clean up temporary files for monorepo builds
    if build_context != internal_dir.join("packager") {
        // Remove temporary Dockerfile
        if dockerfile_path.exists()
            && dockerfile_path.file_name() == Some(std::ffi::OsStr::new("Dockerfile"))
        {
            fs::remove_file(&dockerfile_path).ok();
        }

        // Remove temporary config files
        let temp_project_toml = build_context.join("project.toml");
        let temp_moose_config = build_context.join("moose.config.toml");
        fs::remove_file(temp_project_toml).ok();
        fs::remove_file(temp_moose_config).ok();

        // Remove monorepo info file
        fs::remove_file(monorepo_info_path).ok();
    }

    Ok(RoutineSuccess::success(Message::new(
        "Successfully".to_string(),
        "created docker image for deployment".to_string(),
    )))
}

/// Detects if the project is part of a pnpm workspace by looking for pnpm-workspace.yaml
fn find_pnpm_workspace_root(start_dir: &Path) -> Option<PathBuf> {
    let mut current_dir = start_dir.to_path_buf();

    loop {
        let workspace_file = current_dir.join("pnpm-workspace.yaml");
        if workspace_file.exists() {
            debug!("Found pnpm-workspace.yaml at: {:?}", current_dir);
            return Some(current_dir);
        }

        match current_dir.parent() {
            Some(parent) => current_dir = parent.to_path_buf(),
            None => break,
        }
    }

    None
}

/// Reads and parses pnpm-workspace.yaml to get package patterns
fn read_workspace_config(workspace_root: &Path) -> Result<Vec<String>, RoutineFailure> {
    let workspace_yaml_path = workspace_root.join("pnpm-workspace.yaml");
    let content = fs::read_to_string(&workspace_yaml_path).map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Failed".to_string(),
                "to read pnpm-workspace.yaml".to_string(),
            ),
            e,
        )
    })?;

    // Parse YAML to extract package patterns
    let mut patterns = Vec::new();
    let mut in_packages = false;

    for line in content.lines() {
        let trimmed = line.trim();

        // Skip empty lines and comments
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Check if we're entering the packages section
        if trimmed == "packages:" {
            in_packages = true;
            continue;
        }

        // If we're in packages section
        if in_packages {
            // Check if this is a list item (handles various indentations)
            if let Some(item) = trimmed.strip_prefix("- ") {
                // Remove quotes if present
                let pattern = item.trim_matches('"').trim_matches('\'');
                patterns.push(pattern.to_string());
            } else if !trimmed.starts_with(' ') && !trimmed.starts_with('\t') {
                // We've hit a new top-level key, exit packages section
                in_packages = false;
            }
        }
    }

    Ok(patterns)
}

/// Generates COPY commands for workspace packages that exist
fn generate_workspace_copy_commands(workspace_root: &Path, patterns: &[String]) -> String {
    let mut copy_commands = Vec::new();

    for pattern in patterns {
        // Remove wildcards for COPY command
        let base_path = pattern.replace("/*", "");

        // Check if the directory exists
        let full_path = workspace_root.join(&base_path);
        if full_path.exists() && full_path.is_dir() {
            copy_commands.push(format!("COPY {base_path} ./{base_path}"));
        } else {
            debug!("Skipping non-existent workspace directory: {base_path}");
        }
    }

    copy_commands.join("\n")
}

/// Analyzes TypeScript path mappings in tsconfig.json for monorepo Docker builds.
///
/// In monorepos, TypeScript projects often use path mappings like:
/// ```json
/// {
///   "compilerOptions": {
///     "paths": {
///       "@shared/*": ["../shared/src/*"],
///       "@utils/*": ["../../packages/utils/src/*"]
///     }
///   }
/// }
/// ```
///
/// These relative paths break in Docker because packages get installed to node_modules.
/// This function:
/// 1. Reads tsconfig.json from the project directory
/// 2. Extracts all path mappings from compilerOptions.paths
/// 3. For each path, traverses up the filesystem to find the corresponding package.json
/// 4. Maps the original relative path to the package name for node_modules transformation
///
/// Returns PathMapping structs containing the alias, original path, package name, and directory.
fn analyze_typescript_paths(
    workspace_root: &Path,
    relative_project_path: &str,
) -> Result<Vec<PathMapping>, std::io::Error> {
    let tsconfig_path = workspace_root
        .join(relative_project_path)
        .join("tsconfig.json");

    if !tsconfig_path.exists() {
        debug!("No tsconfig.json found at {:?}", tsconfig_path);
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&tsconfig_path)?;
    let tsconfig: JsonValue = match serde_json::from_str(&content) {
        Ok(config) => config,
        Err(e) => {
            debug!("Failed to parse tsconfig.json: {}", e);
            return Ok(Vec::new());
        }
    };

    let mut mappings = Vec::new();

    if let Some(paths) = tsconfig
        .get("compilerOptions")
        .and_then(|co| co.get("paths"))
        .and_then(|p| p.as_object())
    {
        for (alias, path_array) in paths {
            if let Some(paths) = path_array.as_array() {
                for path in paths {
                    if let Some(path_str) = path.as_str() {
                        if let Some((package_info, package_dir)) = read_package_from_typescript_path(
                            workspace_root,
                            relative_project_path,
                            path_str,
                        ) {
                            mappings.push(PathMapping {
                                alias: alias.clone(),
                                original_path: path_str.to_string(),
                                package_name: package_info.name,
                                package_directory: package_dir,
                            });
                        }
                    }
                }
            }
        }
    }

    debug!("Found {} TypeScript path mappings", mappings.len());
    for mapping in &mappings {
        debug!(
            "  {} -> {} (package: {}, dir: {})",
            mapping.alias, mapping.original_path, mapping.package_name, mapping.package_directory
        );
    }

    Ok(mappings)
}

/// Reads package.json from a TypeScript path and returns the package name and directory
fn read_package_from_typescript_path(
    workspace_root: &Path,
    relative_project_path: &str,
    ts_path: &str,
) -> Option<(PackageInfo, String)> {
    let project_dir = workspace_root.join(relative_project_path);
    let resolved_path = if ts_path.starts_with('/') {
        PathBuf::from(ts_path)
    } else {
        project_dir.join(ts_path)
    };

    // Traverse up the path to find package.json
    let mut current_path = resolved_path.as_path();
    while let Some(parent) = current_path.parent() {
        let package_json_path = parent.join("package.json");

        if !package_json_path.exists() {
            current_path = parent;
            continue;
        }

        let package_name = fs::read_to_string(&package_json_path)
            .ok()
            .and_then(|content| serde_json::from_str::<JsonValue>(&content).ok())
            .and_then(|json| json.get("name")?.as_str().map(str::to_string))?;

        let package_dir = parent.file_name()?.to_str()?.to_string();

        debug!(
            "Found package: {} in directory: {} at {:?}",
            package_name, package_dir, package_json_path
        );

        return Some((PackageInfo { name: package_name }, package_dir));
    }

    None
}

/// Extracts the path suffix after the package directory (generic approach)
fn extract_path_suffix(original_path: &str, package_directory: &str) -> String {
    // Find the last occurrence of the package directory in the path
    if let Some(package_pos) = original_path.rfind(package_directory) {
        let after_package_pos = package_pos + package_directory.len();
        if after_package_pos < original_path.len() {
            original_path[after_package_pos..].to_string()
        } else {
            String::new()
        }
    } else {
        // If package directory not found, preserve the whole path as suffix
        original_path.to_string()
    }
}

/// Transforms tsconfig.json for Docker by pre-computing node_modules paths
fn transform_tsconfig_for_docker(
    workspace_root: &Path,
    relative_project_path: &str,
    mappings: &[PathMapping],
    internal_dir: &Path,
) -> Result<(), std::io::Error> {
    if mappings.is_empty() {
        debug!("No TypeScript path mappings to transform");
        return Ok(());
    }

    let original_tsconfig_path = workspace_root
        .join(relative_project_path)
        .join("tsconfig.json");
    let packager_tsconfig_path = internal_dir.join("packager/tsconfig.json");

    if !original_tsconfig_path.exists() {
        debug!("No tsconfig.json found at {:?}", original_tsconfig_path);
        return Ok(());
    }

    let content = fs::read_to_string(&original_tsconfig_path)?;
    let mut tsconfig: JsonValue = serde_json::from_str(&content)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    let mut transformation_count = 0;

    // Transform paths directly in Rust
    if let Some(paths) = tsconfig
        .get_mut("compilerOptions")
        .and_then(|co| co.get_mut("paths"))
        .and_then(|p| p.as_object_mut())
    {
        for (_alias, path_array) in paths.iter_mut() {
            if let Some(paths) = path_array.as_array_mut() {
                for path in paths.iter_mut() {
                    if let Some(path_str) = path.as_str() {
                        // Find the mapping for this path
                        if let Some(mapping) = mappings.iter().find(|m| m.original_path == path_str)
                        {
                            // Extract the suffix after the package directory
                            let suffix = extract_path_suffix(path_str, &mapping.package_directory);

                            // Transform to node_modules path with the discovered package name
                            let new_path =
                                format!("./node_modules/{}{}", mapping.package_name, suffix);

                            info!("Transforming TypeScript path: {} -> {}", path_str, new_path);
                            *path = serde_json::Value::String(new_path);
                            transformation_count += 1;
                        }
                    }
                }
            }
        }
    }

    if transformation_count > 0 {
        // Write the transformed tsconfig.json to packager directory
        let transformed_content = serde_json::to_string_pretty(&tsconfig)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

        // Ensure the packager directory exists
        if let Some(parent) = packager_tsconfig_path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::write(&packager_tsconfig_path, transformed_content)?;
        info!(
            "Created transformed tsconfig.json with {} path updates at {:?}",
            transformation_count, packager_tsconfig_path
        );
    } else {
        info!("No TypeScript paths needed transformation");
    }

    Ok(())
}

/// Creates standard TypeScript Dockerfile content (non-monorepo)
fn create_standard_typescript_dockerfile_content(
    project: &Project,
    node_version: &str,
) -> Result<String, RoutineFailure> {
    let project_root = project.project_location.clone();
    let (install_command, lock_file_copy) =
        if let Some(lock_file_path) = get_lock_file_path(&project_root) {
            // Determine package manager based on detected lock file
            let lock_file_name = lock_file_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("");

            match lock_file_name {
                "pnpm-lock.yaml" => (
                    "RUN pnpm install --frozen-lockfile".to_string(),
                    "COPY --chown=moose:moose ./pnpm-lock.yaml ./pnpm-lock.yaml",
                ),
                "package-lock.json" => (
                    "RUN npm ci".to_string(),
                    "COPY --chown=moose:moose ./package-lock.json ./package-lock.json",
                ),
                "yarn.lock" => (
                    "RUN yarn install --frozen-lockfile".to_string(),
                    "COPY --chown=moose:moose ./yarn.lock ./yarn.lock",
                ),
                _ => {
                    // Fallback to configured package manager if lock file is unrecognized
                    let pm = &project.typescript_config.package_manager;
                    (format!("RUN {pm} install"), "")
                }
            }
        } else {
            // No lock file found, use configured package manager
            let pm = &project.typescript_config.package_manager;
            (format!("RUN {pm} install"), "")
        };

    // Build copy commands for package files
    let mut copy_commands = vec![
        "COPY --chown=moose:moose ./package.json ./package.json",
        "COPY --chown=moose:moose ./tsconfig.json ./tsconfig.json",
        "COPY --chown=moose:moose ./app ./app",
    ];

    // Add lock file copy command if detected
    if !lock_file_copy.is_empty() {
        copy_commands.push(lock_file_copy);
    }

    let copy_section = copy_commands.join("\n                    ");

    let install = DOCKER_FILE_COMMON
        .replace(
            "COPY_PACKAGE_FILE",
            &format!("\n                    {copy_section}"),
        )
        .replace("INSTALL_COMMAND", &install_command);

    let ts_base_dockerfile = generate_ts_base_dockerfile(node_version);
    Ok(format!("{ts_base_dockerfile}{install}"))
}

/// Creates standard TypeScript Dockerfile and writes it to disk
fn create_standard_typescript_dockerfile(
    project: &Project,
    internal_dir: &Path,
    node_version: &str,
) -> Result<RoutineSuccess, RoutineFailure> {
    let dockerfile_content = create_standard_typescript_dockerfile_content(project, node_version)?;
    let file_path = internal_dir.join("packager/Dockerfile");

    fs::write(&file_path, dockerfile_content).map_err(|err| {
        error!("Failed to write Docker file for project: {}", err);
        RoutineFailure::new(
            Message::new(
                "Failed".to_string(),
                "to write Docker file for project".to_string(),
            ),
            err,
        )
    })?;

    info!("Dockerfile created at: {:?}", file_path);
    Ok(RoutineSuccess::success(Message::new(
        "Successfully".to_string(),
        "created dockerfile".to_string(),
    )))
}
