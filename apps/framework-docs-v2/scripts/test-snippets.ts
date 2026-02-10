#!/usr/bin/env tsx

import path from "path";
import {
  extractAllSnippets,
  testSnippets,
  TestResult,
} from "../src/lib/snippet-tester.js";

async function main() {
  console.log("Testing code snippets...\n");

  const contentDir = path.join(__dirname, "../content");

  // Extract snippets from content
  console.log("Extracting snippets...");
  const allSnippets = extractAllSnippets(contentDir);

  const tsSnippets = allSnippets.filter(
    (s) => s.language === "typescript" || s.language === "javascript",
  );
  const pySnippets = allSnippets.filter((s) => s.language === "python");

  console.log(`Found ${tsSnippets.length} TypeScript snippets\n`);

  console.log(`Found ${pySnippets.length} Python snippets\n`);

  // Test all snippets
  console.log(`Testing ${allSnippets.length} total snippets...\n`);

  const results = await testSnippets(allSnippets);

  // Report results
  const passed = results.filter((r: TestResult) => r.passed);
  const failed = results.filter((r: TestResult) => !r.passed);

  console.log("=".repeat(50));
  console.log("Test Results");
  console.log("=".repeat(50));
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed.length}`);
  console.log(`Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log("\nFailed snippets:");
    failed.forEach((result: TestResult) => {
      console.log(`\n  ✗ ${result.snippet.file}:${result.snippet.lineNumber}`);
      console.log(`    Language: ${result.snippet.language}`);
      console.log(`    Error: ${result.error}`);
    });

    process.exit(1);
  } else {
    console.log("\n✓ All snippets passed!");
  }
}

main().catch((error) => {
  console.error("Error testing snippets:", error);
  process.exit(1);
});
