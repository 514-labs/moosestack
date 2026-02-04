//! CI/CD Environment Detection
//!
//! Detects whether the CLI is running in a CI/CD environment by checking
//! for common environment variable prefixes set by various CI providers.

use std::env;

/// Information about the CI/CD environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CIEnvironment {
    /// Whether the CLI is running in a CI/CD environment.
    pub is_ci: bool,
    /// The detected CI provider, if any.
    pub ci_provider: Option<String>,
}

/// CI provider prefixes and their corresponding provider names.
/// All prefixes use underscores to avoid false positives with unrelated env vars
/// (e.g., "CI" would match "CIDR_BLOCK", "RENDER" would match "RENDERER").
const CI_PREFIXES: &[(&str, Option<&str>)] = &[
    ("GITHUB_", Some("github_actions")),
    ("GITLAB_", Some("gitlab")),
    ("JENKINS_", Some("jenkins")),
    ("CIRCLECI_", Some("circleci")),
    ("TRAVIS_", Some("travis")),
    ("BUILDKITE_", Some("buildkite")),
    ("BITBUCKET_", Some("bitbucket")),
    ("TF_BUILD", Some("azure_devops")),
    ("TEAMCITY_", Some("teamcity")),
    ("DRONE_", Some("drone")),
    ("CODEBUILD_", Some("aws_codebuild")),
    ("HARNESS_", Some("harness")),
    ("SEMAPHORE_", Some("semaphore")),
    ("APPVEYOR_", Some("appveyor")),
    ("NETLIFY_", Some("netlify")),
    ("VERCEL_", Some("vercel")),
    ("RENDER_", Some("render")),
    ("RAILWAY_", Some("railway")),
    ("FLY_", Some("fly_io")),
];

/// Detects the CI/CD environment by checking for common environment variable prefixes.
///
/// This function checks if any environment variable starts with a known CI provider prefix.
/// If any are found, it returns information about the detected environment.
pub fn detect_ci_environment() -> CIEnvironment {
    let env_vars: Vec<String> = env::vars().map(|(key, _)| key).collect();
    detect_ci_from_vars(&env_vars)
}

/// Internal function that detects CI from a list of environment variable names.
/// This allows for testing with controlled inputs.
fn detect_ci_from_vars(env_vars: &[String]) -> CIEnvironment {
    for (prefix, provider) in CI_PREFIXES {
        if env_vars.iter().any(|var| var.starts_with(prefix)) {
            return CIEnvironment {
                is_ci: true,
                ci_provider: provider.map(String::from),
            };
        }
    }

    CIEnvironment {
        is_ci: false,
        ci_provider: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn test_detect_github_actions() {
        let env_vars = vars(&["GITHUB_ACTIONS", "PATH", "HOME"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("github_actions".to_string()));
    }

    #[test]
    fn test_detect_github_with_different_var() {
        // Test that any GITHUB_ prefixed var triggers detection
        let env_vars = vars(&["GITHUB_WORKFLOW", "GITHUB_SHA", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("github_actions".to_string()));
    }

    #[test]
    fn test_detect_gitlab_ci() {
        let env_vars = vars(&["GITLAB_CI", "PATH", "HOME"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("gitlab".to_string()));
    }

    #[test]
    fn test_detect_gitlab_with_different_var() {
        // Test that any GITLAB_ prefixed var triggers detection
        let env_vars = vars(&["GITLAB_USER_LOGIN", "GITLAB_PROJECT_ID", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("gitlab".to_string()));
    }

    #[test]
    fn test_no_false_positive_ci_prefix() {
        // Generic "CI" env var should NOT trigger detection (would match CIDR_BLOCK, etc.)
        let env_vars = vars(&["CI", "PATH", "HOME"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(!ci.is_ci);
        assert_eq!(ci.ci_provider, None);
    }

    #[test]
    fn test_no_false_positive_cidr_block() {
        let env_vars = vars(&["CIDR_BLOCK", "PATH", "HOME"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(!ci.is_ci);
    }

    #[test]
    fn test_no_false_positive_renderer() {
        // RENDERER should not trigger Render.com detection
        let env_vars = vars(&["RENDERER", "PATH", "HOME"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(!ci.is_ci);
    }

    #[test]
    fn test_detect_jenkins() {
        let env_vars = vars(&["JENKINS_HOME", "JENKINS_URL", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("jenkins".to_string()));
    }

    #[test]
    fn test_detect_codebuild() {
        let env_vars = vars(&["CODEBUILD_BUILD_ARN", "CODEBUILD_BUILD_ID", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("aws_codebuild".to_string()));
    }

    #[test]
    fn test_detect_circleci() {
        let env_vars = vars(&["CIRCLECI_BUILD_NUM", "CIRCLECI_JOB", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("circleci".to_string()));
    }

    #[test]
    fn test_detect_travis() {
        let env_vars = vars(&["TRAVIS_BUILD_ID", "TRAVIS_JOB_ID", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("travis".to_string()));
    }

    #[test]
    fn test_detect_buildkite() {
        let env_vars = vars(&["BUILDKITE_BUILD_ID", "BUILDKITE_JOB_ID", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("buildkite".to_string()));
    }

    #[test]
    fn test_detect_bitbucket() {
        let env_vars = vars(&["BITBUCKET_BUILD_NUMBER", "BITBUCKET_PIPELINE_UUID", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("bitbucket".to_string()));
    }

    #[test]
    fn test_detect_azure_devops() {
        let env_vars = vars(&["TF_BUILD", "BUILD_BUILDID", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("azure_devops".to_string()));
    }

    #[test]
    fn test_detect_teamcity() {
        let env_vars = vars(&["TEAMCITY_VERSION", "TEAMCITY_BUILD_ID", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("teamcity".to_string()));
    }

    #[test]
    fn test_detect_vercel() {
        let env_vars = vars(&["VERCEL_ENV", "VERCEL_URL", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("vercel".to_string()));
    }

    #[test]
    fn test_detect_netlify() {
        let env_vars = vars(&["NETLIFY_BUILD_ID", "NETLIFY_CONTEXT", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("netlify".to_string()));
    }

    #[test]
    fn test_detect_render() {
        let env_vars = vars(&["RENDER_SERVICE_ID", "RENDER_INSTANCE_ID", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("render".to_string()));
    }

    #[test]
    fn test_detect_fly_io() {
        let env_vars = vars(&["FLY_APP_NAME", "FLY_REGION", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("fly_io".to_string()));
    }

    #[test]
    fn test_detect_railway() {
        let env_vars = vars(&["RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("railway".to_string()));
    }

    #[test]
    fn test_no_ci_environment() {
        let env_vars = vars(&["PATH", "HOME", "USER", "SHELL"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(!ci.is_ci);
        assert_eq!(ci.ci_provider, None);
    }

    #[test]
    fn test_priority_github_over_gitlab() {
        // When both GITHUB_ and GITLAB_ are present, GITHUB_ should win (first in list)
        let env_vars = vars(&["GITHUB_ACTIONS", "GITLAB_CI", "PATH"]);
        let ci = detect_ci_from_vars(&env_vars);
        assert!(ci.is_ci);
        assert_eq!(ci.ci_provider, Some("github_actions".to_string()));
    }
}
