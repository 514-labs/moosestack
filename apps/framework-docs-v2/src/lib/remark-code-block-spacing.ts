/**
 * Preprocesses markdown content to ensure proper spacing around code blocks
 * This prevents MDX from wrapping code blocks in paragraph tags, which causes
 * hydration errors due to invalid HTML nesting (<p> cannot contain <pre>)
 *
 * @param content - Raw markdown/MDX content
 * @returns Processed content with proper spacing
 */
export function ensureCodeBlockSpacing(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : "";
    const nextLine = i < lines.length - 1 ? lines[i + 1] : "";

    // If current line starts a code block and previous line has content (not blank)
    if (line.trim().startsWith("```") && prevLine.trim() !== "") {
      // Add blank line before code block
      result.push("");
    }

    result.push(line);

    // If current line ends a code block and next line has content (not blank)
    if (
      line.trim() === "```" &&
      nextLine.trim() !== "" &&
      !nextLine.trim().startsWith("#")
    ) {
      // Add blank line after code block
      result.push("");
    }
  }

  return result.join("\n");
}
