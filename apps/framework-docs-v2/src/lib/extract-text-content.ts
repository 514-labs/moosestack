import React from "react";
import { convert } from "html-to-text";

/**
 * Extracts plain text content from React children, handling rehype-pretty-code's HTML structure.
 * This function recursively extracts all text content, handling fragments, arrays, and nested elements.
 * Uses React.Children utilities to ensure all children are processed.
 *
 * Note: This is for extracting plain text from HTML (not for security sanitization).
 * The HTML comes from rehype-pretty-code (trusted source), and we need plain text
 * to pass to shiki for syntax highlighting.
 */
export function extractTextContent(children: React.ReactNode): string {
  if (children == null) {
    return "";
  }

  if (typeof children === "string") {
    return children;
  }

  if (typeof children === "number" || typeof children === "boolean") {
    return String(children);
  }

  // Use React.Children utilities to handle all cases, including arrays and fragments
  const parts: string[] = [];

  React.Children.forEach(children, (child) => {
    if (child == null) {
      return;
    }

    if (typeof child === "string") {
      parts.push(child);
      return;
    }

    if (typeof child === "number" || typeof child === "boolean") {
      parts.push(String(child));
      return;
    }

    if (React.isValidElement(child)) {
      const props = child.props as any;
      const childType = child.type;

      // Handle React fragments
      if (childType === React.Fragment) {
        parts.push(extractTextContent(props.children));
        return;
      }

      // Handle rehype-pretty-code's span.line structure
      // Important: Add newline after the line content to preserve line breaks
      if (childType === "span" && props.className?.includes("line")) {
        const lineContent = extractTextContent(props.children);
        parts.push(lineContent + "\n");
        return;
      }

      // Check if it's dangerouslySetInnerHTML (from rehype-pretty-code)
      if (props.dangerouslySetInnerHTML?.__html) {
        // Extract plain text from HTML using html-to-text library
        // This handles all HTML entities, edge cases, and preserves formatting better than regex
        const html = props.dangerouslySetInnerHTML.__html;
        const textContent = convert(html, {
          preserveNewlines: true,
          wordwrap: false,
          selectors: [
            // Preserve line breaks from code structure
            { selector: "span.line", format: "inline" },
          ],
        });
        parts.push(textContent);
        return;
      }

      // For other elements (including other span types, divs, etc.),
      // recursively extract from their children
      // This ensures we don't miss any nested content
      parts.push(extractTextContent(props.children));
      return;
    }

    // Fallback for anything else
    parts.push(String(child));
  });

  return parts.join("");
}
