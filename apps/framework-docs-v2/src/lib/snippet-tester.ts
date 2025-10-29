import fs from "fs";
import path from "path";
import matter from "gray-matter";

export interface CodeSnippet {
  code: string;
  language: string;
  file: string;
  lineNumber: number;
  testDirective?: string;
}

export interface TestResult {
  snippet: CodeSnippet;
  passed: boolean;
  error?: string;
}

/**
 * Extract code snippets from markdown content
 */
export function extractCodeSnippets(
  content: string,
  filePath: string,
): CodeSnippet[] {
  const snippets: CodeSnippet[] = [];
  const codeBlockRegex = /```(\w+)(?: @test)?([^\n]*)\n([\s\S]*?)```/g;
  let match;

  let lineNumber = 1;
  const lines = content.split("\n");

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const language = match[1];
    const directive = match[2]?.trim();
    const code = match[3];

    if (!language || !code) continue;

    // Calculate approximate line number
    const beforeMatch = content.substring(0, match.index);
    const matchLineNumber = beforeMatch.split("\n").length;

    // Only include snippets with @test directive or specific languages
    if (
      directive?.includes("@test") ||
      ["typescript", "javascript", "python"].includes(language)
    ) {
      snippets.push({
        code,
        language,
        file: filePath,
        lineNumber: matchLineNumber,
        testDirective: directive,
      });
    }
  }

  return snippets;
}

/**
 * Extract all code snippets from content directory
 */
export function extractAllSnippets(contentDir: string): CodeSnippet[] {
  const allSnippets: CodeSnippet[] = [];

  function processDirectory(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        processDirectory(fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".md") || entry.name.endsWith(".mdx"))
      ) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const { content: body } = matter(content);
        const snippets = extractCodeSnippets(
          body,
          path.relative(contentDir, fullPath),
        );
        allSnippets.push(...snippets);
      }
    }
  }

  processDirectory(contentDir);
  return allSnippets;
}

/**
 * Validate TypeScript/JavaScript snippet
 */
export async function validateTypeScriptSnippet(
  snippet: CodeSnippet,
): Promise<TestResult> {
  try {
    // Basic syntax validation - check for common issues
    const code = snippet.code.trim();

    // Check for unmatched braces
    const openBraces = (code.match(/{/g) || []).length;
    const closeBraces = (code.match(/}/g) || []).length;
    if (openBraces !== closeBraces) {
      return {
        snippet,
        passed: false,
        error: "Unmatched braces",
      };
    }

    // Check for unmatched parentheses
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      return {
        snippet,
        passed: false,
        error: "Unmatched parentheses",
      };
    }

    // For actual validation, we would use TypeScript compiler API
    // For now, basic checks pass
    return {
      snippet,
      passed: true,
    };
  } catch (error) {
    return {
      snippet,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Validate Python snippet
 */
export async function validatePythonSnippet(
  snippet: CodeSnippet,
): Promise<TestResult> {
  try {
    const code = snippet.code.trim();

    // Basic validation - check for common Python syntax issues
    // Check indentation consistency (spaces vs tabs)
    const hasSpaces = /^ +/m.test(code);
    const hasTabs = /^\t+/m.test(code);
    if (hasSpaces && hasTabs) {
      return {
        snippet,
        passed: false,
        error: "Mixed tabs and spaces in indentation",
      };
    }

    // For actual validation, we would shell out to Python
    // For now, basic checks pass
    return {
      snippet,
      passed: true,
    };
  } catch (error) {
    return {
      snippet,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test all snippets
 */
export async function testSnippets(
  snippets: CodeSnippet[],
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const snippet of snippets) {
    let result: TestResult;

    if (
      snippet.language === "typescript" ||
      snippet.language === "javascript"
    ) {
      result = await validateTypeScriptSnippet(snippet);
    } else if (snippet.language === "python") {
      result = await validatePythonSnippet(snippet);
    } else {
      // Skip other languages
      result = {
        snippet,
        passed: true,
      };
    }

    results.push(result);
  }

  return results;
}
