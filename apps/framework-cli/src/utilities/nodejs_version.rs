use tracing::{debug, info, warn};
use semver::{Version, VersionReq};
use serde_json::Value as JsonValue;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct NodeVersion {
    pub major: u64,
    pub is_lts: bool,
}

impl NodeVersion {
    pub fn new(major: u64, is_lts: bool) -> Self {
        Self { major, is_lts }
    }

    pub fn to_major_string(&self) -> String {
        format!("{}", self.major)
    }
}

/// Known LTS versions of Node.js as of 2024
/// This should be updated periodically or ideally fetched from Node.js release API
const NODE_LTS_VERSIONS: &[NodeVersion] = &[
    NodeVersion {
        major: 20,
        is_lts: true,
    },
    NodeVersion {
        major: 22,
        is_lts: true,
    },
];

/// Parses the engines field from package.json and returns the Node.js version requirement
pub fn parse_node_engine_requirement(
    package_json_path: &Path,
) -> Result<Option<VersionReq>, Box<dyn std::error::Error>> {
    if !package_json_path.exists() {
        debug!("package.json not found at {:?}", package_json_path);
        return Ok(None);
    }

    let content = fs::read_to_string(package_json_path)?;
    let package_json: JsonValue = serde_json::from_str(&content)?;

    let node_requirement = package_json
        .get("engines")
        .and_then(|engines| engines.get("node"))
        .and_then(|node| node.as_str());

    if let Some(req_str) = node_requirement {
        debug!("Found Node.js engine requirement: {}", req_str);

        // Handle common patterns and convert to semver format
        let normalized_req = normalize_node_version_requirement(req_str);

        match VersionReq::parse(&normalized_req) {
            Ok(req) => Ok(Some(req)),
            Err(e) => {
                warn!(
                    "Failed to parse Node.js version requirement '{}': {}",
                    req_str, e
                );
                Ok(None)
            }
        }
    } else {
        debug!("No Node.js engine requirement found in package.json");
        Ok(None)
    }
}

/// Normalizes Node.js version requirements to semver format
/// Handles common patterns like ">=18", "18.x", "^18.0.0", etc.
fn normalize_node_version_requirement(req: &str) -> String {
    let trimmed = req.trim();

    // Handle patterns like ">=18", ">=18.0", etc.
    if let Some(version_part) = trimmed.strip_prefix(">=") {
        let version_part = version_part.trim();
        if !version_part.contains('.') {
            return format!(">={}.0.0", version_part);
        } else if version_part.matches('.').count() == 1 {
            return format!("{}.0", trimmed);
        }
    }

    // Handle patterns like "^18", "~18", etc.
    if (trimmed.starts_with('^') || trimmed.starts_with('~')) && !trimmed[1..].contains('.') {
        let op = &trimmed[0..1];
        let version = &trimmed[1..];
        return format!("{}{}.0.0", op, version);
    }

    // Handle patterns like "18.x", "18.*"
    if trimmed.ends_with(".x") || trimmed.ends_with(".*") {
        let version = trimmed.trim_end_matches(".x").trim_end_matches(".*");
        return format!("^{}.0.0", version);
    }

    // Handle bare numbers like "18"
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        return format!("^{}.0.0", trimmed);
    }

    // Return as-is for already properly formatted semver
    trimmed.to_string()
}

/// Finds the highest LTS Node.js version that satisfies the given requirement
pub fn find_compatible_lts_version(requirement: Option<&VersionReq>) -> NodeVersion {
    let default_version = NodeVersion::new(20, true);

    let Some(req) = requirement else {
        info!(
            "No Node.js version requirement specified, using default LTS version {}",
            default_version.to_major_string()
        );
        return default_version;
    };

    // Find all LTS versions that satisfy the requirement
    let mut compatible_versions: Vec<&NodeVersion> = NODE_LTS_VERSIONS
        .iter()
        .filter(|version| {
            let semver = Version::new(version.major, 0, 0);
            req.matches(&semver)
        })
        .collect();

    // Sort by version (highest first)
    compatible_versions.sort_by(|a, b| b.major.cmp(&a.major));

    if let Some(best_version) = compatible_versions.first() {
        info!(
            "Found compatible LTS Node.js version {} for requirement {}",
            best_version.to_major_string(),
            req
        );
        (*best_version).clone()
    } else {
        warn!(
            "No compatible LTS Node.js version found for requirement {}, using default version {}",
            req,
            default_version.to_major_string()
        );
        default_version
    }
}

/// Main function to determine Node.js version from package.json
pub fn determine_node_version_from_package_json(package_json_path: &Path) -> NodeVersion {
    match parse_node_engine_requirement(package_json_path) {
        Ok(requirement) => find_compatible_lts_version(requirement.as_ref()),
        Err(e) => {
            warn!("Error parsing package.json engines field: {}", e);
            NodeVersion::new(20, true) // Default fallback
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_normalize_node_version_requirement() {
        assert_eq!(normalize_node_version_requirement(">=18"), ">=18.0.0");
        assert_eq!(normalize_node_version_requirement("^18"), "^18.0.0");
        assert_eq!(normalize_node_version_requirement("18.x"), "^18.0.0");
        assert_eq!(normalize_node_version_requirement("18"), "^18.0.0");
        assert_eq!(normalize_node_version_requirement(">=18.5.0"), ">=18.5.0");
    }

    #[test]
    fn test_find_compatible_lts_version() {
        let req = VersionReq::parse(">=20.0.0").unwrap();
        let version = find_compatible_lts_version(Some(&req));
        assert!(version.major >= 20);
        assert!(version.is_lts);

        // Test that it picks the highest compatible version (should be 22)
        assert_eq!(version.major, 22);

        // Test with constraint that should pick specific version
        let req_20 = VersionReq::parse("^20.0.0").unwrap();
        let version_20 = find_compatible_lts_version(Some(&req_20));
        assert_eq!(version_20.major, 20);

        // Test that >=18.0.0 still works since 20 and 22 satisfy it
        let req_18_plus = VersionReq::parse(">=18.0.0").unwrap();
        let version_18_plus = find_compatible_lts_version(Some(&req_18_plus));
        assert_eq!(version_18_plus.major, 22); // Should pick highest available (22)

        // Test that ^18.0.0 (18.x.x only) falls back to default since 18 is not available
        let req_18_caret = VersionReq::parse("^18.0.0").unwrap();
        let version_18_caret = find_compatible_lts_version(Some(&req_18_caret));
        assert_eq!(version_18_caret.major, 20); // Should fall back to default (20)
    }

    #[test]
    fn test_parse_package_json_with_engines() {
        let dir = tempdir().unwrap();
        let package_json_path = dir.path().join("package.json");

        let content = r#"{
            "name": "test-package",
            "engines": {
                "node": ">=18.0.0"
            }
        }"#;

        fs::write(&package_json_path, content).unwrap();

        let result = parse_node_engine_requirement(&package_json_path).unwrap();
        assert!(result.is_some());

        let req = result.unwrap();
        let version = Version::new(18, 0, 0);
        assert!(req.matches(&version));
    }
}
