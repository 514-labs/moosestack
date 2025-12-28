/**
 * Generate Search Index for Pagefind
 *
 * This script extracts searchable content from MDX source files and generates
 * simple HTML files that Pagefind can index. This bypasses the RSC rendering
 * issue where Next.js App Router builds empty HTML shells.
 *
 * Usage: npx tsx scripts/generate-search-index.ts
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const OUTPUT_DIR = path.join(process.cwd(), ".search-index");

interface ContentFile {
  slug: string;
  title: string;
  description: string;
  content: string;
  section: string;
}

/**
 * Recursively get all markdown files in a directory
 */
function getAllMarkdownFiles(dir: string, baseDir: string): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip shared folder
      if (entry.name === "shared") continue;
      files.push(...getAllMarkdownFiles(fullPath, baseDir));
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

/**
 * Strip MDX/JSX components and imports from content, keeping readable text
 */
function stripMdxComponents(content: string): string {
  let result = content;

  // Remove import statements (including multiline imports)
  result = result.replace(/^import\s+[\s\S]*?from\s+['"].*?['"];?\s*$/gm, "");

  // Remove export statements (but keep exported content)
  result = result.replace(/^export\s+default\s+/gm, "");
  result = result.replace(/^export\s+/gm, "");

  // Handle self-closing JSX tags (e.g., <Component />)
  result = result.replace(
    /<[A-Z][a-zA-Z]*(?:\.[A-Z][a-zA-Z]*)*\s*[^>]*\/>/g,
    "",
  );

  // Handle JSX components with children - extract inner content
  // This regex matches opening tags, captures content, and matches closing tags
  // We need to do this iteratively for nested components
  let previousResult = "";
  while (previousResult !== result) {
    previousResult = result;

    // Match component tags and extract their children
    // Handles: <ComponentName attr="value">content</ComponentName>
    result = result.replace(
      /<([A-Z][a-zA-Z]*(?:\.[A-Z][a-zA-Z]*)*)[^>]*>([\s\S]*?)<\/\1>/g,
      (_, _tagName, innerContent) => {
        return innerContent;
      },
    );
  }

  // Remove any remaining JSX-style attributes in curly braces
  // (but be careful not to remove code block content)
  result = result.replace(/\s+[a-zA-Z]+={[^}]+}/g, " ");

  // Clean up extra whitespace
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.trim();

  return result;
}

/**
 * Extract plain text from markdown content for search indexing
 */
function extractSearchableContent(rawContent: string): string {
  let content = stripMdxComponents(rawContent);

  // Keep code blocks but mark them (Pagefind can index code)
  // Convert fenced code blocks to simple text representation
  // Allow any attributes (filename, copy, etc.) before the newline
  content = content.replace(
    /```(\w+)?(?:[^\n]*)\n([\s\S]*?)```/g,
    (_, _lang, code) => {
      return `\n${code.trim()}\n`;
    },
  );

  // Keep inline code
  content = content.replace(/`([^`]+)`/g, "$1");

  // Convert markdown links to just text
  content = content.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Convert markdown images to alt text
  content = content.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");

  // Remove HTML comments (iteratively to handle overlapping/malformed cases)
  let previousContent: string;
  do {
    previousContent = content;
    content = content.replace(/<!--[\s\S]*?-->/g, "");
  } while (content !== previousContent);

  // Clean up multiple blank lines
  content = content.replace(/\n{3,}/g, "\n\n");

  return content.trim();
}

/**
 * Convert markdown headings to HTML
 */
function markdownToSimpleHtml(content: string): string {
  let html = content;

  // Convert headings
  html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // Convert bold and italic
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Convert bullet lists (simple)
  html = html.replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>");

  // Convert numbered lists (simple)
  html = html.replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>");

  // Wrap paragraphs (lines that aren't already HTML)
  const lines = html.split("\n");
  const wrappedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("<") && !trimmed.endsWith(">")) {
      return `<p>${trimmed}</p>`;
    }
    return line;
  });

  return wrappedLines.join("\n");
}

/**
 * Generate HTML file for Pagefind to index
 */
function generateHtmlForSearch(file: ContentFile): string {
  const htmlContent = markdownToSimpleHtml(file.content);

  // Determine the section for filtering
  const sectionLabel = getSectionLabel(file.section);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(file.title)}</title>
  <meta name="description" content="${escapeHtml(file.description)}">
</head>
<body>
  <article data-pagefind-body>
    <h1>${escapeHtml(file.title)}</h1>
    ${file.description ? `<p class="description">${escapeHtml(file.description)}</p>` : ""}
    <div data-pagefind-meta="section:${escapeHtml(sectionLabel)}">
      ${htmlContent}
    </div>
  </article>
  <script data-pagefind-meta="url:/${file.slug}"></script>
</body>
</html>`;
}

/**
 * Get human-readable section label
 */
function getSectionLabel(section: string): string {
  const labels: Record<string, string> = {
    moosestack: "MooseStack",
    ai: "AI / Sloan",
    hosting: "Hosting",
    guides: "Guides",
    templates: "Templates",
  };
  return labels[section] || section;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Process a single markdown file
 */
function processFile(filePath: string): ContentFile | null {
  const fullPath = path.join(CONTENT_ROOT, filePath);
  const fileContents = fs.readFileSync(fullPath, "utf8");

  let data: Record<string, unknown>;
  let content: string;

  try {
    const parsed = matter(fileContents);
    data = parsed.data;
    content = parsed.content;
  } catch (error) {
    // Handle YAML parsing errors (e.g., unquoted colons in values)
    console.warn(`  ⚠ YAML error in ${filePath}, attempting fallback parse`);

    // Fallback: Extract frontmatter manually
    const frontmatterMatch = fileContents.match(
      /^---\n([\s\S]*?)\n---\n([\s\S]*)$/,
    );
    if (frontmatterMatch) {
      content = frontmatterMatch[2] || "";
      // Try to extract title from frontmatter manually
      const titleMatch = frontmatterMatch[1]?.match(/^title:\s*(.+)$/m);
      const descMatch = frontmatterMatch[1]?.match(/^description:\s*(.+)$/m);
      data = {
        title: titleMatch?.[1]?.replace(/^["']|["']$/g, "") || "",
        description: descMatch?.[1]?.replace(/^["']|["']$/g, "") || "",
      };
    } else {
      console.warn(`  ✗ Skipping ${filePath} (cannot parse)`);
      return null;
    }
  }

  // Convert file path to slug
  let slug = filePath.replace(/\.(md|mdx)$/, "");

  // Handle index files
  if (slug.endsWith("/index")) {
    slug = slug.replace(/\/index$/, "");
  }

  // Get section from first part of path
  const section = slug.split("/")[0] || "docs";

  // Extract title and description from frontmatter
  const title = (data.title as string) || slug.split("/").pop() || "Untitled";
  const description = (data.description as string) || "";

  // Extract searchable content
  const searchableContent = extractSearchableContent(content);

  // Skip files with no meaningful content
  if (!searchableContent || searchableContent.length < 50) {
    console.log(`  Skipping ${filePath} (too short or empty)`);
    return null;
  }

  return {
    slug,
    title,
    description,
    content: searchableContent,
    section,
  };
}

/**
 * Main function to generate search index
 */
async function main() {
  console.log("🔍 Generating search index from MDX source files...\n");

  // Clean output directory
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Get all markdown files
  const files = getAllMarkdownFiles(CONTENT_ROOT, CONTENT_ROOT);
  console.log(`Found ${files.length} content files\n`);

  let processedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const contentFile = processFile(file);

    if (contentFile) {
      // Create directory structure
      const outputPath = path.join(OUTPUT_DIR, `${contentFile.slug}.html`);
      const outputDir = path.dirname(outputPath);

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Write HTML file
      const html = generateHtmlForSearch(contentFile);
      fs.writeFileSync(outputPath, html);

      console.log(`  ✓ ${contentFile.slug}`);
      processedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log(`\n✅ Generated ${processedCount} search pages`);
  if (skippedCount > 0) {
    console.log(`   Skipped ${skippedCount} files (empty or too short)`);
  }
  console.log(`   Output directory: ${OUTPUT_DIR}`);
}

main().catch(console.error);
