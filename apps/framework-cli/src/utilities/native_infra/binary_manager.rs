use super::errors::NativeInfraError;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tracing::{info, warn};

/// Downloads, caches, and verifies native binaries for local dev infrastructure.
///
/// Cache layout: `~/.moose/binaries/{name}/{version}/{platform}-{arch}/`
const CHECKSUM_MARKER_FILE: &str = ".artifact-sha256";

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
        expected_sha256: &str,
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
            if cache_is_valid(
                &binary_path,
                &cache_dir,
                archive_binary_path,
                expected_sha256,
            )? {
                info!("Using cached {} binary at {}", name, binary_path.display());
                return Ok(binary_path);
            }

            warn!(
                "Cached {} binary at {} failed checksum validation, re-downloading",
                name,
                binary_path.display()
            );
            remove_path_if_exists(&cache_dir)?;
        }

        std::fs::create_dir_all(&cache_dir).map_err(|e| NativeInfraError::CreateDir {
            path: cache_dir.clone(),
            source: e,
        })?;

        info!("Downloading {} v{} from {}", name, version, url);

        let bytes = download_with_retry(url, 3)?;
        verify_download_checksum(name, version, url, &bytes, expected_sha256)?;

        if archive_binary_path.is_some() {
            // Extract .tar.gz archive
            extract_tar_gz(&bytes, &cache_dir)?;
            write_checksum_marker(&cache_dir, expected_sha256)?;
        } else {
            // Single binary — write directly
            std::fs::write(&binary_path, &bytes).map_err(|e| NativeInfraError::WriteFile {
                path: binary_path.clone(),
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

fn verify_download_checksum(
    name: &str,
    version: &str,
    url: &str,
    bytes: &[u8],
    expected_sha256: &str,
) -> Result<(), NativeInfraError> {
    let actual_sha256 = sha256_hex(bytes);

    if actual_sha256 == expected_sha256 {
        return Ok(());
    }

    Err(NativeInfraError::ChecksumMismatch {
        name: name.to_string(),
        version: version.to_string(),
        url: url.to_string(),
        expected_sha256: expected_sha256.to_string(),
        actual_sha256,
    })
}

fn cache_is_valid(
    binary_path: &Path,
    cache_dir: &Path,
    archive_binary_path: Option<&str>,
    expected_sha256: &str,
) -> Result<bool, NativeInfraError> {
    if archive_binary_path.is_some() {
        let marker_path = checksum_marker_path(cache_dir);
        if !marker_path.exists() {
            return Ok(false);
        }

        let marker_contents =
            std::fs::read_to_string(&marker_path).map_err(|e| NativeInfraError::ReadFile {
                path: marker_path.clone(),
                source: e,
            })?;
        return Ok(marker_contents.trim() == expected_sha256);
    }

    let actual_sha256 = sha256_file(binary_path)?;
    Ok(actual_sha256 == expected_sha256)
}

fn checksum_marker_path(cache_dir: &Path) -> PathBuf {
    cache_dir.join(CHECKSUM_MARKER_FILE)
}

fn write_checksum_marker(cache_dir: &Path, expected_sha256: &str) -> Result<(), NativeInfraError> {
    let marker_path = checksum_marker_path(cache_dir);
    std::fs::write(&marker_path, expected_sha256).map_err(|e| NativeInfraError::WriteFile {
        path: marker_path,
        source: e,
    })
}

fn remove_path_if_exists(path: &Path) -> Result<(), NativeInfraError> {
    if !path.exists() {
        return Ok(());
    }

    let metadata = std::fs::metadata(path).map_err(|e| NativeInfraError::ReadFile {
        path: path.to_path_buf(),
        source: e,
    })?;

    if metadata.is_dir() {
        std::fs::remove_dir_all(path).map_err(|e| NativeInfraError::RemovePath {
            path: path.to_path_buf(),
            source: e,
        })?;
    } else {
        std::fs::remove_file(path).map_err(|e| NativeInfraError::RemovePath {
            path: path.to_path_buf(),
            source: e,
        })?;
    }

    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, NativeInfraError> {
    let bytes = std::fs::read(path).map_err(|e| NativeInfraError::ReadFile {
        path: path.to_path_buf(),
        source: e,
    })?;
    Ok(sha256_hex(&bytes))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Downloads a file with retry and exponential backoff.
fn download_with_retry(url: &str, max_attempts: u32) -> Result<bytes::Bytes, NativeInfraError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| NativeInfraError::Download {
            url: url.to_string(),
            source: e,
        })?;

    let mut last_err = None;
    for attempt in 1..=max_attempts {
        match client.get(url).send() {
            Ok(response) => {
                if !response.status().is_success() {
                    last_err = Some(NativeInfraError::DownloadStatus {
                        url: url.to_string(),
                        status: response.status().as_u16(),
                    });
                } else {
                    match response.bytes() {
                        Ok(bytes) => return Ok(bytes),
                        Err(e) => {
                            last_err = Some(NativeInfraError::Download {
                                url: url.to_string(),
                                source: e,
                            });
                        }
                    }
                }
            }
            Err(e) => {
                last_err = Some(NativeInfraError::Download {
                    url: url.to_string(),
                    source: e,
                });
            }
        }

        if attempt < max_attempts {
            let delay = std::time::Duration::from_secs(2u64.pow(attempt));
            warn!(
                "Download attempt {}/{} failed, retrying in {}s...",
                attempt,
                max_attempts,
                delay.as_secs()
            );
            std::thread::sleep(delay);
        }
    }

    Err(last_err.unwrap())
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
    use tempfile::tempdir;

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

    #[test]
    fn test_verify_download_checksum_accepts_matching_sha256() {
        let bytes = b"moose";
        let expected = sha256_hex(bytes);

        let result = verify_download_checksum(
            "clickhouse",
            "1.0.0",
            "https://example.com/bin",
            bytes,
            &expected,
        );

        assert!(result.is_ok());
    }

    #[test]
    fn test_verify_download_checksum_rejects_mismatched_sha256() {
        let err = verify_download_checksum(
            "clickhouse",
            "1.0.0",
            "https://example.com/bin",
            b"moose",
            "deadbeef",
        )
        .unwrap_err();

        match err {
            NativeInfraError::ChecksumMismatch {
                expected_sha256,
                actual_sha256,
                ..
            } => {
                assert_eq!(expected_sha256, "deadbeef");
                assert_eq!(actual_sha256, sha256_hex(b"moose"));
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn test_cache_is_valid_for_single_binary() {
        let dir = tempdir().unwrap();
        let binary_path = dir.path().join("clickhouse");
        let bytes = b"native-binary";
        std::fs::write(&binary_path, bytes).unwrap();

        let is_valid = cache_is_valid(&binary_path, dir.path(), None, &sha256_hex(bytes)).unwrap();

        assert!(is_valid);
    }

    #[test]
    fn test_cache_is_invalid_for_single_binary_with_wrong_checksum() {
        let dir = tempdir().unwrap();
        let binary_path = dir.path().join("clickhouse");
        std::fs::write(&binary_path, b"native-binary").unwrap();

        let is_valid = cache_is_valid(&binary_path, dir.path(), None, "deadbeef").unwrap();

        assert!(!is_valid);
    }

    #[test]
    fn test_cache_is_valid_for_archive_when_marker_matches() {
        let dir = tempdir().unwrap();
        let binary_path = dir.path().join("temporal");
        std::fs::write(&binary_path, b"extracted-binary").unwrap();
        write_checksum_marker(dir.path(), "expected-sha").unwrap();

        let is_valid =
            cache_is_valid(&binary_path, dir.path(), Some("temporal"), "expected-sha").unwrap();

        assert!(is_valid);
    }

    #[test]
    fn test_cache_is_invalid_for_archive_when_marker_missing() {
        let dir = tempdir().unwrap();
        let binary_path = dir.path().join("temporal");
        std::fs::write(&binary_path, b"extracted-binary").unwrap();

        let is_valid =
            cache_is_valid(&binary_path, dir.path(), Some("temporal"), "expected-sha").unwrap();

        assert!(!is_valid);
    }

    #[test]
    fn test_cache_is_invalid_for_archive_when_marker_mismatches() {
        let dir = tempdir().unwrap();
        let binary_path = dir.path().join("temporal");
        std::fs::write(&binary_path, b"extracted-binary").unwrap();
        write_checksum_marker(dir.path(), "wrong-sha").unwrap();

        let is_valid =
            cache_is_valid(&binary_path, dir.path(), Some("temporal"), "expected-sha").unwrap();

        assert!(!is_valid);
    }
}
