/**
 * Preprocessor for CopilotCallout MDX components.
 *
 * Finds <CopilotCallout ... contentFile="PATH" ...> opening tags,
 * reads the referenced file from disk, and injects a rawContent prop
 * containing the JSON-escaped file content. The rawContent is used by
 * the client component's "Copy as prompt" button.
 *
 * Does NOT expand children — the callout body is authored in the MDX.
 * Content rendering is handled separately via :::include directives.
 *
 * Runs as a string transformation before MDX compilation, alongside processIncludes.
 */

import fs from "fs";
import path from "path";
import { CONTENT_ROOT } from "./includes";

/**
 * Regex to match CopilotCallout opening tags (not self-closing).
 *
 * Captures:
 *   - Group 0: the entire opening tag (e.g. `<CopilotCallout ... >`)
 *   - Group 1: all props inside the tag
 *
 * We then extract contentFile from the props string separately.
 */
const COPILOT_CALLOUT_REGEX = /<CopilotCallout\s+([\s\S]*?)(?<!\/)>/g;

const CONTENT_FILE_REGEX = /contentFile="([^"]+)"/;

/** Frontmatter pattern (same as processIncludes) */
const FRONTMATTER_REGEX = /^---\n[\s\S]*?\n---\n/;

export function processCopilotPrompts(content: string): string {
  let result = content;

  const matches = [...content.matchAll(COPILOT_CALLOUT_REGEX)];

  for (const match of matches) {
    const fullTag = match[0];
    const propsString = match[1] as string;

    // Extract contentFile prop
    const contentFileMatch = propsString.match(CONTENT_FILE_REGEX);
    if (!contentFileMatch) {
      // No contentFile prop — leave the tag as-is
      continue;
    }

    const contentFilePath = contentFileMatch[1] as string;
    const relativePath =
      contentFilePath.startsWith("/") ?
        contentFilePath.slice(1)
      : contentFilePath;
    const fullPath = path.join(CONTENT_ROOT, relativePath);

    try {
      if (!fs.existsSync(fullPath)) {
        console.warn(
          `[processCopilotPrompts] File not found: ${contentFilePath}`,
        );
        continue;
      }

      let fileContent = fs.readFileSync(fullPath, "utf8");

      // Strip frontmatter if present
      fileContent = fileContent.replace(FRONTMATTER_REGEX, "");

      // Build the rawContent prop value as a JSON-escaped JS string literal
      const rawContentProp = `rawContent={${JSON.stringify(fileContent.trim())}}`;

      // Rebuild the opening tag with rawContent injected
      const newTag = `<CopilotCallout ${rawContentProp} ${propsString.trim()}>`;

      // Use replacer function to prevent $& $` $' $$ interpretation
      result = result.replace(fullTag, () => newTag);
    } catch (error) {
      console.error(
        `[processCopilotPrompts] Error processing ${contentFilePath}:`,
        error,
      );
    }
  }

  return result;
}
