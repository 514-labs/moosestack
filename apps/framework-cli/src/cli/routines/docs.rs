//! # LLM Documentation Fetcher
//!
//! Fetches LLM-optimized documentation from the Moose docs site for use by AI agents.
//! Supports browsing the table of contents, fetching individual pages, and searching.
//!
//! ## Docs API
//! - TOC: `https://docs.fiveonefour.com/llm.md`
//! - Page: `https://docs.fiveonefour.com/{slug}.md?lang=typescript|python`

use std::collections::BTreeMap;
use std::io::IsTerminal;
use std::sync::atomic::Ordering;

use crossterm::execute;
use crossterm::style::{Attribute, Color, Print, ResetColor, SetAttribute, SetForegroundColor};

use super::{RoutineFailure, RoutineSuccess};
use crate::cli::display::{Message, MessageType};
use crate::cli::settings::Settings;
use crate::framework::languages::SupportedLanguages;
use crate::utilities::constants::NO_ANSI;

const DOCS_BASE_URL: &str = "https://docs.fiveonefour.com";
const TOC_PATH: &str = "/llm.md";

// ── Language ────────────────────────────────────────────────────────────────

/// Supported documentation languages
#[derive(Debug, Clone, Copy)]
pub enum DocsLanguage {
    TypeScript,
    Python,
}

impl DocsLanguage {
    /// Parse language from user input (case-insensitive)
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "typescript" | "ts" => Some(Self::TypeScript),
            "python" | "py" => Some(Self::Python),
            _ => None,
        }
    }

    /// Query parameter value for the docs API
    fn query_param(&self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::Python => "python",
        }
    }

    /// Display name for user-facing messages
    fn display_name(&self) -> &'static str {
        match self {
            Self::TypeScript => "TypeScript",
            Self::Python => "Python",
        }
    }

    /// Config file value for persistence
    fn config_value(&self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::Python => "python",
        }
    }
}

/// Resolve the documentation language from various sources.
///
/// Priority order:
/// 1. Explicit `--lang` flag
/// 2. Project language (if inside a moose project directory)
/// 3. Saved preference in `~/.moose/config.toml`
/// 4. Interactive prompt (if terminal is interactive, saves choice)
/// 5. Default to TypeScript
pub fn resolve_language(
    explicit_lang: Option<&str>,
    settings: &Settings,
) -> Result<DocsLanguage, RoutineFailure> {
    // 1. Explicit flag
    if let Some(lang_str) = explicit_lang {
        return DocsLanguage::from_str(lang_str).ok_or_else(|| {
            RoutineFailure::error(Message::new(
                "Docs".to_string(),
                format!(
                    "Invalid language '{}'. Use 'typescript' (ts) or 'python' (py)",
                    lang_str
                ),
            ))
        });
    }

    // 2. Project detection (graceful failure if not in a project dir)
    if let Ok(project) = crate::cli::load_project_dev() {
        return Ok(match project.language {
            SupportedLanguages::Typescript => DocsLanguage::TypeScript,
            SupportedLanguages::Python => DocsLanguage::Python,
        });
    }

    // 3. Saved preference
    if let Some(ref saved_lang) = settings.docs.default_language {
        if let Some(lang) = DocsLanguage::from_str(saved_lang) {
            return Ok(lang);
        }
    }

    // 4. Interactive prompt (only if stdout is a terminal)
    if std::io::stdout().is_terminal() {
        let input = crate::cli::prompt_user(
            "Select language [1] TypeScript [2] Python",
            Some("1"),
            Some("This will be saved for future use"),
        )?;

        let lang = match input.trim() {
            "2" | "python" | "py" => DocsLanguage::Python,
            _ => DocsLanguage::TypeScript,
        };

        // Persist the choice
        if let Err(e) = crate::cli::settings::set_docs_default_language(lang.config_value()) {
            tracing::warn!("Failed to save language preference: {}", e);
        }

        return Ok(lang);
    }

    // 5. Default
    Ok(DocsLanguage::TypeScript)
}

// ── TOC data model ──────────────────────────────────────────────────────────

/// A single entry in the documentation table of contents
#[derive(Debug, Clone)]
struct TocEntry {
    title: String,
    slug: String,
    description: String,
}

/// A section in the documentation table of contents (## heading)
#[derive(Debug, Clone)]
struct TocSection {
    name: String,
    entries: Vec<TocEntry>,
}

/// A group of entries sharing a common parent path
struct TocGroup<'a> {
    /// Human-readable label derived from the path segment
    label: String,
    entries: Vec<&'a TocEntry>,
}

// ── TOC parsing ─────────────────────────────────────────────────────────────

/// Parse the `/llm.md` table of contents into structured sections
fn parse_toc(markdown: &str) -> Vec<TocSection> {
    let mut sections = Vec::new();
    let mut current_section: Option<TocSection> = None;

    for line in markdown.lines() {
        let trimmed = line.trim();

        if let Some(heading) = trimmed.strip_prefix("## ") {
            if let Some(section) = current_section.take() {
                sections.push(section);
            }
            current_section = Some(TocSection {
                name: heading.to_string(),
                entries: Vec::new(),
            });
            continue;
        }

        if trimmed.starts_with("- [") {
            if let Some(entry) = parse_toc_entry(trimmed) {
                if let Some(ref mut section) = current_section {
                    section.entries.push(entry);
                }
            }
        }
    }

    if let Some(section) = current_section {
        sections.push(section);
    }

    sections
}

/// Parse a single TOC entry line.
/// Format: `- [Title](/path/slug.md) - Description`
fn parse_toc_entry(line: &str) -> Option<TocEntry> {
    let title_start = line.find('[')? + 1;
    let title_end = line.find(']')?;
    let title = line[title_start..title_end].to_string();

    let slug_start = line.find('(')? + 1;
    let slug_end = line.find(')')?;
    let slug = line[slug_start..slug_end]
        .trim_start_matches('/')
        .to_string();

    let description = line
        .find(") - ")
        .map(|pos| line[pos + 4..].to_string())
        .unwrap_or_default();

    Some(TocEntry {
        title,
        slug,
        description,
    })
}

/// Group entries by their second path segment for tree display.
///
/// E.g., `moosestack/olap/model-table.md` groups under key `moosestack/olap`
/// while `moosestack/data-modeling.md` stays under `moosestack`.
fn group_entries_by_parent(entries: &[TocEntry]) -> Vec<TocGroup<'_>> {
    let mut map: BTreeMap<String, Vec<&TocEntry>> = BTreeMap::new();

    for entry in entries {
        let stripped = entry.slug.trim_end_matches(".md");
        let parts: Vec<&str> = stripped.split('/').collect();
        let key = if parts.len() > 2 {
            format!("{}/{}", parts[0], parts[1])
        } else {
            parts[0].to_string()
        };
        map.entry(key).or_default().push(entry);
    }

    map.into_iter()
        .map(|(key, entries)| {
            let label = key
                .split('/')
                .next_back()
                .unwrap_or(&key)
                .replace('-', " ")
                .split_whitespace()
                .map(|w| {
                    let mut c = w.chars();
                    match c.next() {
                        None => String::new(),
                        Some(f) => f.to_uppercase().to_string() + c.as_str(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            TocGroup { label, entries }
        })
        .collect()
}

// ── Display helpers ─────────────────────────────────────────────────────────

/// Print a section header with optional styling
fn print_section_header(name: &str) {
    let no_ansi = NO_ANSI.load(Ordering::Relaxed);
    let mut stdout = std::io::stdout();

    if !no_ansi {
        let _ = execute!(
            stdout,
            SetForegroundColor(Color::Cyan),
            SetAttribute(Attribute::Bold),
            Print(name),
            ResetColor,
            SetAttribute(Attribute::Reset),
            Print("\n")
        );
    } else {
        println!("{}", name);
    }
}

/// Print a dimmed hint line
fn print_dim(text: &str) {
    let no_ansi = NO_ANSI.load(Ordering::Relaxed);
    let mut stdout = std::io::stdout();

    if !no_ansi {
        let _ = execute!(
            stdout,
            SetForegroundColor(Color::DarkGrey),
            Print(text),
            ResetColor,
            Print("\n")
        );
    } else {
        println!("{}", text);
    }
}

/// Display the TOC as a tree with box-drawing characters.
///
/// In collapsed mode (default), shows groups with page counts.
/// In expanded mode, shows every individual page.
fn display_toc_tree(sections: &[TocSection], expand: bool, raw: bool) {
    for (si, section) in sections.iter().enumerate() {
        if si > 0 {
            println!();
        }

        if raw {
            println!("{}", section.name);
        } else {
            print_section_header(&section.name);
        }

        let groups = group_entries_by_parent(&section.entries);
        let group_count = groups.len();

        for (gi, group) in groups.iter().enumerate() {
            let is_last = gi == group_count - 1;
            let connector = if is_last { "└──" } else { "├──" };
            let continuation = if is_last { "    " } else { "│   " };

            if group.entries.len() == 1 {
                // Single entry group - show inline
                let e = group.entries[0];
                let slug_display = e.slug.trim_end_matches(".md");
                if raw {
                    println!("  {} {} - {}", connector, e.title, slug_display);
                } else {
                    print!("  {} {} ", connector, e.title);
                    print_dim(&format!("({})", slug_display));
                }
            } else if expand {
                // Expanded: show group header then all children
                println!("  {} {}", connector, group.label);
                let child_count = group.entries.len();
                for (ci, e) in group.entries.iter().enumerate() {
                    let child_last = ci == child_count - 1;
                    let child_conn = if child_last { "└──" } else { "├──" };
                    let slug_display = e.slug.trim_end_matches(".md");
                    if raw {
                        println!(
                            "  {}  {} {} - {}",
                            continuation, child_conn, e.title, slug_display
                        );
                    } else {
                        print!("  {}  {} {} ", continuation, child_conn, e.title);
                        print_dim(&format!("({})", slug_display));
                    }
                }
            } else {
                // Collapsed: show group with page count
                let count = group.entries.len();
                if raw {
                    println!("  {} {} ({} pages)", connector, group.label, count);
                } else {
                    print!("  {} {} ", connector, group.label);
                    print_dim(&format!("({} pages)", count));
                }
            }
        }
    }
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

/// Fetch the raw TOC markdown content from the docs site
async fn fetch_toc_content() -> Result<String, RoutineFailure> {
    let url = format!("{}{}", DOCS_BASE_URL, TOC_PATH);

    let response = reqwest::get(&url).await.map_err(|e| {
        RoutineFailure::new(
            Message::new("Docs".to_string(), format!("Failed to fetch TOC: {}", e)),
            e,
        )
    })?;

    response.error_for_status_ref().map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Docs".to_string(),
                format!("HTTP error fetching TOC: {}", e),
            ),
            e,
        )
    })?;

    response.text().await.map_err(|e| {
        RoutineFailure::new(
            Message::new("Docs".to_string(), "Failed to read TOC content".to_string()),
            e,
        )
    })
}

// ── Public API ──────────────────────────────────────────────────────────────

/// Fetch the TOC and display as a tree.
///
/// Called when the user runs `moose docs` with no arguments.
pub async fn show_toc(expand: bool, raw: bool) -> Result<RoutineSuccess, RoutineFailure> {
    if !raw {
        show_message!(
            MessageType::Info,
            Message::new(
                "Docs".to_string(),
                "Fetching documentation index...".to_string()
            )
        );
    }

    let content = fetch_toc_content().await?;
    let sections = parse_toc(&content);

    if sections.is_empty() {
        return Err(RoutineFailure::error(Message::new(
            "Docs".to_string(),
            "No documentation sections found".to_string(),
        )));
    }

    println!();
    display_toc_tree(&sections, expand, raw);

    if !raw {
        println!();
        print_dim("  Tip: moose docs <slug> to view a page, moose docs search <query> to search");
        if !expand {
            print_dim("        moose docs --expand to show all pages");
        }
    }

    Ok(RoutineSuccess::success(Message::new(
        "Docs".to_string(),
        "Documentation index displayed".to_string(),
    )))
}

/// Fetch and display a single documentation page by slug.
///
/// Called when the user runs `moose docs <slug>`.
pub async fn fetch_page(
    slug: &str,
    lang: DocsLanguage,
    raw: bool,
) -> Result<RoutineSuccess, RoutineFailure> {
    // Normalize: strip leading /, ensure .md extension
    let stripped = slug.trim_start_matches('/');
    let with_ext = if stripped.ends_with(".md") {
        stripped.to_string()
    } else {
        format!("{}.md", stripped)
    };

    let url = format!("{}/{}?lang={}", DOCS_BASE_URL, with_ext, lang.query_param());

    if !raw {
        show_message!(
            MessageType::Info,
            Message::new(
                "Docs".to_string(),
                format!(
                    "Fetching {} docs for {}...",
                    lang.display_name(),
                    stripped.trim_end_matches(".md")
                )
            )
        );
    }

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
            format!(
                "Page not found: '{}'. Run `moose docs` to see available pages.",
                stripped.trim_end_matches(".md")
            ),
        )));
    }

    response.error_for_status_ref().map_err(|e| {
        RoutineFailure::new(
            Message::new("Docs".to_string(), format!("HTTP error: {}", e)),
            e,
        )
    })?;

    let content = response.text().await.map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Docs".to_string(),
                "Failed to read documentation content".to_string(),
            ),
            e,
        )
    })?;

    println!("{}", content);

    Ok(RoutineSuccess::success(Message::new(
        "Docs".to_string(),
        format!("Fetched {}", stripped.trim_end_matches(".md")),
    )))
}

/// Search the TOC for entries matching a query string.
///
/// Performs case-insensitive substring matching on titles, descriptions, and slugs.
/// Called when the user runs `moose docs search <query>`.
pub async fn search_toc(query: &str, raw: bool) -> Result<RoutineSuccess, RoutineFailure> {
    if !raw {
        show_message!(
            MessageType::Info,
            Message::new("Docs".to_string(), format!("Searching for '{}'...", query))
        );
    }

    let content = fetch_toc_content().await?;
    let sections = parse_toc(&content);
    let query_lower = query.to_lowercase();

    let mut match_count = 0;
    let mut first_section = true;

    for section in &sections {
        let matches: Vec<&TocEntry> = section
            .entries
            .iter()
            .filter(|e| {
                e.title.to_lowercase().contains(&query_lower)
                    || e.description.to_lowercase().contains(&query_lower)
                    || e.slug.to_lowercase().contains(&query_lower)
            })
            .collect();

        if matches.is_empty() {
            continue;
        }

        if !first_section {
            println!();
        }
        first_section = false;

        if raw {
            println!("{}", section.name);
        } else {
            print_section_header(&section.name);
        }

        for entry in &matches {
            let slug_display = entry.slug.trim_end_matches(".md");
            if raw {
                println!(
                    "  {} - {} ({})",
                    entry.title, entry.description, slug_display
                );
            } else {
                print!("  {} - {} ", entry.title, entry.description);
                print_dim(&format!("({})", slug_display));
            }
            match_count += 1;
        }
    }

    if match_count == 0 {
        if !raw {
            show_message!(
                MessageType::Info,
                Message::new("Docs".to_string(), format!("No results for '{}'", query))
            );
        }
    } else if !raw {
        println!();
        show_message!(
            MessageType::Success,
            Message::new(
                "Docs".to_string(),
                format!("Found {} matching page(s)", match_count)
            )
        );
        print_dim("  Tip: moose docs <slug> to view a page");
    }

    Ok(RoutineSuccess::success(Message::new(
        "Docs".to_string(),
        format!("Search completed: {} result(s)", match_count),
    )))
}

// ── Tests ───────────────────────────────────────────────────────────────────

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

    #[test]
    fn test_parse_toc_entry_with_description() {
        let line =
            "- [Overview](/moosestack/index.md) - Modular toolkit for building analytical backends";
        let entry = parse_toc_entry(line).unwrap();
        assert_eq!(entry.title, "Overview");
        assert_eq!(entry.slug, "moosestack/index.md");
        assert_eq!(
            entry.description,
            "Modular toolkit for building analytical backends"
        );
    }

    #[test]
    fn test_parse_toc_entry_no_description() {
        let line = "- [Replicated Engines](/moosestack/engines/replicated.md)";
        let entry = parse_toc_entry(line).unwrap();
        assert_eq!(entry.title, "Replicated Engines");
        assert_eq!(entry.slug, "moosestack/engines/replicated.md");
        assert_eq!(entry.description, "");
    }

    #[test]
    fn test_parse_toc_sections() {
        let markdown = r#"# MooseStack Documentation

Some intro text here.

## MooseStack

- [Overview](/moosestack/index.md) - Main overview
- [Quickstart](/moosestack/getting-started/quickstart.md) - Get started fast

## Guides

- [Dashboard Guide](/guides/performant-dashboards.md) - Improve performance
"#;
        let sections = parse_toc(markdown);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].name, "MooseStack");
        assert_eq!(sections[0].entries.len(), 2);
        assert_eq!(sections[1].name, "Guides");
        assert_eq!(sections[1].entries.len(), 1);
    }

    #[test]
    fn test_group_entries_by_parent() {
        let entries = vec![
            TocEntry {
                title: "Overview".into(),
                slug: "moosestack/index.md".into(),
                description: "Main overview".into(),
            },
            TocEntry {
                title: "Tables".into(),
                slug: "moosestack/olap/model-table.md".into(),
                description: "Model tables".into(),
            },
            TocEntry {
                title: "Views".into(),
                slug: "moosestack/olap/model-view.md".into(),
                description: "Model views".into(),
            },
        ];

        let groups = group_entries_by_parent(&entries);
        assert_eq!(groups.len(), 2);
        // "moosestack" group has 1 entry (Overview)
        assert_eq!(groups[0].entries.len(), 1);
        // "moosestack/olap" group has 2 entries (Tables, Views)
        assert_eq!(groups[1].entries.len(), 2);
        assert_eq!(groups[1].label, "Olap");
    }

    #[test]
    fn test_slug_normalization() {
        // With .md
        let slug = "moosestack/olap/model-table.md";
        assert_eq!(slug.trim_end_matches(".md"), "moosestack/olap/model-table");

        // Without .md
        let slug = "moosestack/olap/model-table";
        assert_eq!(slug.trim_end_matches(".md"), "moosestack/olap/model-table");

        // Leading slash
        let slug = "/moosestack/olap";
        assert_eq!(slug.trim_start_matches('/'), "moosestack/olap");
    }
}
