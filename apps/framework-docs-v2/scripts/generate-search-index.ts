/**
 * Generate Search Index for Pagefind
 *
 * Extracts searchable content from MDX files and generates HTML for Pagefind indexing.
 * Necessary because Next.js App Router with RSC generates HTML shells, not searchable content.
 */

import fs from "fs";
import path from "path";
import { getAllSlugs, parseMarkdownContent } from "../src/lib/content.js";

const OUTPUT_DIR = path.join(process.cwd(), ".search-index");

/** Strip MDX/JSX syntax while preserving readable content */
function cleanContent(content: string): string {
  return (
    content
      // Remove imports and exports
      .replace(/^import\s+[\s\S]*?from\s+['"].*?['"];?\s*$/gm, "")
      .replace(/^export\s+(default\s+)?/gm, "")
      // Remove JSX components (self-closing and paired tags)
      .replace(/<[A-Z][a-zA-Z]*(?:\.[A-Z][a-zA-Z]*)*\s*[^>]*\/>/g, "")
      .replace(
        /<([A-Z][a-zA-Z]*(?:\.[A-Z][a-zA-Z]*)*)[^>]*>([\s\S]*?)<\/\1>/g,
        "$2",
      )
      // Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, "")
      // Clean code blocks (keep content, remove fence markers)
      .replace(
        /```(\w+)?(?:[^\n]*)\n([\s\S]*?)```/g,
        (_, _lang, code) => `\n${code.trim()}\n`,
      )
      // Clean inline code
      .replace(/`([^`]+)`/g, "$1")
      // Convert markdown links/images to text
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Clean up whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Convert markdown to simple HTML */
function toSimpleHtml(content: string): string {
  return (
    content
      // Headings
      .replace(/^######\s+(.+)$/gm, "<h6>$1</h6>")
      .replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>")
      .replace(/^####\s+(.+)$/gm, "<h4>$1</h4>")
      .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
      .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
      .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")
      // Bold and italic
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      // Lists
      .replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>")
      .replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>")
      // Wrap non-HTML lines in paragraphs
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith("<") && !trimmed.endsWith(">") ?
            `<p>${trimmed}</p>`
          : line;
      })
      .join("\n")
  );
}

/** Generate HTML file for Pagefind */
function generateHtml(
  slug: string,
  title: string,
  description: string,
  content: string,
): string {
  const section = slug.split("/")[0] || "docs";
  const sectionLabels: Record<string, string> = {
    moosestack: "MooseStack",
    ai: "AI / Sloan",
    hosting: "Hosting",
    guides: "Guides",
    templates: "Templates",
  };

  const escape = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const htmlContent = toSimpleHtml(content);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escape(title)}</title>
  <meta name="description" content="${escape(description)}">
</head>
<body>
  <article data-pagefind-body>
    <h1>${escape(title)}</h1>
    ${description ? `<p class="description">${escape(description)}</p>` : ""}
    <div data-pagefind-meta="section:${escape(sectionLabels[section] || section)}">
      ${htmlContent}
    </div>
  </article>
  <script data-pagefind-meta="url:/${slug}"></script>
</body>
</html>`;
}

/** Main execution */
async function main() {
  console.log("🔍 Generating search index from MDX source files...\n");

  // Clean and create output directory
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Get all content slugs
  const slugs = getAllSlugs();
  console.log(`Found ${slugs.length} content files\n`);

  let processedCount = 0;
  let skippedCount = 0;

  for (const slug of slugs) {
    try {
      // Use existing content parser
      const parsed = await parseMarkdownContent(slug);

      // Extract searchable text
      const searchableContent = cleanContent(parsed.content);

      // Skip files with minimal content
      if (!searchableContent || searchableContent.length < 50) {
        console.log(`  Skipping ${slug} (too short or empty)`);
        skippedCount++;
        continue;
      }

      // Generate HTML file
      const outputPath = path.join(OUTPUT_DIR, `${slug}.html`);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      const html = generateHtml(
        slug,
        parsed.frontMatter.title || slug.split("/").pop() || "Untitled",
        parsed.frontMatter.description || "",
        searchableContent,
      );

      fs.writeFileSync(outputPath, html);
      console.log(`  ✓ ${slug}`);
      processedCount++;
    } catch (error) {
      console.warn(
        `  ✗ Error processing ${slug}:`,
        error instanceof Error ? error.message : error,
      );
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
