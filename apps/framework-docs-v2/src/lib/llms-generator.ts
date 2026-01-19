import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { Language } from "./content-types";
import {
  sectionNavigationConfigs,
  type NavItem,
  type NavPage,
} from "@/config/navigation";

export const LLM_MD_SUFFIX = "/llm.md";

const CONTENT_ROOT = path.join(process.cwd(), "content");

// --- Language Content Filtering ---

/** Normalize ?lang= query param to valid Language type (defaults to typescript) */
function normalizeLanguageParam(
  param?: string | string[] | undefined,
): Language {
  if (typeof param === "string") {
    return param === "python" ? "python" : "typescript";
  }
  if (Array.isArray(param) && param[0] === "python") {
    return "python";
  }
  return "typescript";
}

/** Build regex to match <LanguageTabContent value="..."> blocks */
function buildLanguageTabRegex(language: string) {
  return new RegExp(
    `<LanguageTabContent\\s+value="${language}"[^>]*>([\\s\\S]*?)</LanguageTabContent>`,
    "gi",
  );
}

/** Strip opposite language blocks and unwrap matching language blocks */
export function filterLanguageContent(
  content: string,
  languageParam?: string | string[] | undefined,
): string {
  const language = normalizeLanguageParam(languageParam);
  const excludeLang = language === "python" ? "typescript" : "python";

  let filtered = content.replace(buildLanguageTabRegex(excludeLang), "");
  filtered = filtered.replace(
    buildLanguageTabRegex(language),
    (_match, inner) => inner ?? "",
  );

  return filtered;
}

// --- Content Cleaning ---

/**
 * Clean markdown content for LLM consumption
 */
export function cleanContent(content: string): string {
  let cleaned = content;

  // Remove MDX module-level imports/exports (before first heading)
  const firstHeadingMatch = cleaned.match(/^#+ /m);
  if (firstHeadingMatch && firstHeadingMatch.index !== undefined) {
    const beforeHeading = cleaned.slice(0, firstHeadingMatch.index);
    const afterHeading = cleaned.slice(firstHeadingMatch.index);

    const cleanedBeforeHeading = beforeHeading
      .replace(/^import .*$/gm, "")
      .replace(/^export (default|const) .*$/gm, "");

    cleaned = cleanedBeforeHeading + afterHeading;
  }

  // Remove JSX components
  cleaned = cleaned.replace(/<>|<\/>/g, "");
  cleaned = cleaned.replace(/<[A-Z][A-Za-z0-9]*(?:\s[^<>]*)?\/>/g, "");
  cleaned = cleaned.replace(/<[A-Z][A-Za-z0-9]*(?:\s[^<>]*)?>/g, "");
  cleaned = cleaned.replace(/<\/[A-Z][A-Za-z0-9]*>/g, "");
  // Remove HTML tags (like <div>, <script>, <span>)
  cleaned = cleaned.replace(/(^|\s)<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>/gm, "$1");

  // Remove HTML comments (apply repeatedly to catch nested/fragmented cases)
  let prev: string;
  do {
    prev = cleaned;
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");
  } while (cleaned !== prev);

  // Clean up excessive whitespace
  cleaned = cleaned.replace(/^[ \t]+$/gm, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.trim();

  return cleaned;
}

// --- TOC Generation ---

interface TocEntry {
  title: string;
  description?: string;
  url: string;
}

/** Read title/description from MDX file's YAML frontmatter */
function getFrontmatter(
  slug: string,
): { title?: string; description?: string } | null {
  const normalizedSlug = slug === "index" ? "index" : slug;
  const paths = [
    path.join(CONTENT_ROOT, `${normalizedSlug}.mdx`),
    path.join(CONTENT_ROOT, `${normalizedSlug}.md`),
    path.join(CONTENT_ROOT, normalizedSlug, "index.mdx"),
    path.join(CONTENT_ROOT, normalizedSlug, "index.md"),
  ];

  for (const filePath of paths) {
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, "utf8");
        const { data } = matter(fileContent);
        return { title: data.title, description: data.description };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Convert NavPage to TocEntry, merging nav config with frontmatter */
function processPage(page: NavPage): TocEntry {
  const frontmatter = getFrontmatter(page.slug);
  return {
    title: page.title || frontmatter?.title || page.slug,
    description: page.description || frontmatter?.description,
    url: `/${page.slug}${LLM_MD_SUFFIX}`,
  };
}

/** Recursively walk nav tree, skipping draft/beta pages */
function processNavItems(items: NavItem[]): TocEntry[] {
  const entries: TocEntry[] = [];

  for (const item of items) {
    if (item.type === "page") {
      // Skip draft/beta pages (behind feature flags) and external pages (no local content)
      if (item.status === "draft" || item.status === "beta" || item.external) {
        continue;
      }
      entries.push(processPage(item));
      if (item.children) {
        entries.push(...processNavItems(item.children));
      }
    } else if (item.type === "section") {
      entries.push(...processNavItems(item.items));
    }
  }

  return entries;
}

// Whitelist of publicly visible sections for the TOC.
// New sections are hidden by default until explicitly added here.
// This prevents accidentally exposing sections behind feature flags (ai, hosting, etc.)
const PUBLIC_SECTIONS = new Set(["moosestack", "guides"]);

/**
 * Generate TOC markdown for LLM consumption
 * Lists all documentation pages with links to their /llm.md endpoints
 * Filters out sections/pages behind feature flags
 */
export function generateLlmToc(): string {
  const sections: { title: string; entries: TocEntry[] }[] = [];

  for (const config of Object.values(sectionNavigationConfigs)) {
    // Only include whitelisted public sections
    if (!PUBLIC_SECTIONS.has(config.id)) {
      continue;
    }
    const entries = processNavItems(config.nav);
    if (entries.length > 0) {
      sections.push({ title: config.title, entries });
    }
  }

  const lines: string[] = [
    "# MooseStack Documentation",
    "",
    "This is a table of contents for the MooseStack documentation.",
    "Each link points to the LLM-friendly markdown version of that page.",
    "",
  ];

  for (const section of sections) {
    lines.push(`## ${section.title}`, "");
    for (const entry of section.entries) {
      const desc = entry.description ? ` - ${entry.description}` : "";
      lines.push(`- [${entry.title}](${entry.url})${desc}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
