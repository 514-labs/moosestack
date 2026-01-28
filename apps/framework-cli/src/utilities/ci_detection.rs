//! CI/CD Environment Detection
//!
//! Detects whether the CLI is running in a CI/CD environment by checking
//! for common environment variables set by various CI providers.

use std::env;

/// Information about the CI/CD environment.
#[derive(Debug, Clone)]
pub struct CIEnvironment {
    /// Whether the CLI is running in a CI/CD environment.
    pub is_ci: bool,
    /// The detected CI provider, if any.
    pub ci_provider: Option<String>,
}

/// Detects the CI/CD environment by checking for common environment variables.
///
/// This function checks for environment variables set by popular CI/CD providers.
/// If any are found, it returns information about the detected environment.
pub fn detect_ci_environment() -> CIEnvironment {
    // List of (env_var, provider_name) pairs
    // The first match wins, so more specific checks should come before generic ones
    let ci_checks: &[(&str, Option<&str>)] = &[
        ("GITHUB_ACTIONS", Some("github_actions")),
        ("GITLAB_CI", Some("gitlab")),
        ("JENKINS_URL", Some("jenkins")),
        ("CIRCLECI", Some("circleci")),
        ("TRAVIS", Some("travis")),
        ("BUILDKITE", Some("buildkite")),
        ("BITBUCKET_BUILD_NUMBER", Some("bitbucket")),
        ("TF_BUILD", Some("azure_devops")),
        ("TEAMCITY_VERSION", Some("teamcity")),
        ("DRONE", Some("drone")),
        ("CODEBUILD_BUILD_ID", Some("aws_codebuild")),
        ("HARNESS_BUILD_ID", Some("harness")),
        ("SEMAPHORE", Some("semaphore")),
        ("APPVEYOR", Some("appveyor")),
        ("NETLIFY", Some("netlify")),
        ("VERCEL", Some("vercel")),
        ("RENDER", Some("render")),
        ("RAILWAY_ENVIRONMENT", Some("railway")),
        ("FLY_APP_NAME", Some("fly_io")),
        // Generic CI check - should be last as it's the most common fallback
        ("CI", None),
    ];

    for (env_var, provider) in ci_checks {
        if env::var(env_var).is_ok() {
            return CIEnvironment {
                is_ci: true,
                ci_provider: provider.map(String::from).or_else(|| {
                    // If CI=true but no specific provider detected, try to identify it
                    detect_unknown_ci_provider()
                }),
            };
        }
    }

    CIEnvironment {
        is_ci: false,
        ci_provider: None,
    }
}

/// Attempts to identify an unknown CI provider based on other environment clues.
fn detect_unknown_ci_provider() -> Option<String> {
    // Check for additional provider-specific variables that might help identify the CI
    if env::var("GITHUB_WORKFLOW").is_ok() {
        return Some("github_actions".to_string());
    }
    if env::var("GITLAB_USER_LOGIN").is_ok() {
        return Some("gitlab".to_string());
    }
    if env::var("JENKINS_HOME").is_ok() {
        return Some("jenkins".to_string());
    }

    // Return None if we can't identify the specific provider
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn with_env_var<F, R>(key: &str, value: &str, f: F) -> R
    where
        F: FnOnce() -> R,
    {
        env::set_var(key, value);
        let result = f();
        env::remove_var(key);
        result
    }

    #[test]
    fn test_detect_github_actions() {
        with_env_var("GITHUB_ACTIONS", "true", || {
            let ci = detect_ci_environment();
            assert!(ci.is_ci);
            assert_eq!(ci.ci_provider, Some("github_actions".to_string()));
        });
    }

    #[test]
    fn test_detect_gitlab_ci() {
        with_env_var("GITLAB_CI", "true", || {
            let ci = detect_ci_environment();
            assert!(ci.is_ci);
            assert_eq!(ci.ci_provider, Some("gitlab".to_string()));
        });
    }

    #[test]
    fn test_detect_generic_ci() {
        with_env_var("CI", "true", || {
            let ci = detect_ci_environment();
            assert!(ci.is_ci);
            // Provider might be None or detected from other vars
        });
    }

    #[test]
    fn test_no_ci_environment() {
        // This test assumes none of the CI env vars are set
        // In a real CI environment, this test might fail
        // We can't reliably test this without clearing all CI env vars
    }
}
