#!/usr/bin/env node
/**
 * Validates content includes for circular dependencies
 * Fails the build if any cycles are detected
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTENT_ROOT = path.join(__dirname, "..", "content");
const INCLUDE_REGEX = /^:::include\s+(.+)$/gm;

interface DependencyGraph {
  [file: string]: string[];
}

interface CycleInfo {
  cycle: string[];
  formattedPath: string;
}

/**
 * Get all MDX files recursively
 */
function getAllMdxFiles(dir: string, files: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllMdxFiles(fullPath, files);
    } else if (entry.name.endsWith(".mdx")) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract include directives from a file
 */
function extractIncludes(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf8");
  const includes: string[] = [];
  const matches = content.matchAll(INCLUDE_REGEX);

  for (const match of matches) {
    if (match[1]) {
      const includePath = match[1].trim();
      const fullPath = path.join(CONTENT_ROOT, includePath);
      includes.push(fullPath);
    }
  }

  return includes;
}

/**
 * Build dependency graph for all content files
 */
function buildDependencyGraph(files: string[]): DependencyGraph {
  const graph: DependencyGraph = {};

  for (const file of files) {
    const includes = extractIncludes(file);
    graph[file] = includes;
  }

  return graph;
}

/**
 * Detect cycles in the dependency graph using DFS
 */
function detectCycles(graph: DependencyGraph): CycleInfo[] {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: CycleInfo[] = [];
  const seenCycles = new Set<string>();

  function dfs(node: string, currentPath: string[]): boolean {
    visited.add(node);
    recursionStack.add(node);
    currentPath.push(node);

    const dependencies = graph[node] || [];

    for (const dep of dependencies) {
      // Check if file exists
      if (!fs.existsSync(dep)) {
        // Skip non-existent files (will be caught by runtime errors)
        continue;
      }

      if (!visited.has(dep)) {
        if (dfs(dep, [...currentPath])) {
          recursionStack.delete(node);
          return true;
        }
      } else if (recursionStack.has(dep)) {
        // Found a cycle
        const cycleStart = currentPath.indexOf(dep);
        const cycle = [...currentPath.slice(cycleStart), dep];
        const formattedCycle = cycle
          .map((p) => path.relative(CONTENT_ROOT, p))
          .join(" -> ");

        // Use formatted path as canonical representation for deduplication
        if (!seenCycles.has(formattedCycle)) {
          seenCycles.add(formattedCycle);
          cycles.push({
            cycle,
            formattedPath: formattedCycle,
          });
        }
        recursionStack.delete(node);
        return true;
      }
    }

    recursionStack.delete(node);
    return false;
  }

  for (const node of Object.keys(graph)) {
    if (!visited.has(node)) {
      // Early return if cycle found - stop traversing remaining nodes
      if (dfs(node, [])) {
        break;
      }
    }
  }

  return cycles;
}

/**
 * Main validation function
 */
function validateIncludes(): void {
  console.log("🔍 Validating content includes for circular dependencies...\n");

  const allFiles = getAllMdxFiles(CONTENT_ROOT);
  console.log(`Found ${allFiles.length} MDX files`);

  const graph = buildDependencyGraph(allFiles);
  const filesWithIncludes = Object.entries(graph).filter(
    ([, deps]) => deps.length > 0,
  );
  console.log(`${filesWithIncludes.length} files use include directives\n`);

  const cycles = detectCycles(graph);

  if (cycles.length > 0) {
    console.error("❌ CIRCULAR DEPENDENCY DETECTED\n");
    console.error(
      `Found ${cycles.length} circular ${cycles.length === 1 ? "dependency" : "dependencies"}:\n`,
    );

    cycles.forEach((cycleInfo, index) => {
      console.error(`${index + 1}. Cycle detected:`);
      console.error(`   ${cycleInfo.formattedPath}\n`);
    });

    console.error("Please fix the circular dependencies before building.\n");
    process.exit(1);
  }

  console.log("✅ No circular dependencies found\n");
}

// Run validation
validateIncludes();
