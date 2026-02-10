import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { Language } from "./content-types";
import {
  sectionNavigationConfigs,
  type NavItem,
  type NavPage,
} from "@/config/navigation";
import { CONTENT_ROOT } from "./includes";

export const LLM_MD_SUFFIX = ".md";
export const LLM_TXT_SUFFIX = ".txt";

// Re-export content filtering functions (now client-safe)
export { filterLanguageContent, cleanContent } from "./content-filters";

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
      } catch (error) {
        console.warn(`Failed to parse frontmatter for ${filePath}:`, error);
        return null;
      }
    }
  }
  return null;
}

/** Convert NavPage to TocEntry, merging nav config with frontmatter */
function processPage(page: NavPage, suffix: string = LLM_MD_SUFFIX): TocEntry {
  const frontmatter = getFrontmatter(page.slug);
  return {
    title: page.title || frontmatter?.title || page.slug,
    description: page.description || frontmatter?.description,
    url: `/${page.slug}${suffix}`,
  };
}

/** Recursively walk nav tree, skipping draft/beta pages */
function processNavItems(
  items: NavItem[],
  suffix: string = LLM_MD_SUFFIX,
): TocEntry[] {
  const entries: TocEntry[] = [];

  for (const item of items) {
    if (item.type === "page") {
      // Skip draft/beta pages (behind feature flags) and external pages (no local content)
      if (item.status === "draft" || item.status === "beta" || item.external) {
        continue;
      }
      entries.push(processPage(item, suffix));
      if (item.children) {
        entries.push(...processNavItems(item.children, suffix));
      }
    } else if (item.type === "section") {
      entries.push(...processNavItems(item.items, suffix));
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
 * Lists all documentation pages with links to their /llm.md or /llm.txt endpoints
 * Filters out sections/pages behind feature flags
 * @param suffix - URL suffix for links (default: .md)
 */
export function generateLlmToc(suffix: string = LLM_MD_SUFFIX): string {
  const sections: { title: string; entries: TocEntry[] }[] = [];

  for (const config of Object.values(sectionNavigationConfigs)) {
    // Only include whitelisted public sections
    if (!PUBLIC_SECTIONS.has(config.id)) {
      continue;
    }
    const entries = processNavItems(config.nav, suffix);
    if (entries.length > 0) {
      sections.push({ title: config.title, entries });
    }
  }

  const format = suffix === LLM_TXT_SUFFIX ? "plain text" : "markdown";
  const lines: string[] = [
    "# MooseStack Documentation",
    "",
    "This is a table of contents for the MooseStack documentation.",
    `Each link points to the LLM-friendly ${format} version of that page.`,
    "Append `?lang=typescript` or `?lang=python` to any link for language-specific content.",
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
