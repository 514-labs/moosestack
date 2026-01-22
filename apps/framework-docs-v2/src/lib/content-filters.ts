/**
 * Content filtering utilities
 * Safe for both client and server use (no Node.js APIs)
 */

import type { Language } from "./content-types";

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
