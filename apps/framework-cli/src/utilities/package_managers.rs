//! Utilities for interacting with npm.

use std::{fmt, path::Path, path::PathBuf, process::Command};

use home::home_dir;
use tracing::{debug, error};

use crate::utilities::constants::{PACKAGE_LOCK_JSON, PNPM_LOCK, YARN_LOCK};

pub fn get_root() -> Result<PathBuf, std::io::Error> {
    let result = Command::new("npm").arg("root").arg("-g").output()?;

    let stdout =
        String::from_utf8(result.stdout).expect("Failed to get npm root. Is npm installed?");

    Ok(PathBuf::from(stdout.trim()))
}

pub fn get_or_create_global_folder() -> Result<PathBuf, std::io::Error> {
    //! Get the global folder for npm.
    //!
    //! # Returns
    //! - `Result<PathBuf, std::io::Error>` - A result containing the path to the global folder.
    //!
    let home_dir = home_dir().expect("Failed to get home directory.");

    let global_mod_folder = home_dir.join(".node_modules");

    if global_mod_folder.exists() {
        return Ok(global_mod_folder);
    } else {
        std::fs::create_dir(&global_mod_folder)?;
    }

    Ok(global_mod_folder)
}

pub enum PackageManager {
    Npm,
    Pnpm,
}

/// Gets the installed pnpm version by running `pnpm --version`.
///
/// # Returns
///
/// * `Option<String>` - The version string (e.g., "10.24.0") or None if pnpm is not installed
pub fn get_pnpm_version() -> Option<String> {
    let output = Command::new("pnpm").arg("--version").output().ok()?;

    if !output.status.success() {
        debug!("pnpm --version failed");
        return None;
    }

    let version = String::from_utf8(output.stdout).ok()?;
    let version = version.trim().to_string();
    debug!("Detected pnpm version: {}", version);
    Some(version)
}

/// Checks if the pnpm version supports modern deploy (v10+).
///
/// # Arguments
///
/// * `version` - The version string from `pnpm --version`
///
/// # Returns
///
/// * `bool` - True if version is >= 10.0.0
pub fn is_pnpm_version_supported(version: &str) -> bool {
    // Parse major version from "10.24.0" or similar
    if let Some(major_str) = version.split('.').next() {
        if let Ok(major) = major_str.parse::<u32>() {
            return major >= 10;
        }
    }
    // If we can't parse, assume it's supported to avoid false negatives
    debug!(
        "Could not parse pnpm version '{}', assuming supported",
        version
    );
    true
}

/// Checks local pnpm version and returns a warning message if < v10.
///
/// This is separate from deploy mode detection because local pnpm version
/// doesn't affect Docker builds (which use pnpm@latest), but we still want
/// to inform users they should upgrade for local development benefits.
///
/// # Returns
///
/// * `Option<String>` - Warning message if local pnpm is < v10, None otherwise
pub fn check_local_pnpm_version_warning() -> Option<String> {
    let version = get_pnpm_version()?;
    if !is_pnpm_version_supported(&version) {
        Some(format!(
            "Local pnpm v{} detected. Consider upgrading to v10+ for improved local development experience. \
Docker builds use pnpm@latest regardless of local version.",
            version
        ))
    } else {
        None
    }
}

impl fmt::Display for PackageManager {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PackageManager::Npm => write!(f, "npm"),
            PackageManager::Pnpm => write!(f, "pnpm"),
        }
    }
}

/// Determines how pnpm deploy should be invoked for Docker builds.
#[derive(Debug, Clone, PartialEq)]
pub enum PnpmDeployMode {
    /// Use modern `pnpm deploy` which respects the lockfile
    Modern,
    /// Use `pnpm deploy --legacy` which re-resolves dependencies
    Legacy(LegacyReason),
}

/// Reason why legacy pnpm deploy mode is required.
#[derive(Debug, Clone, PartialEq)]
pub enum LegacyReason {
    /// .npmrc doesn't have inject-workspace-packages=true
    NpmrcMissingSetting,
    /// .npmrc has the setting, but lockfile wasn't regenerated with it
    LockfileMissingSetting,
    /// Lockfile has the setting but .npmrc doesn't (inconsistent state)
    LockfileHasButNpmrcMissing,
    /// Not in a pnpm workspace at all
    NotPnpmWorkspace,
}

pub fn install_packages(
    directory: &PathBuf,
    package_manager: &PackageManager,
) -> Result<(), std::io::Error> {
    //! Install packages in a directory.
    //! This is useful for installing packages in a directory other than the current directory.

    debug!("Installing packages in directory: {:?}", directory);

    let mut command = Command::new(package_manager.to_string());
    command.current_dir(directory);
    command.arg("install");

    let output = command.output()?; // We should explore not using output here and instead using spawn.
    let stdout = output.stdout.clone();
    match String::from_utf8(output.stdout) {
        Ok(val) => {
            debug!("{}", val);
        }
        Err(e) => {
            error!(
                "Failed to decode stdout as UTF-8 for command: `{}` with args {:?} in directory {:?}. Raw output: {:?}. Error: {:?}",
                package_manager,
                command.get_args().collect::<Vec<_>>(),
                command.get_current_dir(),
                &stdout,
                e
            );
        }
    }

    Ok(())
}

pub fn run_build(
    directory: &PathBuf,
    package_manager: &PackageManager,
) -> Result<(), std::io::Error> {
    let mut command = Command::new(package_manager.to_string());
    command.current_dir(directory);
    command.arg("run");
    command.arg("build");

    let output = command.output()?; // We should explore not using output here and instead using spawn.
    let stdout = output.stdout.clone();
    match String::from_utf8(output.stdout) {
        Ok(val) => {
            debug!("{}", val);
        }
        Err(e) => {
            error!(
                "Failed to decode stdout as UTF-8 for command: `{}` with args {:?} in directory {:?}. Raw output: {:?}. Error: {:?}",
                package_manager,
                command.get_args().collect::<Vec<_>>(),
                command.get_current_dir(),
                &stdout,
                e
            );
        }
    }

    Ok(())
}

pub fn link_sdk(
    directory: &PathBuf,
    package_name: Option<String>,
    package_manager: &PackageManager,
) -> Result<(), std::io::Error> {
    //! Links a package to the global pnpm folder if package_name is None. If the package_name is Some, then it will link the package to
    //! the global pnpm folder with the given name.
    let mut command = Command::new(package_manager.to_string());
    command.current_dir(directory);
    command.arg("link");
    command.arg("--global");

    if let Some(name) = package_name {
        command.arg(name);
    }

    let output = command.output()?; // We should explore not using output here and instead using spawn.
    let stdout = output.stdout.clone();
    match String::from_utf8(output.stdout) {
        Ok(val) => {
            debug!("{}", val);
        }
        Err(e) => {
            error!(
                "Failed to decode stdout as UTF-8 for command: `{}` with args {:?} in directory {:?}. Raw output: {:?}. Error: {:?}",
                package_manager,
                command.get_args().collect::<Vec<_>>(),
                command.get_current_dir(),
                &stdout,
                e
            );
        }
    }

    Ok(())
}

/// Detects the package manager to use based on lock files present in the project directory.
///
/// The detection follows this priority order:
/// 1. pnpm-lock.yaml -> pnpm (searches up the directory tree for monorepo support)
/// 2. package-lock.json -> npm (only in current directory)
/// 3. Default to npm if no lock files found
///
/// # Arguments
///
/// * `project_dir` - Path to the project directory to scan for lock files
///
/// # Returns
///
/// * `PackageManager` - The detected package manager
pub fn detect_package_manager(project_dir: &PathBuf) -> PackageManager {
    debug!("Detecting package manager in directory: {:?}", project_dir);

    // Check for pnpm-lock.yaml up the directory tree (for monorepo support)
    if find_pnpm_lock_up_tree(project_dir).is_some() {
        debug!("Found pnpm-lock.yaml in directory tree, using pnpm");
        return PackageManager::Pnpm;
    }

    // Check for package-lock.json
    if project_dir.join(PACKAGE_LOCK_JSON).exists() {
        debug!("Found package-lock.json, using npm");
        return PackageManager::Npm;
    }

    // Default to npm
    debug!("No lock files found, defaulting to npm");
    PackageManager::Npm
}

/// Searches up the directory tree for pnpm-lock.yaml file.
///
/// This is needed because in pnpm workspaces, the lock file is typically
/// at the workspace root, not in individual package directories.
///
/// # Arguments
///
/// * `start_dir` - Directory to start searching from
///
/// # Returns
///
/// * `Option<PathBuf>` - Path to the pnpm-lock.yaml file if found
fn find_pnpm_lock_up_tree(start_dir: &PathBuf) -> Option<PathBuf> {
    let mut current_dir = start_dir.clone();

    loop {
        let lock_file = current_dir.join(PNPM_LOCK);
        if lock_file.exists() {
            debug!("Found pnpm-lock.yaml at: {:?}", lock_file);
            return Some(lock_file);
        }

        // Move up one directory
        match current_dir.parent() {
            Some(parent) => current_dir = parent.to_path_buf(),
            None => break, // Reached filesystem root
        }
    }

    debug!(
        "No pnpm-lock.yaml found in directory tree starting from: {:?}",
        start_dir
    );
    None
}

/// Gets the actual path to the lock file for the detected package manager.
///
/// This is useful for copying lock files that might be in parent directories
/// (e.g., pnpm workspaces) to the package directory.
///
/// # Arguments
///
/// * `project_dir` - Path to the project directory
///
/// # Returns
///
/// * `Option<PathBuf>` - Path to the lock file if found
pub fn get_lock_file_path(project_dir: &PathBuf) -> Option<PathBuf> {
    debug!("Getting lock file path for directory: {:?}", project_dir);

    // Check for pnpm-lock.yaml up the directory tree first
    if let Some(pnpm_lock_path) = find_pnpm_lock_up_tree(project_dir) {
        return Some(pnpm_lock_path);
    }

    // Check for package-lock.json in current directory only
    let npm_lock_path = project_dir.join(PACKAGE_LOCK_JSON);
    if npm_lock_path.exists() {
        debug!("Found package-lock.json at: {:?}", npm_lock_path);
        return Some(npm_lock_path);
    }

    // Check for yarn.lock in current directory only
    let yarn_lock_path = project_dir.join(YARN_LOCK);
    if yarn_lock_path.exists() {
        debug!("Found yarn.lock at: {:?}", yarn_lock_path);
        return Some(yarn_lock_path);
    }

    debug!("No lock file found for directory: {:?}", project_dir);
    None
}

/// Checks if .npmrc has inject-workspace-packages=true setting.
///
/// This setting is required for modern `pnpm deploy` to work correctly
/// with lockfile respect in monorepo builds.
///
/// # Arguments
///
/// * `workspace_root` - Path to the workspace root directory
///
/// # Returns
///
/// * `bool` - True if the setting is present and set to true
pub fn has_inject_workspace_packages_in_npmrc(workspace_root: &Path) -> bool {
    let npmrc_path = workspace_root.join(".npmrc");

    if !npmrc_path.exists() {
        debug!("No .npmrc found at {:?}", npmrc_path);
        return false;
    }

    match std::fs::read_to_string(&npmrc_path) {
        Ok(content) => {
            for line in content.lines() {
                let trimmed = line.trim();
                // Skip comments
                if trimmed.starts_with('#') || trimmed.starts_with(';') {
                    continue;
                }
                // Check for the setting (handle various formats)
                if trimmed.starts_with("inject-workspace-packages") {
                    // Parse the value - could be =true, = true, =TRUE, etc.
                    if let Some(value) = trimmed.split('=').nth(1) {
                        let value = value.trim().to_lowercase();
                        if value == "true" {
                            debug!("Found inject-workspace-packages=true in .npmrc");
                            return true;
                        }
                    }
                }
            }
            debug!("inject-workspace-packages=true not found in .npmrc");
            false
        }
        Err(e) => {
            debug!("Failed to read .npmrc: {}", e);
            false
        }
    }
}

/// Checks if pnpm-lock.yaml has injectWorkspacePackages: true in settings.
///
/// The lockfile stores the settings that were active when it was generated.
/// If .npmrc has inject-workspace-packages=true but the lockfile doesn't
/// have this setting, the lockfile needs to be regenerated.
///
/// # Arguments
///
/// * `workspace_root` - Path to the workspace root directory
///
/// # Returns
///
/// * `bool` - True if the lockfile has injectWorkspacePackages: true
pub fn has_inject_workspace_packages_in_lockfile(workspace_root: &Path) -> bool {
    let lockfile_path = workspace_root.join(PNPM_LOCK);

    if !lockfile_path.exists() {
        debug!("No pnpm-lock.yaml found at {:?}", lockfile_path);
        return false;
    }

    match std::fs::read_to_string(&lockfile_path) {
        Ok(content) => {
            // Simple line-based parsing to find injectWorkspacePackages: true
            // in the settings section. This avoids adding a YAML parsing dependency.
            let mut in_settings = false;

            for line in content.lines() {
                let trimmed = line.trim();

                // Track when we enter/exit settings section
                if trimmed == "settings:" {
                    in_settings = true;
                    continue;
                }

                // Exit settings section when we hit another top-level key
                if in_settings
                    && !line.starts_with(' ')
                    && !line.starts_with('\t')
                    && !trimmed.is_empty()
                {
                    in_settings = false;
                }

                // Look for the setting within settings section
                if in_settings && trimmed.starts_with("injectWorkspacePackages:") {
                    if let Some(value) = trimmed.split(':').nth(1) {
                        let value = value.trim().to_lowercase();
                        if value == "true" {
                            debug!("Found injectWorkspacePackages: true in pnpm-lock.yaml");
                            return true;
                        }
                    }
                }
            }

            debug!("injectWorkspacePackages: true not found in pnpm-lock.yaml settings");
            false
        }
        Err(e) => {
            debug!("Failed to read pnpm-lock.yaml: {}", e);
            false
        }
    }
}

/// Finds the pnpm workspace root by searching up the directory tree.
///
/// Looks for pnpm-workspace.yaml file starting from the given directory
/// and traversing up to parent directories.
///
/// # Arguments
///
/// * `start_dir` - Directory to start searching from
///
/// # Returns
///
/// * `Option<PathBuf>` - Path to workspace root if found
pub fn find_pnpm_workspace_root(start_dir: &Path) -> Option<PathBuf> {
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

    debug!(
        "No pnpm-workspace.yaml found starting from: {:?}",
        start_dir
    );
    None
}

/// Detects whether to use modern or legacy pnpm deploy for Docker builds.
///
/// Modern `pnpm deploy` respects the lockfile but requires:
/// 1. `inject-workspace-packages=true` in .npmrc
/// 2. The lockfile to be generated with that setting active
///
/// If either condition is not met, falls back to legacy mode which
/// re-resolves dependencies (non-deterministic).
///
/// Note: This function does NOT check local pnpm version because Docker builds
/// use pnpm@latest regardless of what's installed locally. Use
/// `check_local_pnpm_version_warning()` separately if you want to warn users
/// about their local pnpm version.
///
/// # Arguments
///
/// * `project_dir` - Path to the project directory (will search up for workspace root)
///
/// # Returns
///
/// * `PnpmDeployMode` - Modern or Legacy with reason
pub fn detect_pnpm_deploy_mode(project_dir: &Path) -> PnpmDeployMode {
    // Check if we're in a pnpm workspace
    let workspace_root = match find_pnpm_workspace_root(project_dir) {
        Some(root) => root,
        None => {
            debug!("Not in a pnpm workspace");
            return PnpmDeployMode::Legacy(LegacyReason::NotPnpmWorkspace);
        }
    };

    let npmrc_has_setting = has_inject_workspace_packages_in_npmrc(&workspace_root);
    let lockfile_has_setting = has_inject_workspace_packages_in_lockfile(&workspace_root);

    match (npmrc_has_setting, lockfile_has_setting) {
        (true, true) => {
            debug!("Both .npmrc and lockfile have inject-workspace-packages - using modern deploy");
            PnpmDeployMode::Modern
        }
        (true, false) => {
            debug!(".npmrc has setting but lockfile doesn't - lockfile needs regeneration");
            PnpmDeployMode::Legacy(LegacyReason::LockfileMissingSetting)
        }
        (false, true) => {
            debug!("Lockfile has setting but .npmrc doesn't - inconsistent state");
            PnpmDeployMode::Legacy(LegacyReason::LockfileHasButNpmrcMissing)
        }
        (false, false) => {
            debug!("Neither .npmrc nor lockfile have inject-workspace-packages setting");
            PnpmDeployMode::Legacy(LegacyReason::NpmrcMissingSetting)
        }
    }
}

/// Generates a condensed single-line warning message for terminal display.
///
/// This is a shorter version of `legacy_deploy_warning_message` suitable for
/// terminal output where multi-line messages would be disruptive.
///
/// # Arguments
///
/// * `reason` - The reason legacy mode is being used
///
/// # Returns
///
/// * `String` - Single-line warning message
pub fn legacy_deploy_terminal_message(reason: &LegacyReason) -> String {
    match reason {
        LegacyReason::NotPnpmWorkspace => {
            "Not in a pnpm workspace - using legacy pnpm deploy".to_string()
        }
        _ => "Using legacy pnpm deploy - add `inject-workspace-packages=true` to .npmrc and run `pnpm install`".to_string(),
    }
}

/// Returns the pnpm deploy flag based on deploy mode.
///
/// Modern mode uses no flag. Legacy mode uses `--legacy` flag.
/// Since Docker builds use pnpm@latest (v10+), the `--legacy` flag is always supported.
///
/// # Arguments
///
/// * `mode` - The detected pnpm deploy mode
///
/// # Returns
///
/// * `&'static str` - The flag to append to `pnpm deploy` command ("" or " --legacy")
pub fn get_pnpm_deploy_flag(mode: &PnpmDeployMode) -> &'static str {
    match mode {
        PnpmDeployMode::Modern => "",
        PnpmDeployMode::Legacy(_) => " --legacy",
    }
}

/// Generates a diagnostic warning message for legacy pnpm deploy mode.
///
/// Returns a multi-line message explaining what was detected and how to fix it.
///
/// # Arguments
///
/// * `reason` - The reason legacy mode is being used
///
/// # Returns
///
/// * `String` - Formatted warning message
pub fn legacy_deploy_warning_message(reason: &LegacyReason) -> String {
    let detected = match reason {
        LegacyReason::NpmrcMissingSetting => ".npmrc missing `inject-workspace-packages=true`",
        LegacyReason::LockfileMissingSetting => {
            ".npmrc has `inject-workspace-packages=true` but lockfile was not regenerated"
        }
        LegacyReason::LockfileHasButNpmrcMissing => {
            "lockfile has inject setting but .npmrc doesn't - inconsistent state"
        }
        LegacyReason::NotPnpmWorkspace => "not in a pnpm workspace (no pnpm-workspace.yaml found)",
    };

    format!(
        r#"Using legacy pnpm deploy - Docker builds may not respect your lockfile.

Detected: {}

To fix:
  1. Add `inject-workspace-packages=true` to your .npmrc
  2. Run `pnpm install` to regenerate your lockfile"#,
        detected
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_pnpm_deploy_mode_default() {
        use super::*;
        // Test that we can create the enum variants
        let modern = PnpmDeployMode::Modern;
        let legacy = PnpmDeployMode::Legacy(LegacyReason::NpmrcMissingSetting);

        assert_eq!(modern, PnpmDeployMode::Modern);
        assert!(matches!(legacy, PnpmDeployMode::Legacy(_)));
    }

    #[test]
    fn test_npmrc_no_file() {
        use super::*;
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        assert!(!has_inject_workspace_packages_in_npmrc(dir.path()));
    }

    #[test]
    fn test_npmrc_empty_file() {
        use super::*;
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        std::fs::File::create(dir.path().join(".npmrc")).unwrap();
        assert!(!has_inject_workspace_packages_in_npmrc(dir.path()));
    }

    #[test]
    fn test_npmrc_setting_present() {
        use super::*;
        use std::io::Write;
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let mut file = std::fs::File::create(dir.path().join(".npmrc")).unwrap();
        writeln!(file, "inject-workspace-packages=true").unwrap();
        assert!(has_inject_workspace_packages_in_npmrc(dir.path()));
    }

    #[test]
    fn test_npmrc_setting_case_insensitive() {
        use super::*;
        use std::io::Write;
        use tempfile::tempdir;

        // TRUE
        let dir1 = tempdir().unwrap();
        let mut file1 = std::fs::File::create(dir1.path().join(".npmrc")).unwrap();
        writeln!(file1, "inject-workspace-packages=TRUE").unwrap();
        assert!(has_inject_workspace_packages_in_npmrc(dir1.path()));

        // True
        let dir2 = tempdir().unwrap();
        let mut file2 = std::fs::File::create(dir2.path().join(".npmrc")).unwrap();
        writeln!(file2, "inject-workspace-packages=True").unwrap();
        assert!(has_inject_workspace_packages_in_npmrc(dir2.path()));
    }

    #[test]
    fn test_npmrc_setting_explicit_false() {
        use super::*;
        use std::io::Write;
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let mut file = std::fs::File::create(dir.path().join(".npmrc")).unwrap();
        writeln!(file, "inject-workspace-packages=false").unwrap();
        assert!(!has_inject_workspace_packages_in_npmrc(dir.path()));
    }

    #[test]
    fn test_npmrc_setting_absent() {
        use super::*;
        use std::io::Write;
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let mut file = std::fs::File::create(dir.path().join(".npmrc")).unwrap();
        writeln!(file, "some-other-setting=value").unwrap();
        assert!(!has_inject_workspace_packages_in_npmrc(dir.path()));
    }

    #[test]
    fn test_npmrc_hash_comment_ignored() {
        use super::*;
        use std::io::Write;
        use tempfile::tempdir;

        // Per npmrc docs: Lines beginning with # are comments
        let dir = tempdir().unwrap();
        let mut file = std::fs::File::create(dir.path().join(".npmrc")).unwrap();
        writeln!(file, "# inject-workspace-packages=true").unwrap();
        assert!(!has_inject_workspace_packages_in_npmrc(dir.path()));
    }

    #[test]
    fn test_npmrc_semicolon_comment_ignored() {
        use super::*;
        use std::io::Write;
        use tempfile::tempdir;

        // Per npmrc docs: Lines beginning with ; are comments
        let dir = tempdir().unwrap();
        let mut file = std::fs::File::create(dir.path().join(".npmrc")).unwrap();
        writeln!(file, "; inject-workspace-packages=true").unwrap();
        assert!(!has_inject_workspace_packages_in_npmrc(dir.path()));
    }

    #[test]
    fn test_npmrc_setting_after_comments() {
        use super::*;
        use std::io::Write;
        use tempfile::tempdir;

        // Real-world .npmrc with comments followed by settings
        let dir = tempdir().unwrap();
        let mut file = std::fs::File::create(dir.path().join(".npmrc")).unwrap();
        writeln!(file, "# last modified: 01 Jan 2024").unwrap();
        writeln!(file, "; Enable workspace package injection").unwrap();
        writeln!(file, "inject-workspace-packages=true").unwrap();
        assert!(has_inject_workspace_packages_in_npmrc(dir.path()));
    }

    #[test]
    fn test_npmrc_setting_among_multiple_settings() {
        use super::*;
        use std::io::Write;
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let mut file = std::fs::File::create(dir.path().join(".npmrc")).unwrap();
        writeln!(file, "shamefully-hoist=true").unwrap();
        writeln!(file, "inject-workspace-packages=true").unwrap();
        writeln!(file, "strict-peer-dependencies=false").unwrap();
        assert!(has_inject_workspace_packages_in_npmrc(dir.path()));
    }

    #[test]
    fn test_has_inject_workspace_packages_in_lockfile() {
        use super::*;
        use std::io::Write;
        use tempfile::tempdir;

        // Test with setting present in lockfile
        let dir = tempdir().unwrap();
        let lockfile_path = dir.path().join("pnpm-lock.yaml");
        let mut file = std::fs::File::create(&lockfile_path).unwrap();
        writeln!(
            file,
            r#"lockfileVersion: '9.0'
settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false
  injectWorkspacePackages: true

importers:
  .: {{}}"#
        )
        .unwrap();

        assert!(has_inject_workspace_packages_in_lockfile(dir.path()));

        // Test with setting absent
        let dir2 = tempdir().unwrap();
        let lockfile_path2 = dir2.path().join("pnpm-lock.yaml");
        let mut file2 = std::fs::File::create(&lockfile_path2).unwrap();
        writeln!(
            file2,
            r#"lockfileVersion: '9.0'
settings:
  autoInstallPeers: true

importers:
  .: {{}}"#
        )
        .unwrap();

        assert!(!has_inject_workspace_packages_in_lockfile(dir2.path()));

        // Test with no lockfile
        let dir3 = tempdir().unwrap();
        assert!(!has_inject_workspace_packages_in_lockfile(dir3.path()));
    }

    #[test]
    fn test_find_pnpm_workspace_root() {
        use super::*;
        use std::io::Write;
        use tempfile::tempdir;

        // Create a mock monorepo structure
        let dir = tempdir().unwrap();
        let workspace_root = dir.path();

        // Create pnpm-workspace.yaml at root
        let workspace_yaml = workspace_root.join("pnpm-workspace.yaml");
        let mut file = std::fs::File::create(&workspace_yaml).unwrap();
        writeln!(file, "packages:\n  - 'apps/*'").unwrap();

        // Create a nested project directory
        let project_dir = workspace_root.join("apps").join("my-project");
        std::fs::create_dir_all(&project_dir).unwrap();

        // Should find workspace root from project dir
        let found = find_pnpm_workspace_root(&project_dir);
        assert!(found.is_some());
        assert_eq!(found.unwrap(), workspace_root);

        // Should find workspace root from root itself
        let found_from_root = find_pnpm_workspace_root(workspace_root);
        assert!(found_from_root.is_some());
        assert_eq!(found_from_root.unwrap(), workspace_root);

        // Should return None for directory without workspace
        let unrelated_dir = tempdir().unwrap();
        let not_found = find_pnpm_workspace_root(unrelated_dir.path());
        assert!(not_found.is_none());
    }

    #[test]
    fn test_detect_pnpm_deploy_mode_not_workspace() {
        use super::*;
        use tempfile::tempdir;

        // No workspace = NotPnpmWorkspace
        // Note: local pnpm version doesn't affect deploy mode detection
        let dir = tempdir().unwrap();
        let result = detect_pnpm_deploy_mode(dir.path());
        assert_eq!(
            result,
            PnpmDeployMode::Legacy(LegacyReason::NotPnpmWorkspace)
        );
    }

    #[test]
    fn test_detect_pnpm_deploy_mode_npmrc_missing() {
        use super::*;
        use tempfile::tempdir;

        // Workspace exists but no .npmrc
        let dir = tempdir().unwrap();
        let workspace_yaml = dir.path().join("pnpm-workspace.yaml");
        std::fs::File::create(&workspace_yaml).unwrap();

        let result = detect_pnpm_deploy_mode(dir.path());
        assert_eq!(
            result,
            PnpmDeployMode::Legacy(LegacyReason::NpmrcMissingSetting)
        );
    }

    #[test]
    fn test_detect_pnpm_deploy_mode_lockfile_missing_setting() {
        use super::*;
        use std::io::Write;
        use tempfile::tempdir;

        // Workspace + .npmrc with setting, but lockfile without setting
        let dir = tempdir().unwrap();

        let workspace_yaml = dir.path().join("pnpm-workspace.yaml");
        std::fs::File::create(&workspace_yaml).unwrap();

        let npmrc = dir.path().join(".npmrc");
        let mut file = std::fs::File::create(&npmrc).unwrap();
        writeln!(file, "inject-workspace-packages=true").unwrap();

        let lockfile = dir.path().join("pnpm-lock.yaml");
        let mut file = std::fs::File::create(&lockfile).unwrap();
        writeln!(file, "lockfileVersion: '9.0'\nimporters:\n  .: {{}}").unwrap();

        let result = detect_pnpm_deploy_mode(dir.path());
        assert_eq!(
            result,
            PnpmDeployMode::Legacy(LegacyReason::LockfileMissingSetting)
        );
    }

    #[test]
    fn test_detect_pnpm_deploy_mode_modern() {
        use super::*;
        use std::io::Write;
        use tempfile::tempdir;

        // Full proper configuration
        let dir = tempdir().unwrap();

        let workspace_yaml = dir.path().join("pnpm-workspace.yaml");
        std::fs::File::create(&workspace_yaml).unwrap();

        let npmrc = dir.path().join(".npmrc");
        let mut file = std::fs::File::create(&npmrc).unwrap();
        writeln!(file, "inject-workspace-packages=true").unwrap();

        let lockfile = dir.path().join("pnpm-lock.yaml");
        let mut file = std::fs::File::create(&lockfile).unwrap();
        writeln!(
            file,
            "lockfileVersion: '9.0'\nsettings:\n  injectWorkspacePackages: true\nimporters:\n  .: {{}}"
        )
        .unwrap();

        let result = detect_pnpm_deploy_mode(dir.path());
        assert_eq!(result, PnpmDeployMode::Modern);
    }

    #[test]
    fn test_detect_pnpm_deploy_mode_lockfile_has_but_npmrc_missing() {
        use super::*;
        use std::io::Write;
        use tempfile::tempdir;

        // Edge case: lockfile has setting but .npmrc doesn't
        let dir = tempdir().unwrap();

        let workspace_yaml = dir.path().join("pnpm-workspace.yaml");
        std::fs::File::create(&workspace_yaml).unwrap();

        // .npmrc without the setting
        let npmrc = dir.path().join(".npmrc");
        let mut file = std::fs::File::create(&npmrc).unwrap();
        writeln!(file, "some-other=setting").unwrap();

        let lockfile = dir.path().join("pnpm-lock.yaml");
        let mut file = std::fs::File::create(&lockfile).unwrap();
        writeln!(
            file,
            "lockfileVersion: '9.0'\nsettings:\n  injectWorkspacePackages: true\nimporters:\n  .: {{}}"
        )
        .unwrap();

        let result = detect_pnpm_deploy_mode(dir.path());
        assert_eq!(
            result,
            PnpmDeployMode::Legacy(LegacyReason::LockfileHasButNpmrcMissing)
        );
    }

    #[test]
    fn test_legacy_deploy_warning_message() {
        use super::*;

        // Test each reason produces appropriate message
        let msg1 = legacy_deploy_warning_message(&LegacyReason::NpmrcMissingSetting);
        assert!(msg1.contains(".npmrc missing"));
        assert!(msg1.contains("inject-workspace-packages=true"));

        let msg2 = legacy_deploy_warning_message(&LegacyReason::LockfileMissingSetting);
        assert!(msg2.contains("lockfile was not regenerated"));

        let msg3 = legacy_deploy_warning_message(&LegacyReason::LockfileHasButNpmrcMissing);
        assert!(msg3.contains("inconsistent"));

        let msg4 = legacy_deploy_warning_message(&LegacyReason::NotPnpmWorkspace);
        assert!(msg4.contains("not in a pnpm workspace"));
    }

    #[test]
    fn test_is_pnpm_version_supported() {
        use super::*;

        // v10+ should be supported
        assert!(is_pnpm_version_supported("10.0.0"));
        assert!(is_pnpm_version_supported("10.24.0"));
        assert!(is_pnpm_version_supported("11.0.0"));
        assert!(is_pnpm_version_supported("15.3.2"));

        // v9 and below should not be supported
        assert!(!is_pnpm_version_supported("9.0.0"));
        assert!(!is_pnpm_version_supported("9.15.0"));
        assert!(!is_pnpm_version_supported("8.0.0"));
        assert!(!is_pnpm_version_supported("7.33.0"));
        assert!(!is_pnpm_version_supported("1.0.0"));

        // Edge cases - unparseable versions should be assumed supported
        assert!(is_pnpm_version_supported("invalid"));
        assert!(is_pnpm_version_supported(""));
    }

    #[test]
    fn test_legacy_deploy_terminal_message() {
        use super::*;

        // Config-related reasons get the same generic message
        let msg1 = legacy_deploy_terminal_message(&LegacyReason::NpmrcMissingSetting);
        assert!(msg1.contains("inject-workspace-packages=true"));
        assert!(msg1.contains(".npmrc"));
        assert!(!msg1.contains('\n')); // Should be single line

        let msg2 = legacy_deploy_terminal_message(&LegacyReason::LockfileMissingSetting);
        assert_eq!(msg2, msg1); // Same message for config-related reasons

        let msg3 = legacy_deploy_terminal_message(&LegacyReason::LockfileHasButNpmrcMissing);
        assert_eq!(msg3, msg1);

        // NotPnpmWorkspace has its own message
        let msg4 = legacy_deploy_terminal_message(&LegacyReason::NotPnpmWorkspace);
        assert!(msg4.contains("Not in a pnpm workspace"));
        assert!(!msg4.contains('\n')); // Should be single line
    }

    #[test]
    fn test_get_pnpm_deploy_flag() {
        use super::*;

        // Modern mode - no flag
        assert_eq!(get_pnpm_deploy_flag(&PnpmDeployMode::Modern), "");

        // All legacy reasons use --legacy flag (Docker uses pnpm@latest which supports it)
        assert_eq!(
            get_pnpm_deploy_flag(&PnpmDeployMode::Legacy(LegacyReason::NpmrcMissingSetting)),
            " --legacy"
        );
        assert_eq!(
            get_pnpm_deploy_flag(&PnpmDeployMode::Legacy(
                LegacyReason::LockfileMissingSetting
            )),
            " --legacy"
        );
        assert_eq!(
            get_pnpm_deploy_flag(&PnpmDeployMode::Legacy(
                LegacyReason::LockfileHasButNpmrcMissing
            )),
            " --legacy"
        );
        assert_eq!(
            get_pnpm_deploy_flag(&PnpmDeployMode::Legacy(LegacyReason::NotPnpmWorkspace)),
            " --legacy"
        );
    }

    #[test]
    fn test_check_local_pnpm_version_warning() {
        use super::*;

        // This test verifies the function runs without panicking.
        // The actual result depends on the local pnpm version.
        let result = check_local_pnpm_version_warning();

        // If we get a warning, verify it contains expected content
        if let Some(warning) = result {
            assert!(warning.contains("pnpm"));
            assert!(warning.contains("Docker"));
        }
        // If no warning, that means local pnpm is >= v10 (or not installed)
    }

    #[test]
    fn test_output_of_command() -> Result<(), std::io::Error> {
        //! Test to demonstrate the use of command and output handling
        //! Note: this test will fail if npm isn't installed.
        use super::*;
        let mut command = Command::new("npm");
        command.arg("version");
        let output = command.output()?;

        assert!(output.status.success());
        match String::from_utf8(output.stdout) {
            Ok(val) => {
                assert!(!val.is_empty());
            }
            Err(_e) => {
                panic!();
            }
        }

        Ok(())
    }
}
