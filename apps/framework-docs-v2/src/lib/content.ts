import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";
import type {
  FrontMatter,
  Heading,
  Language,
  NavItem,
  ParsedContent,
} from "@/lib/content-types";

const CONTENT_ROOT = path.join(process.cwd(), "content");

/**
 * Get all content files for a specific language
 */
export function getContentFiles(language: Language): string[] {
  const contentDir = path.join(CONTENT_ROOT, language);
  if (!fs.existsSync(contentDir)) {
    return [];
  }
  return getAllMarkdownFiles(contentDir, contentDir);
}

/**
 * Recursively get all markdown files in a directory
 */
function getAllMarkdownFiles(dir: string, baseDir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
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
  language: Language,
  slug: string,
): Promise<ParsedContent> {
  const contentDir = path.join(CONTENT_ROOT, language);
  const filePath = path.join(contentDir, `${slug}.md`);
  const mdxFilePath = path.join(contentDir, `${slug}.mdx`);

  let fullPath: string;
  if (fs.existsSync(filePath)) {
    fullPath = filePath;
  } else if (fs.existsSync(mdxFilePath)) {
    fullPath = mdxFilePath;
  } else {
    throw new Error(`Content file not found for slug: ${slug}`);
  }

  const fileContents = fs.readFileSync(fullPath, "utf8");
  const { data, content: rawContent } = matter(fileContents);

  // Parse content to HTML
  const processedContent = await remark()
    .use(remarkGfm)
    .use(remarkHtml, { sanitize: false })
    .process(rawContent);

  const content = processedContent.toString();

  // Extract headings for TOC
  const headings = extractHeadings(rawContent);

  return {
    frontMatter: data as FrontMatter,
    content,
    headings,
    slug,
  };
}

/**
 * Extract headings from markdown content
 */
function extractHeadings(content: string): Heading[] {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: Heading[] = [];
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    if (!match[1] || !match[2]) continue;
    const level = match[1].length;
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");

    headings.push({ level, text, id });
  }

  return headings;
}

/**
 * Build navigation tree from content files
 */
export function buildNavigationTree(language: Language): NavItem[] {
  const files = getContentFiles(language);
  const navItems: NavItem[] = [];
  const contentDir = path.join(CONTENT_ROOT, language);

  for (const file of files) {
    const fullPath = path.join(contentDir, file);
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
 */
export function getAllSlugs(language: Language): string[] {
  const files = getContentFiles(language);
  return files.map((file) => file.replace(/\.(md|mdx)$/, ""));
}
