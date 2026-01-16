use semver::{Version, VersionReq};
use serde_json::Value as JsonValue;
use std::fs;
use std::path::Path;
use tracing::{debug, info, warn};

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

/// Known LTS versions of Node.js
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
    NodeVersion {
        major: 24,
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
/// Handles common patterns like ">=18", "18.x", "^18.0.0", ">=20 <=24", etc.
fn normalize_node_version_requirement(req: &str) -> String {
    let trimmed = req.trim();

    // Handle compound requirements like ">=20 <=24" by splitting and normalizing each part
    // Semver crate uses comma separation for AND conditions
    if trimmed.contains(' ') {
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        let normalized_parts: Vec<String> = parts
            .iter()
            .map(|part| normalize_single_version_requirement(part))
            .collect();
        return normalized_parts.join(", ");
    }

    normalize_single_version_requirement(trimmed)
}

/// Normalizes a single version requirement (no spaces/compound)
fn normalize_single_version_requirement(req: &str) -> String {
    let trimmed = req.trim();

    // Handle two-character operators first to avoid wrong matches
    // >=, <=, then single-character >, <
    if let Some(version_part) = trimmed.strip_prefix(">=") {
        let version_part = version_part.trim();
        if !version_part.contains('.') {
            return format!(">={}.0.0", version_part);
        } else if version_part.matches('.').count() == 1 {
            return format!(">={}.0", version_part);
        }
    }

    if let Some(version_part) = trimmed.strip_prefix("<=") {
        let version_part = version_part.trim();
        if !version_part.contains('.') {
            return format!("<={}.0.0", version_part);
        } else if version_part.matches('.').count() == 1 {
            return format!("<={}.0", version_part);
        }
    }

    if let Some(version_part) = trimmed.strip_prefix('>') {
        let version_part = version_part.trim();
        if !version_part.contains('.') {
            return format!(">{}.0.0", version_part);
        } else if version_part.matches('.').count() == 1 {
            return format!(">{}.0", version_part);
        }
    }

    if let Some(version_part) = trimmed.strip_prefix('<') {
        let version_part = version_part.trim();
        if !version_part.contains('.') {
            return format!("<{}.0.0", version_part);
        } else if version_part.matches('.').count() == 1 {
            return format!("<{}.0", version_part);
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
        // Greater-than-or-equal (>=)
        assert_eq!(normalize_node_version_requirement(">=18"), ">=18.0.0");
        assert_eq!(normalize_node_version_requirement(">=18.5"), ">=18.5.0");
        assert_eq!(normalize_node_version_requirement(">=18.5.0"), ">=18.5.0");

        // Less-than-or-equal (<=)
        assert_eq!(normalize_node_version_requirement("<=24"), "<=24.0.0");
        assert_eq!(normalize_node_version_requirement("<=24.5"), "<=24.5.0");
        assert_eq!(normalize_node_version_requirement("<=24.5.0"), "<=24.5.0");

        // Greater-than (>)
        assert_eq!(normalize_node_version_requirement(">18"), ">18.0.0");
        assert_eq!(normalize_node_version_requirement(">18.5"), ">18.5.0");
        assert_eq!(normalize_node_version_requirement(">18.5.0"), ">18.5.0");

        // Less-than (<)
        assert_eq!(normalize_node_version_requirement("<25"), "<25.0.0");
        assert_eq!(normalize_node_version_requirement("<25.5"), "<25.5.0");
        assert_eq!(normalize_node_version_requirement("<25.5.0"), "<25.5.0");

        // Caret (^)
        assert_eq!(normalize_node_version_requirement("^18"), "^18.0.0");
        assert_eq!(normalize_node_version_requirement("^18.0.0"), "^18.0.0");

        // Tilde (~)
        assert_eq!(normalize_node_version_requirement("~18"), "~18.0.0");
        assert_eq!(normalize_node_version_requirement("~18.0.0"), "~18.0.0");

        // Wildcard patterns
        assert_eq!(normalize_node_version_requirement("18.x"), "^18.0.0");
        assert_eq!(normalize_node_version_requirement("18.*"), "^18.0.0");

        // Bare number
        assert_eq!(normalize_node_version_requirement("18"), "^18.0.0");

        // Compound requirements
        assert_eq!(
            normalize_node_version_requirement(">=20 <25"),
            ">=20.0.0, <25.0.0"
        );
        assert_eq!(
            normalize_node_version_requirement(">=20.0.0 <25.0.0"),
            ">=20.0.0, <25.0.0"
        );
        assert_eq!(
            normalize_node_version_requirement(">18 <=24"),
            ">18.0.0, <=24.0.0"
        );

        // Whitespace handling
        assert_eq!(normalize_node_version_requirement("  >=18  "), ">=18.0.0");
        assert_eq!(
            normalize_node_version_requirement(">=20   <25"),
            ">=20.0.0, <25.0.0"
        );
    }

    #[test]
    fn test_find_compatible_lts_version() {
        // No requirement - should return default (20)
        let version_none = find_compatible_lts_version(None);
        assert_eq!(version_none.major, 20);
        assert!(version_none.is_lts);

        // >=20 - should pick highest (24)
        let req = VersionReq::parse(">=20.0.0").unwrap();
        let version = find_compatible_lts_version(Some(&req));
        assert_eq!(version.major, 24);
        assert!(version.is_lts);

        // ^20 - should pick exactly 20
        let req_20 = VersionReq::parse("^20.0.0").unwrap();
        let version_20 = find_compatible_lts_version(Some(&req_20));
        assert_eq!(version_20.major, 20);

        // ^22 - should pick exactly 22
        let req_22 = VersionReq::parse("^22.0.0").unwrap();
        let version_22 = find_compatible_lts_version(Some(&req_22));
        assert_eq!(version_22.major, 22);

        // ^24 - should pick exactly 24
        let req_24 = VersionReq::parse("^24.0.0").unwrap();
        let version_24 = find_compatible_lts_version(Some(&req_24));
        assert_eq!(version_24.major, 24);

        // >=18 - should pick highest available (24)
        let req_18_plus = VersionReq::parse(">=18.0.0").unwrap();
        let version_18_plus = find_compatible_lts_version(Some(&req_18_plus));
        assert_eq!(version_18_plus.major, 24);

        // ^18 - no match, should fall back to default (20)
        let req_18_caret = VersionReq::parse("^18.0.0").unwrap();
        let version_18_caret = find_compatible_lts_version(Some(&req_18_caret));
        assert_eq!(version_18_caret.major, 20);

        // >=20 <25 - should pick highest in range (24)
        let req_compound = VersionReq::parse(">=20.0.0, <25.0.0").unwrap();
        let version_compound = find_compatible_lts_version(Some(&req_compound));
        assert_eq!(version_compound.major, 24);

        // >=20 <23 - should pick highest in range (22)
        let req_compound_22 = VersionReq::parse(">=20.0.0, <23.0.0").unwrap();
        let version_compound_22 = find_compatible_lts_version(Some(&req_compound_22));
        assert_eq!(version_compound_22.major, 22);

        // >=20 <21 - should pick 20
        let req_compound_20 = VersionReq::parse(">=20.0.0, <21.0.0").unwrap();
        let version_compound_20 = find_compatible_lts_version(Some(&req_compound_20));
        assert_eq!(version_compound_20.major, 20);

        // >24 - no match (nothing > 24), should fall back to default (20)
        let req_gt_24 = VersionReq::parse(">24.0.0").unwrap();
        let version_gt_24 = find_compatible_lts_version(Some(&req_gt_24));
        assert_eq!(version_gt_24.major, 20);
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

    #[test]
    fn test_parse_package_json_without_engines() {
        let dir = tempdir().unwrap();
        let package_json_path = dir.path().join("package.json");

        let content = r#"{
            "name": "test-package"
        }"#;

        fs::write(&package_json_path, content).unwrap();

        let result = parse_node_engine_requirement(&package_json_path).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_package_json_missing_file() {
        let dir = tempdir().unwrap();
        let package_json_path = dir.path().join("nonexistent.json");

        let result = parse_node_engine_requirement(&package_json_path).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_determine_node_version_with_compound_requirement() {
        // End-to-end test with our actual >=20 <25 format
        let dir = tempdir().unwrap();
        let package_json_path = dir.path().join("package.json");

        let content = r#"{
            "name": "test-package",
            "engines": {
                "node": ">=20 <25"
            }
        }"#;

        fs::write(&package_json_path, content).unwrap();

        let version = determine_node_version_from_package_json(&package_json_path);
        assert_eq!(version.major, 24); // Should pick highest in range
        assert!(version.is_lts);
    }

    #[test]
    fn test_determine_node_version_fallback() {
        // Test fallback when no package.json exists
        let dir = tempdir().unwrap();
        let package_json_path = dir.path().join("nonexistent.json");

        let version = determine_node_version_from_package_json(&package_json_path);
        assert_eq!(version.major, 20); // Should fall back to default
        assert!(version.is_lts);
    }
}
