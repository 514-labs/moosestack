import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";

/**
 * Simple parser for code block meta strings
 * Extracts key-value pairs like: key="value", key='value', key=value, or key (flag)
 */
function parseMetaString(meta: string): Record<string, string> {
  const attributes: Record<string, string> = {};

  if (!meta || typeof meta !== "string") {
    return attributes;
  }

  // Extract quoted values: key="value" or key='value'
  const quotedPattern = /(\w+)=(["'])(.*?)\2/g;
  for (const match of meta.matchAll(quotedPattern)) {
    const key = match[1];
    const value = match[3];
    if (key) {
      attributes[key] = value ?? "";
    }
  }

  // Extract unquoted values: key=value
  const unquotedPattern = /(\w+)=([^\s"'{}\/]+)/g;
  for (const match of meta.matchAll(unquotedPattern)) {
    const key = match[1];
    const value = match[2];
    if (key && !attributes[key]) {
      attributes[key] = value ?? "";
    }
  }

  return attributes;
}

/**
 * Rehype plugin that restores custom code block meta attributes after rehype-pretty-code
 * processing. This runs after rehype-pretty-code to transfer attributes from the code
 * element back to the pre element.
 */
export function rehypeRestoreCodeMeta() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      // Only process pre elements with code children
      if (node.tagName !== "pre" || !node.children) {
        return;
      }

      // Ensure properties object exists
      if (!node.properties) {
        node.properties = {};
      }

      // First, restore any custom attributes from node.data
      if (node.data) {
        for (const [key, value] of Object.entries(node.data)) {
          if (key.startsWith("data-")) {
            node.properties[key] = value;
          }
        }
      }

      // Then try to get any remaining attributes from code element
      for (const child of node.children) {
        if (child.type === "element" && child.tagName === "code") {
          const codeElement = child;

          // Check if meta string is still available in code element data
          if (codeElement.data?.meta) {
            const metaString = codeElement.data.meta as string;

            // Re-parse the meta string to extract custom attributes
            const parsed = parseMetaString(metaString);

            // Set each parsed attribute as a data-* attribute on the pre element
            for (const [key, value] of Object.entries(parsed)) {
              const dataKey = `data-${key.toLowerCase()}`;
              node.properties[dataKey] = value;
            }
          }

          // Transfer any data-* attributes from code element to pre element
          // Skip data-language and data-theme as they're handled by rehype-pretty-code
          if (codeElement.properties) {
            for (const [key, value] of Object.entries(codeElement.properties)) {
              if (
                key.startsWith("data-") &&
                key !== "data-language" &&
                key !== "data-theme" &&
                !node.properties[key] // Don't overwrite what we got from node.data
              ) {
                node.properties[key] = value;
              }
            }
          }

          // Only process the first code child
          break;
        }
      }
    });
  };
}

export default rehypeRestoreCodeMeta;
