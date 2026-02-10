/**
 * Shared utilities for processing MDX include directives
 * Syntax: :::include /shared/path/to/file.mdx
 */

import fs from "fs";
import path from "path";

export const CONTENT_ROOT = path.join(process.cwd(), "content");
// Allow optional leading spaces so include directives work inside JSX blocks.
export const INCLUDE_REGEX = /^ *:::include +(\S+)\s*$/gm;
export const MAX_INCLUDE_DEPTH = 3;

export interface ProcessIncludesOptions {
  /** Maximum nesting depth for includes (default: 3) */
  maxDepth?: number;
  /** Current depth (internal use) */
  depth?: number;
  /** Stack to track circular dependencies (internal use) */
  includeStack?: Set<string>;
  /** Whether to show error messages in output (default: true) */
  showErrors?: boolean;
}

/**
 * Process include directives in content
 *
 * @param content - The content to process
 * @param options - Processing options
 * @returns Processed content with includes resolved
 *
 * @example
 * ```typescript
 * const content = ":::include shared/prerequisites/install-moose.mdx";
 * const processed = processIncludes(content);
 * ```
 */
export function processIncludes(
  content: string,
  options: ProcessIncludesOptions = {},
): string {
  const {
    maxDepth = MAX_INCLUDE_DEPTH,
    depth = 0,
    includeStack = new Set<string>(),
    showErrors = true,
  } = options;

  if (depth >= maxDepth) {
    if (showErrors) {
      console.warn(`[processIncludes] Max include depth (${maxDepth}) reached`);
    }
    return content;
  }

  let result = content;

  // Find all matches first (before modifying the string)
  const matches = [...content.matchAll(INCLUDE_REGEX)];

  for (const match of matches) {
    if (!match[1]) continue;
    const includePath = match[1].trim();
    // Remove leading slash to ensure relative path resolution
    // path.join('/base', '/other') returns '/other', ignoring the base
    const relativePath =
      includePath.startsWith("/") ? includePath.slice(1) : includePath;
    const fullPath = path.join(CONTENT_ROOT, relativePath);

    try {
      // Check for circular dependencies
      if (includeStack.has(fullPath)) {
        if (showErrors) {
          console.warn(
            `[processIncludes] Circular dependency detected: ${includePath}`,
          );
          result = result.replace(
            match[0],
            () =>
              `\n> ⚠️ Error: Circular dependency detected for ${includePath}\n`,
          );
        } else {
          result = result.replace(match[0], () => "");
        }
        continue;
      }

      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        if (showErrors) {
          console.warn(`[processIncludes] File not found: ${fullPath}`);
          result = result.replace(
            match[0],
            () => `\n> ⚠️ Error: File not found: ${includePath}\n`,
          );
        } else {
          result = result.replace(match[0], () => "");
        }
        continue;
      }

      // Read and process the file
      let includeContent = fs.readFileSync(fullPath, "utf8");

      // Strip frontmatter if present
      const frontmatterRegex = /^---\n[\s\S]*?\n---\n/;
      includeContent = includeContent.replace(frontmatterRegex, "");

      // Add to stack and recursively process includes
      includeStack.add(fullPath);
      includeContent = processIncludes(includeContent, {
        maxDepth,
        depth: depth + 1,
        includeStack,
        showErrors,
      });
      includeStack.delete(fullPath);

      // Replace the include directive with the content
      // Use replacer function to prevent $& $` $' $$ interpretation
      result = result.replace(match[0], () => includeContent);
    } catch (error) {
      if (showErrors) {
        console.error(
          `[processIncludes] Error including ${includePath}:`,
          error,
        );
        result = result.replace(
          match[0],
          () => `\n> ⚠️ Error: Failed to include ${includePath}\n`,
        );
      } else {
        result = result.replace(match[0], () => "");
      }
    }
  }

  return result;
}
