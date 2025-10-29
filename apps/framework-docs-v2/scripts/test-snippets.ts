#!/usr/bin/env tsx

import path from "path";
import { extractAllSnippets, testSnippets } from "../src/lib/snippet-tester";

async function main() {
  console.log("Testing code snippets...\n");

  const tsContentDir = path.join(__dirname, "../content/typescript");
  const pyContentDir = path.join(__dirname, "../content/python");

  // Extract snippets from both languages
  console.log("Extracting TypeScript snippets...");
  const tsSnippets = extractAllSnippets(tsContentDir);
  console.log(`Found ${tsSnippets.length} TypeScript snippets\n`);

  console.log("Extracting Python snippets...");
  const pySnippets = extractAllSnippets(pyContentDir);
  console.log(`Found ${pySnippets.length} Python snippets\n`);

  // Test all snippets
  const allSnippets = [...tsSnippets, ...pySnippets];
  console.log(`Testing ${allSnippets.length} total snippets...\n`);

  const results = await testSnippets(allSnippets);

  // Report results
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  console.log("=".repeat(50));
  console.log("Test Results");
  console.log("=".repeat(50));
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed.length}`);
  console.log(`Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log("\nFailed snippets:");
    failed.forEach((result) => {
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
