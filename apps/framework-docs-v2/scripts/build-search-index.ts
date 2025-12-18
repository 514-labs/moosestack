#!/usr/bin/env tsx

import fs from "fs";
import path from "path";
import matter from "gray-matter";

// Dynamic import for pagefind (ESM module)
const getPagefind = async () => {
  const pagefind = await import("pagefind");
  return pagefind;
};

const CONTENT_DIR = path.join(__dirname, "../content");
const OUTPUT_DIR = path.join(__dirname, "../public/pagefind");

/**
 * Strip MDX/JSX syntax to get plain text content for indexing
 */
function stripMdxSyntax(content: string): string {
  return (
    content
      // Remove import statements
      .replace(/^import\s+.*?(?:from\s+)?['"].*?['"];?\s*$/gm, "")
      // Remove export statements
      .replace(/^export\s+.*$/gm, "")
      // Remove JSX components (self-closing and with children)
      .replace(
        /<[A-Z][a-zA-Z]*(?:\s+[^>]*)?(?:\/>|>[\s\S]*?<\/[A-Z][a-zA-Z]*>)/g,
        "",
      )
      // Remove remaining JSX tags
      .replace(/<\/?[a-z][a-zA-Z]*(?:\s+[^>]*)?\/?>/g, "")
      // Remove code blocks but keep content description
      .replace(/```[\s\S]*?```/g, "[code example]")
      // Remove inline code backticks
      .replace(/`([^`]+)`/g, "$1")
      // Remove markdown links but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove markdown images
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      // Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, "")
      // Remove curly brace expressions
      .replace(/\{[^}]*\}/g, "")
      // Normalize whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Convert file path to URL path
 */
function filePathToUrl(filePath: string): string {
  const relativePath = path.relative(CONTENT_DIR, filePath);
  // Remove .mdx extension and convert to URL
  let url = "/" + relativePath.replace(/\.mdx?$/, "").replace(/\\/g, "/");
  // Handle index files
  if (url.endsWith("/index")) {
    url = url.slice(0, -6) || "/";
  }
  return url;
}

/**
 * Recursively find all MDX files
 */
function findMdxFiles(dir: string): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findMdxFiles(fullPath));
    } else if (entry.name.endsWith(".mdx") || entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  console.log("Building search index from MDX content...\n");

  // Create the index
  const pagefind = await getPagefind();
  const { index } = await pagefind.createIndex();

  if (!index) {
    console.error("Failed to create Pagefind index");
    process.exit(1);
  }

  // Find all MDX files
  const mdxFiles = findMdxFiles(CONTENT_DIR);
  console.log(`Found ${mdxFiles.length} MDX files\n`);

  let indexed = 0;
  let errors = 0;

  for (const filePath of mdxFiles) {
    try {
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const { data: frontMatter, content } = matter(fileContent);

      const url = filePathToUrl(filePath);
      const title =
        frontMatter.title || path.basename(filePath, path.extname(filePath));
      const description = frontMatter.description || "";
      const plainContent = stripMdxSyntax(content);

      // Combine title, description, and content for full-text search
      const searchableContent = [title, description, plainContent]
        .filter(Boolean)
        .join("\n\n");

      const result = await index.addCustomRecord({
        url,
        content: searchableContent,
        language: "en",
        meta: {
          title,
          description,
        },
      });

      if (result.errors && result.errors.length > 0) {
        console.error(`Error indexing ${url}:`, result.errors);
        errors++;
      } else {
        indexed++;
      }
    } catch (error) {
      console.error(`Failed to process ${filePath}:`, error);
      errors++;
    }
  }

  console.log(`\nIndexed ${indexed} pages (${errors} errors)`);

  // Write the index files
  const { files } = await index.getFiles();

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (const file of files) {
    const outputPath = path.join(OUTPUT_DIR, file.path);
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, file.content);
  }

  console.log(`\nWrote ${files.length} files to ${OUTPUT_DIR}`);

  await (await getPagefind()).close();

  console.log("\nSearch index built successfully!");
}

main().catch((error) => {
  console.error("Failed to build search index:", error);
  process.exit(1);
});
