import { visit } from "unist-util-visit";

/**
 * Generic rehype plugin that extracts all code block meta attributes
 * and sets them as data-* attributes on the pre element.
 *
 * Supports:
 * - key="value" or key='value' (quoted values)
 * - key=value (unquoted values)
 * - key (flag-style, sets data-key="true")
 *
 * Examples:
 * ```ts filename="example.ts" copy
 * ```bash variant="terminal" duration=3 delay=0.5
 * ```python copy=false lineNumbers
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
          const attributes = parseMetaString(meta);

          // Ensure properties object exists
          if (!node.properties) {
            node.properties = {};
          }

          // Set each parsed attribute as a data-* attribute
          for (const [key, value] of Object.entries(attributes)) {
            // Use lowercase keys with data- prefix
            const dataKey = `data-${key.toLowerCase()}`;
            node.properties[dataKey] = value;
          }

          // Only process the first code child
          break;
        }
      }
    });
  };
}

/**
 * Parses a code block meta string into key-value pairs
 *
 * Handles:
 * - key="value" or key='value'
 * - key=value (no quotes)
 * - key (flag, becomes "true")
 */
function parseMetaString(meta: string): Record<string, string> {
  const attributes: Record<string, string> = {};

  if (!meta || typeof meta !== "string") {
    return attributes;
  }

  // Regex patterns for different attribute formats
  // Pattern 1: key="value" or key='value' (quoted)
  const quotedPattern = /(\w+)=["']([^"']*)["']/g;
  // Pattern 2: key=value (unquoted, stops at whitespace)
  const unquotedPattern = /(\w+)=([^\s"']+)/g;
  // Pattern 3: standalone key (flag-style)
  const flagPattern = /(?:^|\s)(\w+)(?=\s|$)/g;

  // Track which parts of the string we've processed
  let processed = meta;

  // First, extract quoted values
  let match: RegExpExecArray | null = quotedPattern.exec(meta);
  while (match !== null) {
    const key = match[1];
    const value = match[2];
    if (key) {
      attributes[key] = value ?? "";
      // Mark as processed by replacing with spaces
      processed = processed.replace(match[0], " ".repeat(match[0].length));
    }
    match = quotedPattern.exec(meta);
  }

  // Then, extract unquoted values from remaining string
  match = unquotedPattern.exec(processed);
  while (match !== null) {
    const key = match[1];
    const value = match[2];
    if (key && !attributes[key]) {
      attributes[key] = value ?? "";
    }
    match = unquotedPattern.exec(processed);
  }

  // Finally, extract flags from remaining string
  // Reset processed to only include non-key=value parts
  const remainingParts = processed.split(/\w+=\S+/).join(" ");
  match = flagPattern.exec(remainingParts);
  while (match !== null) {
    const key = match[1];
    // Only add if not already set
    if (key && !attributes[key]) {
      attributes[key] = "true";
    }
    match = flagPattern.exec(remainingParts);
  }

  return attributes;
}

export default rehypeCodeMeta;
