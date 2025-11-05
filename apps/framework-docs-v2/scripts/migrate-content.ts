#!/usr/bin/env tsx

import fs from "fs";
import path from "path";
import matter from "gray-matter";

const SOURCE_DIR = path.join(__dirname, "../../framework-docs/src/pages/moose");
const TARGET_TS_DIR = path.join(__dirname, "../content/typescript");
const TARGET_PY_DIR = path.join(__dirname, "../content/python");

interface MigrationStats {
  filesProcessed: number;
  filesCreated: number;
  errors: string[];
}

const stats: MigrationStats = {
  filesProcessed: 0,
  filesCreated: 0,
  errors: [],
};

/**
 * Extract content for a specific language from MDX
 */
function extractLanguageContent(
  content: string,
  language: "typescript" | "python",
): string {
  const languageTag = language === "typescript" ? "TypeScript" : "Python";
  const otherTag = language === "typescript" ? "Python" : "TypeScript";

  // Remove other language content
  const otherTagRegex = new RegExp(
    `<${otherTag}[^>]*>([\\s\\S]*?)</${otherTag}>`,
    "gi",
  );
  let processed = content.replace(otherTagRegex, "");

  // Extract this language's content (remove wrapper tags)
  const thisTagRegex = new RegExp(
    `<${languageTag}[^>]*>([\\s\\S]*?)</${languageTag}>`,
    "gi",
  );
  processed = processed.replace(thisTagRegex, (_match, inner) => inner || "");

  // Clean up MDX-specific imports and exports
  processed = processed.replace(/^import .*$/gm, "");
  processed = processed.replace(/^export default .*$/gm, "");
  processed = processed.replace(/^export const .*$/gm, "");

  // Clean up React components
  processed = processed.replace(/<>|<\/>/g, "");
  processed = processed.replace(/<[A-Z][A-Za-z0-9]*(?:\s[^<>]*)?>/g, "");
  processed = processed.replace(/<\/[A-Z][A-Za-z0-9]*>/g, "");

  // Clean up excessive whitespace
  processed = processed.replace(/\n{3,}/g, "\n\n");
  processed = processed.trim();

  return processed;
}

/**
 * Process a single MDX file
 */
function processFile(sourcePath: string, relativePath: string) {
  try {
    stats.filesProcessed++;

    const content = fs.readFileSync(sourcePath, "utf-8");
    const { data: frontMatter, content: body } = matter(content);

    // Skip files that shouldn't be migrated
    if (relativePath.startsWith("_") || relativePath.includes("/_")) {
      console.log(`  Skipping: ${relativePath}`);
      return;
    }

    // Extract content for both languages
    const tsContent = extractLanguageContent(body, "typescript");
    const pyContent = extractLanguageContent(body, "python");

    // Only create files if there's actual content
    if (tsContent.trim()) {
      const tsPath = path.join(TARGET_TS_DIR, relativePath);
      const tsDir = path.dirname(tsPath);

      if (!fs.existsSync(tsDir)) {
        fs.mkdirSync(tsDir, { recursive: true });
      }

      const tsFrontMatter = {
        ...frontMatter,
        // Add default order if not present
        order: frontMatter.order || 999,
      };

      const tsFile = matter.stringify(tsContent, tsFrontMatter);
      fs.writeFileSync(tsPath, tsFile);
      stats.filesCreated++;
      console.log(`  ✓ Created TypeScript: ${relativePath}`);
    }

    if (pyContent.trim()) {
      const pyPath = path.join(TARGET_PY_DIR, relativePath);
      const pyDir = path.dirname(pyPath);

      if (!fs.existsSync(pyDir)) {
        fs.mkdirSync(pyDir, { recursive: true });
      }

      const pyFrontMatter = {
        ...frontMatter,
        order: frontMatter.order || 999,
      };

      const pyFile = matter.stringify(pyContent, pyFrontMatter);
      fs.writeFileSync(pyPath, pyFile);
      stats.filesCreated++;
      console.log(`  ✓ Created Python: ${relativePath}`);
    }
  } catch (error) {
    const errorMsg = `Error processing ${relativePath}: ${error}`;
    stats.errors.push(errorMsg);
    console.error(`  ✗ ${errorMsg}`);
  }
}

/**
 * Recursively process directory
 */
function processDirectory(dir: string, baseDir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      processDirectory(fullPath, baseDir);
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      processFile(fullPath, relativePath);
    }
  }
}

/**
 * Copy assets (images, etc.)
 */
function copyAssets() {
  const publicSource = path.join(__dirname, "../../framework-docs/public");
  const publicTarget = path.join(__dirname, "../public");

  if (fs.existsSync(publicSource)) {
    console.log("\nCopying assets...");

    // Copy relevant asset directories
    const assetDirs = ["images", "img", "assets"];

    for (const dir of assetDirs) {
      const sourceDir = path.join(publicSource, dir);
      const targetDir = path.join(publicTarget, dir);

      if (fs.existsSync(sourceDir)) {
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        // Note: For a production migration, use a proper recursive copy
        console.log(`  Would copy: ${dir}/`);
      }
    }
  }
}

/**
 * Main migration function
 */
function main() {
  console.log("Starting content migration...\n");

  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Source directory not found: ${SOURCE_DIR}`);
    console.error("Make sure framework-docs exists in the apps directory.");
    process.exit(1);
  }

  // Create target directories
  if (!fs.existsSync(TARGET_TS_DIR)) {
    fs.mkdirSync(TARGET_TS_DIR, { recursive: true });
  }
  if (!fs.existsSync(TARGET_PY_DIR)) {
    fs.mkdirSync(TARGET_PY_DIR, { recursive: true });
  }

  // Process all MDX files
  console.log("Processing MDX files...\n");
  processDirectory(SOURCE_DIR, SOURCE_DIR);

  // Copy assets
  copyAssets();

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("Migration Summary");
  console.log("=".repeat(50));
  console.log(`Files processed: ${stats.filesProcessed}`);
  console.log(`Files created: ${stats.filesCreated}`);
  console.log(`Errors: ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log("\nErrors:");
    stats.errors.forEach((error) => console.log(`  - ${error}`));
  }

  console.log("\n✓ Migration complete!");
  console.log("\nNext steps:");
  console.log(
    "1. Review migrated content in content/typescript and content/python",
  );
  console.log("2. Fix any broken links or formatting issues");
  console.log("3. Update image paths if necessary");
  console.log("4. Run 'pnpm build' to test the site");
}

// Run migration
main();
