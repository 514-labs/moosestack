import fs from "fs";
import GithubSlugger from "github-slugger";
import matter from "gray-matter";
import { compileMDX } from "next-mdx-remote/rsc";
import path from "path";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";
import type {
  FrontMatter,
  Heading,
  Language,
  NavItem,
  ParsedContent,
} from "@/lib/content-types";

import { CONTENT_ROOT, processIncludes } from "./includes";

/**
 * Get all content files from the content directory
 * Scans recursively and returns all .md and .mdx files
 */
export function getContentFiles(): string[] {
  if (!fs.existsSync(CONTENT_ROOT)) {
    return [];
  }
  return getAllMarkdownFiles(CONTENT_ROOT, CONTENT_ROOT);
}

/**
 * Recursively get all markdown files in a directory
 * Excludes the 'shared' folder and 'templates' folder
 * (templates is now an explicit page in the app directory)
 */
function getAllMarkdownFiles(dir: string, baseDir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    // Skip the shared folder and templates folder
    // (templates is now an explicit page in app directory)
    if (entry.isDirectory()) {
      if (entry.name === "shared" || entry.name === "templates") {
        continue;
      }
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
 * Parse markdown content and extract metadata
 */
export async function parseMarkdownContent(
  slug: string,
): Promise<ParsedContent> {
  // Handle empty slug - map to index
  const normalizedSlug = slug === "" ? "index" : slug;

  // Try direct file path first
  const filePath = path.join(CONTENT_ROOT, `${normalizedSlug}.md`);
  const mdxFilePath = path.join(CONTENT_ROOT, `${normalizedSlug}.mdx`);

  // Also try index file in directory (e.g., moosestack -> moosestack/index.mdx)
  const indexFilePath = path.join(CONTENT_ROOT, normalizedSlug, "index.md");
  const indexMdxFilePath = path.join(CONTENT_ROOT, normalizedSlug, "index.mdx");

  let fullPath: string;
  let isMDX = false;

  // Prefer .mdx extension, fallback to .md if needed
  // Try direct file first, then index file
  if (fs.existsSync(mdxFilePath)) {
    fullPath = mdxFilePath;
    isMDX = true;
  } else if (fs.existsSync(filePath)) {
    fullPath = filePath;
  } else if (fs.existsSync(indexMdxFilePath)) {
    fullPath = indexMdxFilePath;
    isMDX = true;
  } else if (fs.existsSync(indexFilePath)) {
    fullPath = indexFilePath;
  } else {
    throw new Error(`Content file not found for slug: ${normalizedSlug}`);
  }

  const fileContents = fs.readFileSync(fullPath, "utf8");
  const { data, content: rawContent } = matter(fileContents);

  // Process include directives for both MD and MDX
  const processedContent = processIncludes(rawContent);

  let content: string;
  const mdxContent: any = null;

  if (isMDX) {
    // For MDX files, we'll return the processed content and let the component handle compilation
    // Extract headings from processed content before MDX processing
    const headings = extractHeadings(processedContent);

    return {
      frontMatter: data as FrontMatter,
      content: processedContent, // Return processed MDX content with includes
      headings,
      slug,
      isMDX: true,
    };
  } else {
    // Parse regular markdown to HTML
    const remarkContent = await remark()
      .use(remarkGfm)
      .use(remarkHtml, { sanitize: false })
      .process(processedContent);

    content = remarkContent.toString();

    // Extract headings for TOC
    const headings = extractHeadings(processedContent);

    return {
      frontMatter: data as FrontMatter,
      content,
      headings,
      slug,
      isMDX: false,
    };
  }
}

/**
 * Extract headings from markdown content
 * Uses github-slugger to generate IDs consistent with rehype-slug
 * Skips headings inside code blocks (``` or ````)
 */
function extractHeadings(content: string): Heading[] {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: Heading[] = [];
  const slugger = new GithubSlugger();

  // First, identify all code block ranges to exclude them
  const codeBlockRanges: Array<{ start: number; end: number }> = [];
  const lines = content.split("\n");
  let inCodeBlock = false;
  let codeBlockStart = -1;
  let codeBlockDelimiter = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Check for code block delimiter (``` or ````)
    const codeBlockMatch = line.match(/^(`{3,})/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      if (!inCodeBlock) {
        // Starting a code block
        inCodeBlock = true;
        codeBlockStart = i;
        codeBlockDelimiter = codeBlockMatch[1];
      } else if (line.startsWith(codeBlockDelimiter)) {
        // Ending a code block (must match the opening delimiter)
        inCodeBlock = false;
        codeBlockRanges.push({ start: codeBlockStart, end: i });
        codeBlockDelimiter = "";
      }
    }
  }

  // Now extract headings, but skip those inside code blocks
  let match: RegExpExecArray | null = headingRegex.exec(content);
  while (match !== null) {
    if (match[1] && match[2]) {
      // Find the line number of this match
      const matchIndex = match.index;
      const lineNumber =
        content.substring(0, matchIndex).split("\n").length - 1;

      // Check if this heading is inside a code block
      const isInCodeBlock = codeBlockRanges.some(
        (range) => lineNumber >= range.start && lineNumber <= range.end,
      );

      if (!isInCodeBlock) {
        // Only add headings that are not inside code blocks
        const level = match[1].length;
        const text = match[2].trim();
        // Use github-slugger to generate IDs the same way rehype-slug does
        const id = slugger.slug(text);

        headings.push({ level, text, id });
      }
    }

    match = headingRegex.exec(content);
  }

  return headings;
}

/**
 * Build navigation tree from content files
 */
export function buildNavigationTree(): NavItem[] {
  const files = getContentFiles();
  const navItems: NavItem[] = [];

  for (const file of files) {
    const fullPath = path.join(CONTENT_ROOT, file);
    const fileContents = fs.readFileSync(fullPath, "utf8");
    const { data } = matter(fileContents);
    const frontMatter = data as FrontMatter;

    // Convert file path to slug
    const slug = file.replace(/\.(md|mdx)$/, "");
    const parts = slug.split(path.sep);

    // Create nav item
    const navItem: NavItem = {
      title: frontMatter.title || parts[parts.length - 1] || "Untitled",
      slug,
      order: frontMatter.order || 999,
      category: frontMatter.category,
    };

    // Organize into tree structure
    if (parts.length === 1) {
      // Top-level item
      navItems.push(navItem);
    } else {
      // Nested item - find or create parent
      let currentLevel = navItems;
      for (let i = 0; i < parts.length - 1; i++) {
        const parentSlug = parts.slice(0, i + 1).join("/");
        let parent = currentLevel.find((item) => item.slug === parentSlug);

        if (!parent) {
          // Create parent placeholder
          const parentTitle = parts[i];
          if (!parentTitle) continue;
          parent = {
            title: parentTitle,
            slug: parentSlug,
            order: 999,
            children: [],
          };
          currentLevel.push(parent);
        }

        if (!parent.children) {
          parent.children = [];
        }
        currentLevel = parent.children;
      }
      currentLevel.push(navItem);
    }
  }

  // Sort by order
  return sortNavItems(navItems);
}

/**
 * Sort navigation items by order field
 */
function sortNavItems(items: NavItem[]): NavItem[] {
  const sorted = items.sort((a, b) => a.order - b.order);
  for (const item of sorted) {
    if (item.children) {
      item.children = sortNavItems(item.children);
    }
  }
  return sorted;
}

/**
 * Get all slugs for static generation
 * Returns unique slugs with full paths (e.g., moosestack/olap/model-table)
 */
export function getAllSlugs(): string[] {
  const files = getContentFiles();
  const slugs = files.map((file) => file.replace(/\.(md|mdx)$/, ""));
  // Remove duplicates (in case both .md and .mdx exist, prefer .mdx)
  const uniqueSlugs = Array.from(new Set(slugs));
  return uniqueSlugs;
}

/**
 * Discover step files in a directory
 * Returns step files matching the pattern: {number}-{name}.mdx
 * Sorted by step number
 */
export function discoverStepFiles(slug: string): Array<{
  slug: string;
  stepNumber: number;
  title: string;
}> {
  const dirPath = path.join(CONTENT_ROOT, slug);

  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const steps: Array<{ slug: string; stepNumber: number; title: string }> = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    // Match pattern: {number}-{name}.mdx
    const stepMatch = entry.name.match(/^(\d+)-(.+)\.mdx$/);
    if (!stepMatch) continue;

    const stepNumber = parseInt(stepMatch[1]!, 10);
    const stepName = stepMatch[2];
    if (!stepName) continue;

    const stepSlug = `${slug}/${entry.name.replace(/\.mdx$/, "")}`;

    // Read front matter to get title
    const filePath = path.join(dirPath, entry.name);
    const fileContents = fs.readFileSync(filePath, "utf8");
    const { data } = matter(fileContents);
    const frontMatter = data as FrontMatter;

    steps.push({
      slug: stepSlug,
      stepNumber,
      title: (frontMatter.title as string) || stepName.replace(/-/g, " "),
    });
  }

  // Sort by step number
  return steps.sort((a, b) => a.stepNumber - b.stepNumber);
}
