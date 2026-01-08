import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { Language } from "./content-types";

const CONTENT_ROOT = path.join(process.cwd(), "content");

interface LLMSection {
  title: string;
  source: string;
  description?: string;
  content: string;
}

/**
 * Generate llms.txt content for a specific language
 */
export function generateLLMsTxt(language: Language): string {
  const sections: LLMSection[] = [];
  const contentDir = path.join(CONTENT_ROOT, language);

  if (!fs.existsSync(contentDir)) {
    return `# ${language.charAt(0).toUpperCase() + language.slice(1)} Documentation\n\nNo content available.`;
  }

  // Recursively collect all markdown files
  const files = collectMarkdownFiles(contentDir, contentDir);
  files.sort();

  for (const file of files) {
    const fullPath = path.join(contentDir, file);
    const fileContents = fs.readFileSync(fullPath, "utf8");
    const { data, content: rawContent } = matter(fileContents);

    // Clean content for LLM consumption
    const cleaned = cleanContent(rawContent);

    if (cleaned.trim()) {
      sections.push({
        title: data.title || file.replace(/\.(md|mdx)$/, ""),
        source: file,
        description: data.description,
        content: cleaned,
      });
    }
  }

  // Build the llms.txt output
  const heading = `# MooseStack ${language === "typescript" ? "TypeScript" : "Python"} Documentation`;
  const toc = buildTableOfContents(sections);
  const body = sections
    .map((section) => {
      const parts = [`## ${section.title}`, `Source: ${section.source}`];
      if (section.description) {
        parts.push(section.description);
      }
      parts.push(section.content);
      return parts.join("\n\n");
    })
    .join("\n\n---\n\n");

  return [heading, toc, body].join("\n\n");
}

/**
 * Collect all markdown files recursively
 */
function collectMarkdownFiles(dir: string, baseDir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith("_")) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath, baseDir));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".md") || entry.name.endsWith(".mdx"))
    ) {
      const relativePath = path.relative(baseDir, fullPath);
      files.push(relativePath);
    }
  }

  return files;
}

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

function buildLanguageTabRegex(language: string) {
  return new RegExp(
    `<LanguageTabContent\\s+value="${language}"[^>]*>([\\s\\S]*?)</LanguageTabContent>`,
    "gi",
  );
}

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
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Build table of contents
 */
function buildTableOfContents(sections: LLMSection[]): string {
  const items = sections.map(
    (section, index) => `${index + 1}. ${section.source}`,
  );
  return ["## Included Files", ...items].join("\n");
}
