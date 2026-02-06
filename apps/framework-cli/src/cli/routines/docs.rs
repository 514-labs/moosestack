//! # LLM Documentation Fetcher
//!
//! Fetches LLM-optimized documentation from the Moose docs site for use by AI agents.
//! These docs are specifically formatted for LLM consumption and provide concise,
//! structured information about Moose primitives and APIs.

use super::{RoutineFailure, RoutineSuccess};
use crate::cli::display::{Message, MessageType};

const DOCS_BASE_URL: &str = "https://docs.fiveonefour.com";

/// Supported documentation languages
#[derive(Debug, Clone, Copy)]
pub enum DocsLanguage {
    TypeScript,
    Python,
}

impl DocsLanguage {
    /// Parse language from user input
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "typescript" | "ts" => Some(Self::TypeScript),
            "python" | "py" => Some(Self::Python),
            _ => None,
        }
    }

    /// Get the file suffix for this language
    fn file_suffix(&self) -> &'static str {
        match self {
            Self::TypeScript => "ts",
            Self::Python => "py",
        }
    }

    /// Get display name for this language
    fn display_name(&self) -> &'static str {
        match self {
            Self::TypeScript => "TypeScript",
            Self::Python => "Python",
        }
    }
}

/// Fetch LLM-optimized documentation
///
/// # Arguments
/// * `language` - Optional language specification (defaults to TypeScript)
/// * `path` - Optional path filter for specific doc sections
/// * `raw` - If true, output raw content without formatting
pub async fn fetch_docs(
    language: Option<&str>,
    path: Option<&str>,
    raw: bool,
) -> Result<RoutineSuccess, RoutineFailure> {
    // Parse language, defaulting to TypeScript
    let lang = match language {
        Some(l) => DocsLanguage::from_str(l).ok_or_else(|| {
            RoutineFailure::error(Message::new(
                "Docs".to_string(),
                format!(
                    "Invalid language '{}'. Use 'typescript' (ts) or 'python' (py)",
                    l
                ),
            ))
        })?,
        None => DocsLanguage::TypeScript,
    };

    // Build the URL
    let mut url = format!("{}/llm-{}.txt", DOCS_BASE_URL, lang.file_suffix());
    if let Some(p) = path {
        url = format!("{}?path={}", url, p);
    }

    if !raw {
        show_message!(
            MessageType::Info,
            Message::new(
                "Docs".to_string(),
                format!("Fetching {} LLM documentation...", lang.display_name())
            )
        );
    }

    // Fetch the documentation
    let response = reqwest::get(&url).await.map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Docs".to_string(),
                format!("Failed to fetch documentation: {}", e),
            ),
            e,
        )
    })?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(RoutineFailure::error(Message::new(
            "Docs".to_string(),
            format!("Documentation not found. URL: {}", url),
        )));
    }

    response.error_for_status_ref().map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Docs".to_string(),
                format!("HTTP error fetching documentation: {}", e),
            ),
            e,
        )
    })?;

    let content = response.text().await.map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Docs".to_string(),
                format!("Failed to read documentation content: {}", e),
            ),
            e,
        )
    })?;

    if raw {
        // Output raw content directly for piping
        println!("{}", content);
    } else {
        // Output with some basic formatting info
        show_message!(
            MessageType::Success,
            Message::new(
                "Docs".to_string(),
                format!(
                    "Fetched {} documentation ({} bytes)",
                    lang.display_name(),
                    content.len()
                )
            )
        );
        println!();
        println!("{}", content);
    }

    Ok(RoutineSuccess::success(Message::new(
        "Docs".to_string(),
        "Documentation fetched successfully".to_string(),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_language_parsing() {
        assert!(matches!(
            DocsLanguage::from_str("typescript"),
            Some(DocsLanguage::TypeScript)
        ));
        assert!(matches!(
            DocsLanguage::from_str("ts"),
            Some(DocsLanguage::TypeScript)
        ));
        assert!(matches!(
            DocsLanguage::from_str("TS"),
            Some(DocsLanguage::TypeScript)
        ));
        assert!(matches!(
            DocsLanguage::from_str("python"),
            Some(DocsLanguage::Python)
        ));
        assert!(matches!(
            DocsLanguage::from_str("py"),
            Some(DocsLanguage::Python)
        ));
        assert!(matches!(
            DocsLanguage::from_str("PY"),
            Some(DocsLanguage::Python)
        ));
        assert!(DocsLanguage::from_str("invalid").is_none());
    }
}
