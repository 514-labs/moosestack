use super::errors::NativeInfraError;
use std::path::{Path, PathBuf};
use tracing::info;

/// Downloads, caches, and verifies native binaries for local dev infrastructure.
///
/// Cache layout: `~/.moose/binaries/{name}/{version}/{platform}-{arch}/`
pub struct BinaryManager {
    cache_root: PathBuf,
}

impl BinaryManager {
    /// Creates a new `BinaryManager` using the standard `~/.moose/binaries/` cache.
    pub fn new() -> Result<Self, NativeInfraError> {
        let home = home::home_dir().ok_or_else(|| NativeInfraError::CreateDir {
            path: PathBuf::from("~/.moose/binaries"),
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "HOME directory not found"),
        })?;
        let cache_root = home.join(".moose").join("binaries");
        Ok(Self { cache_root })
    }

    /// Returns the cached binary path if it already exists, or downloads it.
    ///
    /// For single-file binaries (like ClickHouse), `url` points directly to the
    /// binary and `archive_binary_path` is `None`.
    ///
    /// For `.tar.gz` archives (like Temporal), `archive_binary_path` is the
    /// relative path of the binary inside the archive (e.g. `temporal`).
    pub fn ensure_binary(
        &self,
        name: &str,
        version: &str,
        url: &str,
        archive_binary_path: Option<&str>,
    ) -> Result<PathBuf, NativeInfraError> {
        let (platform, arch) = detect_platform()?;
        let cache_dir = self
            .cache_root
            .join(name)
            .join(version)
            .join(format!("{platform}-{arch}"));

        let binary_name = archive_binary_path.unwrap_or(name);
        let binary_path = cache_dir.join(binary_name);

        if binary_path.exists() {
            info!("Using cached {} binary at {}", name, binary_path.display());
            return Ok(binary_path);
        }

        std::fs::create_dir_all(&cache_dir).map_err(|e| NativeInfraError::CreateDir {
            path: cache_dir.clone(),
            source: e,
        })?;

        info!("Downloading {} v{} from {}", name, version, url);

        let response = reqwest::blocking::get(url).map_err(|e| NativeInfraError::Download {
            url: url.to_string(),
            source: e,
        })?;

        if !response.status().is_success() {
            return Err(NativeInfraError::DownloadStatus {
                url: url.to_string(),
                status: response.status().as_u16(),
            });
        }

        let bytes = response.bytes().map_err(|e| NativeInfraError::Download {
            url: url.to_string(),
            source: e,
        })?;

        if archive_binary_path.is_some() {
            // Extract .tar.gz archive
            extract_tar_gz(&bytes, &cache_dir)?;
        } else {
            // Single binary — write directly
            std::fs::write(&binary_path, &bytes).map_err(|e| NativeInfraError::Extract {
                dest: binary_path.clone(),
                source: e,
            })?;
        }

        if !binary_path.exists() {
            return Err(NativeInfraError::BinaryNotFound {
                path: binary_path.clone(),
            });
        }

        // chmod +x
        set_executable(&binary_path)?;

        info!(
            "Successfully cached {} v{} at {}",
            name,
            version,
            binary_path.display()
        );

        Ok(binary_path)
    }
}

/// Detects the current platform and architecture at compile time.
fn detect_platform() -> Result<(&'static str, &'static str), NativeInfraError> {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        return Err(NativeInfraError::UnsupportedPlatform {
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
        });
    };

    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86_64") {
        "amd64"
    } else {
        return Err(NativeInfraError::UnsupportedPlatform {
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
        });
    };

    Ok((os, arch))
}

/// Extracts a `.tar.gz` archive into `dest_dir`.
fn extract_tar_gz(data: &[u8], dest_dir: &Path) -> Result<(), NativeInfraError> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let decoder = GzDecoder::new(data);
    let mut archive = Archive::new(decoder);
    archive
        .unpack(dest_dir)
        .map_err(|e| NativeInfraError::Extract {
            dest: dest_dir.to_path_buf(),
            source: e,
        })?;

    Ok(())
}

/// Sets executable permission on a file (Unix only).
fn set_executable(path: &Path) -> Result<(), NativeInfraError> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = std::fs::metadata(path).map_err(|e| NativeInfraError::Chmod {
        path: path.to_path_buf(),
        source: e,
    })?;
    let mut perms = metadata.permissions();
    perms.set_mode(perms.mode() | 0o755);
    std::fs::set_permissions(path, perms).map_err(|e| NativeInfraError::Chmod {
        path: path.to_path_buf(),
        source: e,
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_platform_succeeds() {
        // Should succeed on macOS/Linux arm64/x86_64
        let result = detect_platform();
        assert!(result.is_ok(), "detect_platform should succeed on CI/dev");
        let (os, arch) = result.unwrap();
        assert!(os == "darwin" || os == "linux");
        assert!(arch == "arm64" || arch == "amd64");
    }

    #[test]
    fn test_binary_manager_cache_dir_structure() {
        let manager = BinaryManager::new().unwrap();
        let (platform, arch) = detect_platform().unwrap();
        let expected_suffix = format!("binaries/clickhouse/25.0.0/{platform}-{arch}");
        let cache_dir = manager
            .cache_root
            .join("clickhouse")
            .join("25.0.0")
            .join(format!("{platform}-{arch}"));
        assert!(
            cache_dir.to_string_lossy().ends_with(&expected_suffix),
            "Cache dir should follow binaries/name/version/platform-arch pattern"
        );
    }
}
