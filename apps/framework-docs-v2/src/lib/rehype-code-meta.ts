import { visit } from "unist-util-visit";

/**
 * Rehype plugin that extracts code block meta attributes and sets them as
 * data-* attributes on the pre element.
 *
 * Supports Nextra-style syntax:
 * - key="value" or key='value' (quoted values)
 * - key=value (unquoted values)
 * - key (flag-style, sets data-key="true")
 * - {1,4-5} (line highlighting)
 * - /substring/ (substring highlighting)
 * - /substring/1 or /substring/1-3 or /substring/1,3 (occurrence filtering)
 *
 * Examples:
 * ```ts filename="example.ts" copy
 * ```js {1,4-5}
 * ```js /useState/
 * ```js /useState/1-3 showLineNumbers
 * ```python animate
 */

interface HastElement {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  data?: Record<string, unknown>;
}

interface HastText {
  type: "text";
  value: string;
}

type HastNode = HastElement | HastText | { type: string };

interface HastRoot {
  type: "root";
  children: HastNode[];
}

export function rehypeCodeMeta() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: HastElement) => {
      // Only process pre elements with code children
      if (node.tagName !== "pre" || !node.children) {
        return;
      }

      for (const child of node.children) {
        if (
          child.type === "element" &&
          (child as HastElement).tagName === "code" &&
          (child as HastElement).data?.meta
        ) {
          const meta = (child as HastElement).data?.meta as string;
          const parsed = parseMetaString(meta);

          // Ensure properties object exists
          if (!node.properties) {
            node.properties = {};
          }

          // Set each parsed attribute as a data-* attribute
          for (const [key, value] of Object.entries(parsed.attributes)) {
            // Use lowercase keys with data- prefix
            const dataKey = `data-${key.toLowerCase()}`;
            node.properties[dataKey] = value;
          }

          // Set line highlighting if present
          if (parsed.highlightLines) {
            node.properties["data-highlight-lines"] = parsed.highlightLines;
          }

          // Set substring highlighting if present
          if (parsed.highlightStrings.length > 0) {
            node.properties["data-highlight-strings"] = JSON.stringify(
              parsed.highlightStrings,
            );
          }

          // Only process the first code child
          break;
        }
      }
    });
  };
}

/**
 * Parsed substring highlight with optional occurrence filter
 */
interface SubstringHighlight {
  pattern: string;
  occurrences?: number[]; // undefined = all occurrences
}

/**
 * Result of parsing the meta string
 */
interface ParsedMeta {
  attributes: Record<string, string>;
  highlightLines: string | null; // e.g., "1,4-5"
  highlightStrings: SubstringHighlight[];
}

/**
 * Parses a code block meta string into key-value pairs, line highlights,
 * and substring highlights.
 *
 * Handles:
 * - key="value" or key='value'
 * - key=value (no quotes)
 * - key (flag, becomes "true")
 * - {1,4-5} (line highlighting)
 * - /substring/ (substring highlighting)
 * - /substring/1 or /substring/1-3 or /substring/1,3 (occurrence filtering)
 */
function parseMetaString(meta: string): ParsedMeta {
  const result: ParsedMeta = {
    attributes: {},
    highlightLines: null,
    highlightStrings: [],
  };

  if (!meta || typeof meta !== "string") {
    return result;
  }

  let processed = meta;

  // 1. Extract line highlighting: {1,4-5}
  const lineHighlightMatch = processed.match(/\{([^}]+)\}/);
  if (lineHighlightMatch?.[1]) {
    result.highlightLines = lineHighlightMatch[1];
    processed = processed.replace(lineHighlightMatch[0], " ");
  }

  // 2. Extract substring highlighting: /pattern/ or /pattern/occurrences
  // Pattern: /[^/]+/(?:\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)?
  const substringPattern = /\/([^/]+)\/(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)?/g;
  let substringMatch = substringPattern.exec(processed);
  while (substringMatch !== null) {
    const pattern = substringMatch[1];
    const occurrenceSpec = substringMatch[2];

    if (pattern) {
      const highlight: SubstringHighlight = { pattern };

      if (occurrenceSpec) {
        highlight.occurrences = parseOccurrenceSpec(occurrenceSpec);
      }

      result.highlightStrings.push(highlight);
    }
    substringMatch = substringPattern.exec(processed);
  }

  // Remove substring patterns from processed string for attribute parsing
  processed = processed.replace(substringPattern, " ");

  // 3. Extract quoted values: key="value" or key='value'
  const quotedPattern = /(\w+)=["']([^"']*)["']/g;
  for (const match of meta.matchAll(quotedPattern)) {
    const key = match[1];
    const value = match[2];
    if (key) {
      result.attributes[key] = value ?? "";
      processed = processed.replace(match[0], " ".repeat(match[0].length));
    }
  }

  // 4. Extract unquoted values: key=value
  const unquotedPattern = /(\w+)=([^\s"'{}\/]+)/g;
  for (const match of processed.matchAll(unquotedPattern)) {
    const key = match[1];
    const value = match[2];
    if (key && !result.attributes[key]) {
      result.attributes[key] = value ?? "";
    }
  }

  // 5. Extract flags (standalone words)
  // Reset processed to only include non-key=value parts
  const remainingParts = processed
    .replace(/\w+=\S+/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\/[^/]+\/\S*/g, " ");
  const flagPattern = /(?:^|\s)(\w+)(?=\s|$)/g;
  for (const match of remainingParts.matchAll(flagPattern)) {
    const key = match[1];
    if (key && !result.attributes[key]) {
      result.attributes[key] = "true";
    }
  }

  return result;
}

/**
 * Parse occurrence specification like "1", "1-3", "1,3", "1-3,5"
 * Returns array of 1-indexed occurrence numbers
 */
function parseOccurrenceSpec(spec: string): number[] {
  const occurrences: number[] = [];
  const parts = spec.split(",");

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes("-")) {
      // Range: "1-3"
      const [start, end] = trimmed.split("-").map((n) => parseInt(n, 10));
      if (
        start !== undefined &&
        end !== undefined &&
        !Number.isNaN(start) &&
        !Number.isNaN(end)
      ) {
        for (let i = start; i <= end; i++) {
          occurrences.push(i);
        }
      }
    } else {
      // Single number: "1"
      const num = parseInt(trimmed, 10);
      if (!Number.isNaN(num)) {
        occurrences.push(num);
      }
    }
  }

  return occurrences;
}

export default rehypeCodeMeta;
