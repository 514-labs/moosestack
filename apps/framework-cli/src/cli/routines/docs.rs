//! # LLM Documentation Fetcher
//!
//! Fetches LLM-optimized documentation from the Moose docs site for use by AI agents.
//! Supports browsing the table of contents, fetching individual pages, and searching.
//!
//! ## Docs API
//! - TOC: `https://docs.fiveonefour.com/llm.md`
//! - Page: `https://docs.fiveonefour.com/{slug}.md?lang=typescript|python`

use std::collections::BTreeMap;
use std::io::{IsTerminal, Write};
use std::sync::atomic::Ordering;

use crossterm::cursor::{MoveToColumn, MoveUp};
use crossterm::event::{read, Event, KeyCode, KeyModifiers};
use crossterm::execute;
use crossterm::style::{
    Attribute, Color, Print, ResetColor, SetAttribute, SetBackgroundColor, SetForegroundColor,
};
use crossterm::terminal::{self, Clear, ClearType};

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
///
/// Uses the `](` boundary to separate title from URL, which correctly handles
/// titles containing parentheses like `TTL (Time-to-Live)`.
fn parse_toc_entry(line: &str) -> Option<TocEntry> {
    let title_start = line.find('[')? + 1;
    let link_marker = line.find("](")?;
    let title = line[title_start..link_marker].to_string();

    let slug_start = link_marker + 2;
    let slug_end = line[slug_start..].find(')')? + slug_start;
    let slug = line[slug_start..slug_end]
        .trim_start_matches('/')
        .to_string();

    let description = line[slug_end..]
        .strip_prefix(") - ")
        .unwrap_or("")
        .to_string();

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
/// `guide_headings` maps guide slug → list of H2 headings (populated when expand=true).
fn display_toc_tree(
    sections: &[TocSection],
    expand: bool,
    raw: bool,
    guide_headings: &std::collections::HashMap<String, Vec<PageHeading>>,
) {
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
                // Show guide section headings if available
                if expand {
                    if let Some(headings) = guide_headings.get(&e.slug) {
                        display_guide_headings(headings, continuation, raw);
                    }
                }
            } else if expand {
                // Expanded: show group header then all children
                println!("  {} {}", connector, group.label);
                let child_count = group.entries.len();
                for (ci, e) in group.entries.iter().enumerate() {
                    let child_last = ci == child_count - 1;
                    let child_conn = if child_last { "└──" } else { "├──" };
                    let child_cont = if child_last { "    " } else { "│   " };
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
                    // Show guide section headings if available
                    if let Some(headings) = guide_headings.get(&e.slug) {
                        let nested_cont = format!("{}  {}", continuation, child_cont);
                        display_guide_headings(headings, &nested_cont, raw);
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

/// Display H2 section headings for a guide entry within the tree
fn display_guide_headings(headings: &[PageHeading], continuation: &str, raw: bool) {
    let h2s: Vec<&PageHeading> = headings.iter().filter(|h| h.level == 2).collect();
    let h2_count = h2s.len();
    for (i, h) in h2s.iter().enumerate() {
        let is_last = i == h2_count - 1;
        let conn = if is_last { "└──" } else { "├──" };
        if raw {
            println!("  {}  {} § {} ({})", continuation, conn, h.title, h.anchor);
        } else {
            print!("  {}  {} ", continuation, conn);
            let mut stdout = std::io::stdout();
            let no_ansi = NO_ANSI.load(Ordering::Relaxed);
            if !no_ansi {
                let _ = execute!(
                    stdout,
                    SetForegroundColor(Color::Yellow),
                    Print("§ "),
                    ResetColor,
                    Print(&h.title),
                    Print(" "),
                );
            } else {
                print!("§ {} ", h.title);
            }
            print_dim(&format!("(#{})", h.anchor));
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

// ── Page section helpers ────────────────────────────────────────────────────

/// A heading extracted from a documentation page
#[derive(Debug, Clone)]
struct PageHeading {
    title: String,
    anchor: String,
    level: u8,
}

/// Convert heading text to a URL-friendly kebab-case anchor.
///
/// `"Tutorial: From Parquet in S3"` → `"tutorial-from-parquet-in-s3"`
fn heading_to_anchor(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
}

/// Extract H2 and H3 headings from markdown content.
///
/// Skips headings inside fenced code blocks (``` ``` ```) to avoid false positives
/// from code examples containing markdown.
fn parse_page_headings(content: &str) -> Vec<PageHeading> {
    let mut headings = Vec::new();
    let mut in_code_block = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block {
            continue;
        }
        if let Some(title) = trimmed.strip_prefix("### ") {
            headings.push(PageHeading {
                title: title.to_string(),
                anchor: heading_to_anchor(title),
                level: 3,
            });
        } else if let Some(title) = trimmed.strip_prefix("## ") {
            headings.push(PageHeading {
                title: title.to_string(),
                anchor: heading_to_anchor(title),
                level: 2,
            });
        }
    }
    headings
}

/// Extract a section of markdown content by heading anchor.
///
/// Returns everything from the matching heading line through to (but not including)
/// the next heading of equal or higher level. An H2 match includes all its H3 children.
fn extract_section(content: &str, anchor: &str) -> Option<String> {
    let lines: Vec<&str> = content.lines().collect();
    let mut start = None;
    let mut matched_level = 0u8;
    let anchor_lower = anchor.to_lowercase();
    let mut in_code_block = false;

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block {
            continue;
        }
        let (level, title) = if let Some(t) = trimmed.strip_prefix("### ") {
            (3u8, t)
        } else if let Some(t) = trimmed.strip_prefix("## ") {
            (2u8, t)
        } else {
            continue;
        };

        if start.is_none() && heading_to_anchor(title) == anchor_lower {
            start = Some(i);
            matched_level = level;
        } else if let Some(s) = start {
            if level <= matched_level && i > s {
                return Some(lines[s..i].join("\n"));
            }
        }
    }

    // If we found the heading but reached EOF, return everything from start to end
    start.map(|s| lines[s..].join("\n"))
}

/// Strip base64-encoded image data from markdown content.
///
/// Removes:
/// - Reference-style image definitions: `[imageN]: <data:image/...>`
/// - Inline image placeholders: `![][imageN]`
fn strip_images(content: &str) -> String {
    let mut result = String::with_capacity(content.len());
    for line in content.lines() {
        let trimmed = line.trim();
        // Skip reference-style base64 image definitions
        if trimmed.starts_with('[') && trimmed.contains("]: <data:image/") {
            continue;
        }
        // Skip standalone inline image placeholders like ![][image1]
        if trimmed.starts_with("![]") && trimmed.ends_with(']') {
            continue;
        }
        result.push_str(line);
        result.push('\n');
    }
    // Trim trailing newlines that accumulate from removed blocks
    let trimmed = result.trim_end_matches('\n');
    let mut out = trimmed.to_string();
    out.push('\n');
    out
}

/// Fetch raw page content from the docs site (shared by fetch_page and browse section picker)
async fn fetch_page_content(slug: &str, lang: DocsLanguage) -> Result<String, RoutineFailure> {
    let stripped = slug.trim_start_matches('/').to_lowercase();
    let with_ext = if stripped.ends_with(".md") {
        stripped.to_string()
    } else {
        format!("{}.md", stripped)
    };

    let url = format!("{}/{}?lang={}", DOCS_BASE_URL, with_ext, lang.query_param());

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

    response.text().await.map_err(|e| {
        RoutineFailure::new(
            Message::new(
                "Docs".to_string(),
                "Failed to read documentation content".to_string(),
            ),
            e,
        )
    })
}

// ── Public API ──────────────────────────────────────────────────────────────

/// Fetch the TOC and display as a tree.
///
/// Called when the user runs `moose docs` with no arguments.
/// When `expand` is true, also fetches guide pages in parallel to show their H2 sections.
pub async fn show_toc(
    expand: bool,
    raw: bool,
    lang: DocsLanguage,
) -> Result<RoutineSuccess, RoutineFailure> {
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

    // When expanding, fetch guide pages in parallel to extract their headings
    let mut guide_headings = std::collections::HashMap::new();
    if expand {
        let guide_slugs: Vec<String> = sections
            .iter()
            .flat_map(|s| s.entries.iter())
            .filter(|e| e.slug.starts_with("guides/"))
            .map(|e| e.slug.clone())
            .collect();

        if !guide_slugs.is_empty() && !raw {
            show_message!(
                MessageType::Info,
                Message::new("Docs".to_string(), "Fetching guide sections...".to_string())
            );
        }

        let futures: Vec<_> = guide_slugs
            .iter()
            .map(|slug| {
                let slug = slug.clone();
                async move {
                    let result = fetch_page_content(&slug, lang).await;
                    (slug, result)
                }
            })
            .collect();

        let results = futures::future::join_all(futures).await;
        for (slug, result) in results {
            if let Ok(content) = result {
                let headings = parse_page_headings(&content);
                guide_headings.insert(slug, headings);
            }
        }
    }

    println!();
    display_toc_tree(&sections, expand, raw, &guide_headings);

    if !raw {
        println!();
        print_dim("  Tip: moose docs <slug> to view a page, moose docs search <query> to search");
        print_dim("        moose docs <slug>#<section> to view a specific section of a guide");
        if !expand {
            print_dim("        moose docs --expand to show all pages");
        }
    }

    Ok(RoutineSuccess::success(Message::new(
        "Docs".to_string(),
        "Documentation index displayed".to_string(),
    )))
}

/// Fetch and display a single documentation page by slug, optionally extracting a section.
///
/// Called when the user runs `moose docs <slug>` or `moose docs <slug>#<section>`.
/// For guide pages, an optional `section` anchor can be provided to extract just that section.
pub async fn fetch_page(
    slug: &str,
    lang: DocsLanguage,
    raw: bool,
    section: Option<&str>,
) -> Result<RoutineSuccess, RoutineFailure> {
    let stripped = slug.trim_start_matches('/');
    let display_slug = stripped.trim_end_matches(".md");

    let section_label = section.map(|s| format!("#{}", s)).unwrap_or_default();

    if !raw {
        show_message!(
            MessageType::Info,
            Message::new(
                "Docs".to_string(),
                format!(
                    "Fetching {} docs for {}{}...",
                    lang.display_name(),
                    display_slug,
                    section_label
                )
            )
        );
    }

    let content = fetch_page_content(slug, lang).await?;
    let content = strip_images(&content);

    if let Some(anchor) = section {
        match extract_section(&content, anchor) {
            Some(section_content) => {
                println!("{}", section_content);
                if raw {
                    Ok(RoutineSuccess::success(Message::new(
                        String::new(),
                        String::new(),
                    )))
                } else {
                    Ok(RoutineSuccess::success(Message::new(
                        "Docs".to_string(),
                        format!("Fetched {}#{}", display_slug, anchor),
                    )))
                }
            }
            None => {
                let headings = parse_page_headings(&content);
                let available: Vec<String> = headings
                    .iter()
                    .map(|h| {
                        let indent = if h.level == 3 { "    " } else { "  " };
                        format!("{}{} ({})", indent, h.title, h.anchor)
                    })
                    .collect();

                Err(RoutineFailure::error(Message::new(
                    "Docs".to_string(),
                    format!(
                        "Section '{}' not found in {}.\n\nAvailable sections:\n{}",
                        anchor,
                        display_slug,
                        available.join("\n")
                    ),
                )))
            }
        }
    } else {
        println!("{}", content);
        if raw {
            Ok(RoutineSuccess::success(Message::new(
                String::new(),
                String::new(),
            )))
        } else {
            Ok(RoutineSuccess::success(Message::new(
                "Docs".to_string(),
                format!("Fetched {}", display_slug),
            )))
        }
    }
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

// ── Browser ─────────────────────────────────────────────────────────────────

/// Open a documentation page in the user's default web browser.
///
/// Uses platform-specific commands: `open` (macOS), `xdg-open` (Linux), `cmd /c start` (Windows).
pub fn open_in_browser(slug: &str) -> Result<RoutineSuccess, RoutineFailure> {
    let stripped = slug.trim_start_matches('/');
    // Split off #anchor before stripping .md extension
    let (path, anchor) = match stripped.split_once('#') {
        Some((p, a)) => (p.trim_end_matches(".md"), Some(a)),
        None => (stripped.trim_end_matches(".md"), None),
    };
    let url = match anchor {
        Some(a) => format!("{}/{}#{}", DOCS_BASE_URL, path, a),
        None => format!("{}/{}", DOCS_BASE_URL, path),
    };
    let stripped = anchor
        .map(|a| format!("{}#{}", path, a))
        .unwrap_or_else(|| path.to_string());

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).status();

    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&url).status();

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args(["/c", "start", &url])
        .status();

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    let result: Result<std::process::ExitStatus, std::io::Error> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "unsupported platform",
    ));

    match result {
        Ok(status) if status.success() => Ok(RoutineSuccess::success(Message::new(
            "Docs".to_string(),
            format!("Opened {} in browser", stripped),
        ))),
        Ok(_) => Err(RoutineFailure::error(Message::new(
            "Docs".to_string(),
            format!("Failed to open browser for {}", url),
        ))),
        Err(e) => Err(RoutineFailure::new(
            Message::new("Docs".to_string(), format!("Failed to open browser: {}", e)),
            e,
        )),
    }
}

// ── Browse (interactive picker) ─────────────────────────────────────────────

/// A picker item with a title and a detail string (shown dimmed)
#[derive(Debug, Clone)]
struct PickerItem {
    title: String,
    detail: String,
}

/// Result of running the interactive picker
enum PickerResult {
    /// User selected an item (index into the items list)
    Selected(usize),
    /// User pressed Esc/Backspace-on-empty to go back
    Back,
    /// User pressed Ctrl+C to cancel entirely
    Cancelled,
}

/// Filter picker items by case-insensitive substring match on title and detail
fn filter_items<'a>(items: &'a [PickerItem], query: &str) -> Vec<(usize, &'a PickerItem)> {
    if query.is_empty() {
        return items.iter().enumerate().collect();
    }
    let q = query.to_lowercase();
    items
        .iter()
        .enumerate()
        .filter(|(_, item)| {
            item.title.to_lowercase().contains(&q) || item.detail.to_lowercase().contains(&q)
        })
        .collect()
}

/// Render the picker list, returning the number of lines drawn.
fn render_picker(
    stdout: &mut std::io::Stdout,
    filtered: &[(usize, &PickerItem)],
    selected: usize,
    query: &str,
    max_visible: usize,
    total: usize,
) -> Result<usize, std::io::Error> {
    let no_ansi = NO_ANSI.load(Ordering::Relaxed);

    // Filter input line
    execute!(stdout, MoveToColumn(0), Clear(ClearType::CurrentLine))?;
    if no_ansi {
        write!(stdout, "  > {}", query)?;
    } else {
        execute!(
            stdout,
            SetForegroundColor(Color::Green),
            Print("  > "),
            ResetColor,
            Print(query)
        )?;
    }

    let count = filtered.len();
    let visible = count.min(max_visible);
    let scroll_offset = if selected >= visible {
        selected - visible + 1
    } else {
        0
    };

    let mut lines_drawn = 1;
    for i in 0..visible {
        let idx = scroll_offset + i;
        let (_, item) = &filtered[idx];

        execute!(
            stdout,
            Print("\n"),
            MoveToColumn(0),
            Clear(ClearType::CurrentLine)
        )?;

        if idx == selected {
            if no_ansi {
                write!(stdout, "  > {}", item.title)?;
                if !item.detail.is_empty() {
                    write!(stdout, " ({})", item.detail)?;
                }
            } else {
                execute!(
                    stdout,
                    SetBackgroundColor(Color::DarkCyan),
                    SetForegroundColor(Color::White),
                    SetAttribute(Attribute::Bold),
                    Print(format!("  > {} ", item.title)),
                    SetAttribute(Attribute::Reset),
                )?;
                if !item.detail.is_empty() {
                    execute!(
                        stdout,
                        SetBackgroundColor(Color::DarkCyan),
                        SetForegroundColor(Color::Grey),
                        Print(format!("({})", item.detail)),
                    )?;
                }
                execute!(stdout, ResetColor, SetAttribute(Attribute::Reset))?;
            }
        } else if no_ansi {
            write!(stdout, "    {}", item.title)?;
            if !item.detail.is_empty() {
                write!(stdout, " ({})", item.detail)?;
            }
        } else {
            execute!(stdout, Print(format!("    {} ", item.title)))?;
            if !item.detail.is_empty() {
                execute!(
                    stdout,
                    SetForegroundColor(Color::DarkGrey),
                    Print(format!("({})", item.detail)),
                    ResetColor,
                )?;
            }
        }
        lines_drawn += 1;
    }

    // Status line
    execute!(
        stdout,
        Print("\n"),
        MoveToColumn(0),
        Clear(ClearType::CurrentLine)
    )?;
    let status = format!("  {} of {}", count, total);
    if no_ansi {
        write!(stdout, "{}", status)?;
    } else {
        execute!(
            stdout,
            SetForegroundColor(Color::DarkGrey),
            Print(status),
            ResetColor,
        )?;
    }
    lines_drawn += 1;

    stdout.flush()?;
    Ok(lines_drawn)
}

/// Clear the picker UI from the terminal
fn clear_picker(stdout: &mut std::io::Stdout, prev_lines: usize) {
    if prev_lines > 1 {
        execute!(stdout, MoveUp(prev_lines as u16 - 1)).ok();
    }
    for _ in 0..prev_lines {
        execute!(
            stdout,
            MoveToColumn(0),
            Clear(ClearType::CurrentLine),
            Print("\n")
        )
        .ok();
    }
    if prev_lines > 0 {
        execute!(stdout, MoveUp(prev_lines as u16)).ok();
    }
}

/// RAII guard that disables terminal raw mode on drop (including panics).
struct RawModeGuard;

impl Drop for RawModeGuard {
    fn drop(&mut self) {
        let _ = terminal::disable_raw_mode();
    }
}

/// Run the interactive picker on a list of items.
///
/// Returns `Selected(index)` when user picks an item, `Back` when they
/// press Esc or Backspace on an empty filter, `Cancelled` on Ctrl+C.
fn run_picker(items: &[PickerItem], header: &str) -> Result<PickerResult, RoutineFailure> {
    let mut stdout = std::io::stdout();
    let mut query = String::new();
    let mut selected: usize = 0;

    let term_height = terminal::size().map(|(_, h)| h as usize).unwrap_or(24);
    let max_visible = (term_height.saturating_sub(5)).min(15);
    let total = items.len();

    // Print header
    let no_ansi = NO_ANSI.load(Ordering::Relaxed);
    if no_ansi {
        println!(
            "  {} — Type to filter, Up/Down navigate, Enter select, Esc back",
            header
        );
        println!();
    } else {
        execute!(
            stdout,
            SetForegroundColor(Color::Cyan),
            SetAttribute(Attribute::Bold),
            Print(format!("  {}", header)),
            ResetColor,
            SetAttribute(Attribute::Reset),
            SetForegroundColor(Color::DarkGrey),
            Print(" — "),
            Print("filter, "),
            SetForegroundColor(Color::Cyan),
            Print("↑/↓"),
            SetForegroundColor(Color::DarkGrey),
            Print(" navigate, "),
            SetForegroundColor(Color::Cyan),
            Print("Enter"),
            SetForegroundColor(Color::DarkGrey),
            Print(" select, "),
            SetForegroundColor(Color::Cyan),
            Print("Esc"),
            SetForegroundColor(Color::DarkGrey),
            Print(" back"),
            ResetColor,
            Print("\n\n")
        )
        .map_err(|e| {
            RoutineFailure::new(
                Message::new("Docs".to_string(), "Terminal error".to_string()),
                e,
            )
        })?;
    }

    // Initial render
    let filtered = filter_items(items, &query);
    let mut prev_lines =
        render_picker(&mut stdout, &filtered, selected, &query, max_visible, total).map_err(
            |e| {
                RoutineFailure::new(
                    Message::new("Docs".to_string(), "Render error".to_string()),
                    e,
                )
            },
        )?;

    terminal::enable_raw_mode().map_err(|e| {
        RoutineFailure::new(
            Message::new("Docs".to_string(), "Failed to enable raw mode".to_string()),
            e,
        )
    })?;
    let _raw_guard = RawModeGuard;

    let result = loop {
        match read() {
            Ok(Event::Key(key)) => {
                if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
                    break PickerResult::Cancelled;
                }

                match key.code {
                    KeyCode::Esc => break PickerResult::Back,
                    KeyCode::Enter => {
                        let filtered = filter_items(items, &query);
                        if !filtered.is_empty() && selected < filtered.len() {
                            let (orig_idx, _) = filtered[selected];
                            break PickerResult::Selected(orig_idx);
                        }
                    }
                    KeyCode::Backspace => {
                        if query.is_empty() {
                            break PickerResult::Back;
                        }
                        query.pop();
                        selected = 0;
                    }
                    KeyCode::Up => {
                        selected = selected.saturating_sub(1);
                    }
                    KeyCode::Down => {
                        let filtered = filter_items(items, &query);
                        if selected + 1 < filtered.len() {
                            selected += 1;
                        }
                    }
                    KeyCode::Char(c) => {
                        if key.modifiers.contains(KeyModifiers::CONTROL) {
                            continue;
                        }
                        query.push(c);
                        selected = 0;
                    }
                    _ => {}
                }

                // Redraw
                if prev_lines > 1 {
                    execute!(stdout, MoveUp(prev_lines as u16 - 1)).ok();
                }
                execute!(stdout, MoveToColumn(0)).ok();

                let filtered = filter_items(items, &query);
                selected = selected.min(filtered.len().saturating_sub(1));

                match render_picker(&mut stdout, &filtered, selected, &query, max_visible, total) {
                    Ok(lines) => prev_lines = lines,
                    Err(_) => break PickerResult::Cancelled,
                }
            }
            Ok(_) => {}
            Err(_) => break PickerResult::Cancelled,
        }
    };

    drop(_raw_guard);
    clear_picker(&mut stdout, prev_lines);
    Ok(result)
}

/// Build picker items for the top-level section list
fn section_items(sections: &[TocSection]) -> Vec<PickerItem> {
    sections
        .iter()
        .map(|s| PickerItem {
            title: s.name.clone(),
            detail: format!("{} pages", s.entries.len()),
        })
        .collect()
}

/// Build picker items for the groups within a section
fn group_items(section: &TocSection) -> Vec<PickerItem> {
    let groups = group_entries_by_parent(&section.entries);
    groups
        .into_iter()
        .map(|g| {
            if g.entries.len() == 1 {
                let e = g.entries[0];
                PickerItem {
                    title: e.title.clone(),
                    detail: e.slug.trim_end_matches(".md").to_string(),
                }
            } else {
                PickerItem {
                    title: g.label,
                    detail: format!("{} pages", g.entries.len()),
                }
            }
        })
        .collect()
}

/// Build picker items for pages within a group
fn page_items_for_group(section: &TocSection, group_idx: usize) -> Vec<PickerItem> {
    let groups = group_entries_by_parent(&section.entries);
    if group_idx >= groups.len() {
        return Vec::new();
    }
    groups[group_idx]
        .entries
        .iter()
        .map(|e| PickerItem {
            title: e.title.clone(),
            detail: e.slug.trim_end_matches(".md").to_string(),
        })
        .collect()
}

/// Get the slug for a page within a group
fn slug_for_group_page(section: &TocSection, group_idx: usize, page_idx: usize) -> Option<String> {
    let groups = group_entries_by_parent(&section.entries);
    groups
        .get(group_idx)
        .and_then(|g| g.entries.get(page_idx))
        .map(|e| e.slug.clone())
}

/// Build picker items for sections within a guide page (H2/H3 headings)
fn guide_section_items(headings: &[PageHeading]) -> Vec<PickerItem> {
    let mut items = vec![PickerItem {
        title: "Full page".to_string(),
        detail: "view entire guide".to_string(),
    }];
    for h in headings {
        let indent = if h.level == 3 { "  " } else { "" };
        items.push(PickerItem {
            title: format!("{}{}", indent, h.title),
            detail: format!("#{}", h.anchor),
        });
    }
    items
}

/// Interactively browse documentation with hierarchical drill-down.
///
/// Navigation: Sections → Groups → Pages → (Guide sections for guides/).
/// Enter drills in, Esc/Backspace-on-empty goes back up.
pub async fn browse_docs(
    lang: DocsLanguage,
    raw: bool,
    web: bool,
) -> Result<RoutineSuccess, RoutineFailure> {
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
            "No documentation entries found".to_string(),
        )));
    }

    // Non-TTY fallback
    if !std::io::stdout().is_terminal() {
        let all: Vec<_> = sections.iter().flat_map(|s| s.entries.iter()).collect();
        for (i, entry) in all.iter().enumerate() {
            println!(
                "{:3}. {} ({})",
                i + 1,
                entry.title,
                entry.slug.trim_end_matches(".md")
            );
        }
        println!();
        let input = crate::cli::prompt_user("Enter number", Some("1"), None)?;
        let idx: usize = input.trim().parse().unwrap_or(1);
        if idx == 0 || idx > all.len() {
            return Err(RoutineFailure::error(Message::new(
                "Docs".to_string(),
                "Invalid selection".to_string(),
            )));
        }
        let selected = all[idx - 1];
        if web {
            return open_in_browser(&selected.slug);
        } else {
            return fetch_page(&selected.slug, lang, raw, None).await;
        }
    }

    // Hierarchical drill-down navigation
    let mut section_idx: Option<usize> = None;
    let mut group_idx: Option<usize> = None;
    let mut auto_drilled = false;

    loop {
        if section_idx.is_none() {
            // Level 1: Pick a section
            let items = section_items(&sections);
            match run_picker(&items, "Documentation")? {
                PickerResult::Selected(idx) => section_idx = Some(idx),
                PickerResult::Back | PickerResult::Cancelled => {
                    return Ok(RoutineSuccess::success(Message::new(
                        "Docs".to_string(),
                        "Browse cancelled".to_string(),
                    )));
                }
            }
        } else if group_idx.is_none() {
            // Level 2: Pick a group within the section
            let si = section_idx.unwrap();
            let section = &sections[si];
            let items = group_items(section);

            // Auto-drill when there's only one group (e.g., Guides section)
            if items.len() == 1 {
                let groups = group_entries_by_parent(&section.entries);
                if groups[0].entries.len() == 1 {
                    let slug = &groups[0].entries[0].slug;
                    if slug.starts_with("guides/") {
                        return browse_guide_page(slug, lang, raw, web).await;
                    } else if web {
                        return open_in_browser(slug);
                    } else {
                        return fetch_page(slug, lang, raw, None).await;
                    }
                } else {
                    group_idx = Some(0);
                    auto_drilled = true;
                    continue;
                }
            }

            // If a group has only 1 entry (detail contains a slug not "N pages"),
            // selecting it should go directly to the page
            match run_picker(&items, &section.name)? {
                PickerResult::Selected(idx) => {
                    let groups = group_entries_by_parent(&section.entries);
                    if groups[idx].entries.len() == 1 {
                        // Single-page group: go directly to the page
                        let slug = &groups[idx].entries[0].slug;
                        if slug.starts_with("guides/") {
                            // Guide page: drill into sections
                            return browse_guide_page(slug, lang, raw, web).await;
                        } else if web {
                            return open_in_browser(slug);
                        } else {
                            return fetch_page(slug, lang, raw, None).await;
                        }
                    } else {
                        group_idx = Some(idx);
                    }
                }
                PickerResult::Back => section_idx = None,
                PickerResult::Cancelled => {
                    return Ok(RoutineSuccess::success(Message::new(
                        "Docs".to_string(),
                        "Browse cancelled".to_string(),
                    )));
                }
            }
        } else {
            // Level 3: Pick a page within the group
            let si = section_idx.unwrap();
            let gi = group_idx.unwrap();
            let section = &sections[si];
            let groups = group_entries_by_parent(&section.entries);
            let items = page_items_for_group(section, gi);

            match run_picker(&items, &groups[gi].label)? {
                PickerResult::Selected(idx) => {
                    if let Some(slug) = slug_for_group_page(section, gi, idx) {
                        if slug.starts_with("guides/") {
                            return browse_guide_page(&slug, lang, raw, web).await;
                        } else if web {
                            return open_in_browser(&slug);
                        } else {
                            return fetch_page(&slug, lang, raw, None).await;
                        }
                    }
                }
                PickerResult::Back => {
                    if auto_drilled {
                        // Skip back to section selection to avoid re-entering auto-drill loop
                        section_idx = None;
                        auto_drilled = false;
                    }
                    group_idx = None;
                }
                PickerResult::Cancelled => {
                    return Ok(RoutineSuccess::success(Message::new(
                        "Docs".to_string(),
                        "Browse cancelled".to_string(),
                    )));
                }
            }
        }
    }
}

/// Browse into a guide page, showing a section picker (H2/H3 headings).
async fn browse_guide_page(
    slug: &str,
    lang: DocsLanguage,
    raw: bool,
    web: bool,
) -> Result<RoutineSuccess, RoutineFailure> {
    let slug_display = slug.trim_start_matches('/').trim_end_matches(".md");

    if !raw {
        show_message!(
            MessageType::Info,
            Message::new(
                "Docs".to_string(),
                format!("Fetching sections for {}...", slug_display)
            )
        );
    }

    let content = fetch_page_content(slug, lang).await?;
    let headings = parse_page_headings(&content);

    if headings.is_empty() || !std::io::stdout().is_terminal() {
        let cleaned = strip_images(&content);
        println!("{}", cleaned);
        return Ok(RoutineSuccess::success(Message::new(
            "Docs".to_string(),
            format!("Fetched {}", slug_display),
        )));
    }

    let items = guide_section_items(&headings);
    match run_picker(&items, slug_display)? {
        PickerResult::Selected(0) => {
            // "Full page"
            if web {
                open_in_browser(slug)
            } else {
                let cleaned = strip_images(&content);
                println!("{}", cleaned);
                Ok(RoutineSuccess::success(Message::new(
                    "Docs".to_string(),
                    format!("Fetched {}", slug_display),
                )))
            }
        }
        PickerResult::Selected(idx) => {
            // Section selected (idx-1 because idx 0 is "Full page")
            let heading = &headings[idx - 1];
            if web {
                let with_anchor = format!("{}#{}", slug_display, heading.anchor);
                open_in_browser(&with_anchor)
            } else {
                let cleaned = strip_images(&content);
                match extract_section(&cleaned, &heading.anchor) {
                    Some(section_content) => {
                        println!("{}", section_content);
                        Ok(RoutineSuccess::success(Message::new(
                            "Docs".to_string(),
                            format!("Fetched {}#{}", slug_display, heading.anchor),
                        )))
                    }
                    None => {
                        // Fallback: print full page
                        println!("{}", cleaned);
                        Ok(RoutineSuccess::success(Message::new(
                            "Docs".to_string(),
                            format!("Fetched {}", slug_display),
                        )))
                    }
                }
            }
        }
        PickerResult::Back | PickerResult::Cancelled => {
            // For guide section back, just print full page as graceful fallback
            if raw {
                let cleaned = strip_images(&content);
                println!("{}", cleaned);
            }
            Ok(RoutineSuccess::success(Message::new(
                "Docs".to_string(),
                "Browse cancelled".to_string(),
            )))
        }
    }
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
    fn test_parse_toc_entry_with_parens_in_title() {
        let line =
            "- [TTL (Time-to-Live)](/moosestack/olap/ttl.md) - Configure automatic data expiration";
        let entry = parse_toc_entry(line).unwrap();
        assert_eq!(entry.title, "TTL (Time-to-Live)");
        assert_eq!(entry.slug, "moosestack/olap/ttl.md");
        assert_eq!(entry.description, "Configure automatic data expiration");

        let line2 = "- [moose migrate (CLI)](/moosestack/migrate/apply-planned-migrations-cli.md) - Reference documentation for the manual migration CLI command";
        let entry2 = parse_toc_entry(line2).unwrap();
        assert_eq!(entry2.title, "moose migrate (CLI)");
        assert_eq!(
            entry2.slug,
            "moosestack/migrate/apply-planned-migrations-cli.md"
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

    #[test]
    fn test_heading_to_anchor() {
        assert_eq!(heading_to_anchor("Overview"), "overview");
        assert_eq!(
            heading_to_anchor("Going to production"),
            "going-to-production"
        );
        assert_eq!(
            heading_to_anchor("Tutorial: From Parquet in S3 to Chat Application"),
            "tutorial-from-parquet-in-s3-to-chat-application"
        );
        assert_eq!(
            heading_to_anchor("Architecture & Scope"),
            "architecture-scope"
        );
    }

    #[test]
    fn test_parse_page_headings() {
        let content = "# Title\n\nSome intro.\n\n## Overview\n\nText here.\n\n### Setup\n\nMore text.\n\n## Tutorial\n\nContent.\n";
        let headings = parse_page_headings(content);
        assert_eq!(headings.len(), 3);
        assert_eq!(headings[0].title, "Overview");
        assert_eq!(headings[0].level, 2);
        assert_eq!(headings[1].title, "Setup");
        assert_eq!(headings[1].level, 3);
        assert_eq!(headings[2].title, "Tutorial");
        assert_eq!(headings[2].level, 2);
    }

    #[test]
    fn test_extract_section_h2() {
        let content = "# Title\n\n## Overview\n\nIntro text.\n\n### Details\n\nDetail text.\n\n## Tutorial\n\nTutorial content.\n";
        let section = extract_section(content, "overview").unwrap();
        assert!(section.starts_with("## Overview"));
        assert!(section.contains("Intro text."));
        assert!(section.contains("### Details"));
        assert!(section.contains("Detail text."));
        assert!(!section.contains("## Tutorial"));
    }

    #[test]
    fn test_extract_section_h3() {
        let content = "## Overview\n\nIntro.\n\n### Setup\n\nSetup text.\n\n### Deploy\n\nDeploy text.\n\n## Tutorial\n";
        let section = extract_section(content, "setup").unwrap();
        assert!(section.starts_with("### Setup"));
        assert!(section.contains("Setup text."));
        assert!(!section.contains("### Deploy"));
    }

    #[test]
    fn test_extract_section_case_insensitive() {
        let content = "## Overview\n\nIntro.\n\n## Tutorial\n\nContent.\n";
        // Uppercase anchor should still match
        assert!(extract_section(content, "Overview").is_some());
        assert!(extract_section(content, "OVERVIEW").is_some());
        assert!(extract_section(content, "overview").is_some());
    }

    #[test]
    fn test_extract_section_not_found() {
        let content = "## Overview\n\nText.\n";
        assert!(extract_section(content, "nonexistent").is_none());
    }

    #[test]
    fn test_extract_section_at_eof() {
        let content = "## First\n\nText.\n\n## Last\n\nFinal text.\n";
        let section = extract_section(content, "last").unwrap();
        assert!(section.starts_with("## Last"));
        assert!(section.contains("Final text."));
    }

    #[test]
    fn test_parse_page_headings_skips_code_blocks() {
        let content =
            "## Real Heading\n\nText.\n\n```markdown\n## Fake Heading\n```\n\n## Another Real\n";
        let headings = parse_page_headings(content);
        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].title, "Real Heading");
        assert_eq!(headings[1].title, "Another Real");
    }

    #[test]
    fn test_extract_section_skips_code_blocks() {
        let content = "## Overview\n\nIntro.\n\n```bash\n## This is not a heading\n```\n\nMore overview text.\n\n## Tutorial\n\nContent.\n";
        let section = extract_section(content, "overview").unwrap();
        assert!(section.contains("Intro."));
        assert!(section.contains("More overview text."));
        assert!(!section.contains("## Tutorial"));
    }

    #[test]
    fn test_strip_images() {
        let content = "Some text.\n\n![][image1]\n\nMore text.\n\n[image1]: <data:image/png;base64,iVBOR...>\n";
        let stripped = strip_images(content);
        assert!(stripped.contains("Some text."));
        assert!(stripped.contains("More text."));
        assert!(!stripped.contains("data:image"));
        assert!(!stripped.contains("![][image1]"));
    }

    #[test]
    fn test_strip_images_preserves_normal_links() {
        let content = "See [this link](https://example.com) for details.\n";
        let stripped = strip_images(content);
        assert!(stripped.contains("[this link](https://example.com)"));
    }
}
