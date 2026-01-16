/**
 * E2E tests for module compilation (ESM and CJS support).
 *
 * These tests verify that moose-tspc correctly compiles TypeScript to:
 * - CommonJS when package.json has no "type" field (default)
 * - ES Modules when package.json has "type": "module"
 *
 * Tests are designed to be fast (~30-60 seconds) by only testing compilation
 * without starting the full moose dev server.
 */
import { expect } from "chai";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { createTempTestDirectory, removeTestProject } from "./utils/file-utils";
import { setupTypeScriptProject } from "./utils/project-setup";
import { logger } from "./utils/logger";

const testLogger = logger.scope("module-compilation");

describe("Module Compilation", function () {
  // 2 minutes max for the entire suite
  this.timeout(120_000);

  const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
  const MOOSE_LIB_PATH = path.resolve(
    __dirname,
    "../../../packages/ts-moose-lib",
  );

  /**
   * Recursively walks a directory and returns all .js files
   */
  function walkJsFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") {
        results.push(...walkJsFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        results.push(fullPath);
      }
    }
    return results;
  }

  describe("CJS compilation (default)", function () {
    let projectDir: string;

    before(async function () {
      this.timeout(90_000);
      projectDir = createTempTestDirectory("cjs-compile", {
        logger: testLogger,
      });
      testLogger.info("Setting up CJS project", { projectDir });

      await setupTypeScriptProject(
        projectDir,
        "typescript-empty",
        CLI_PATH,
        MOOSE_LIB_PATH,
        "cjs-test-app",
        "npm",
        { logger: testLogger },
      );
    });

    after(function () {
      if (projectDir) {
        removeTestProject(projectDir, { logger: testLogger });
      }
    });

    it("compiles to CommonJS when no type field in package.json", async function () {
      // Run moose-tspc
      testLogger.info("Running moose-tspc compilation");
      execSync("npx moose-tspc .moose/compiled", {
        cwd: projectDir,
        stdio: "pipe",
        env: { ...process.env, MOOSE_SOURCE_DIR: "app" },
      });

      // Verify output exists
      const indexJs = path.join(projectDir, ".moose/compiled/app/index.js");
      expect(fs.existsSync(indexJs), `Expected ${indexJs} to exist`).to.be.true;

      // Verify CommonJS output characteristics
      const content = fs.readFileSync(indexJs, "utf-8");
      testLogger.debug("Compiled content sample", {
        sample: content.slice(0, 200),
      });

      // CommonJS output should have one of these patterns
      const hasCjsPatterns =
        content.includes("exports.") ||
        content.includes("module.exports") ||
        content.includes('require("') ||
        content.includes("require('") ||
        content.includes("Object.defineProperty(exports");

      expect(
        hasCjsPatterns,
        "Expected CommonJS output with exports or require patterns",
      ).to.be.true;
    });
  });

  describe("ESM compilation", function () {
    let projectDir: string;

    before(async function () {
      this.timeout(90_000);
      projectDir = createTempTestDirectory("esm-compile", {
        logger: testLogger,
      });
      testLogger.info("Setting up ESM project", { projectDir });

      await setupTypeScriptProject(
        projectDir,
        "typescript-empty",
        CLI_PATH,
        MOOSE_LIB_PATH,
        "esm-test-app",
        "npm",
        { logger: testLogger },
      );

      // Add "type": "module" to package.json
      const pkgPath = path.join(projectDir, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      pkg.type = "module";
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      testLogger.info("Updated package.json with type: module");
    });

    after(function () {
      if (projectDir) {
        removeTestProject(projectDir, { logger: testLogger });
      }
    });

    it("compiles to ESM when type=module in package.json", async function () {
      // Run moose-tspc
      testLogger.info("Running moose-tspc compilation for ESM");
      execSync("npx moose-tspc .moose/compiled", {
        cwd: projectDir,
        stdio: "pipe",
        env: { ...process.env, MOOSE_SOURCE_DIR: "app" },
      });

      // Verify output exists
      const indexJs = path.join(projectDir, ".moose/compiled/app/index.js");
      expect(fs.existsSync(indexJs), `Expected ${indexJs} to exist`).to.be.true;

      // Verify ESM output characteristics
      const content = fs.readFileSync(indexJs, "utf-8");
      testLogger.debug("Compiled ESM content sample", {
        sample: content.slice(0, 200),
      });

      // ESM output should have import/export statements at the start of lines
      const hasEsmPatterns =
        /^import\s+/m.test(content) || /^export\s+/m.test(content);

      // ESM output should NOT have require() (unless it's a dynamic require for CJS deps)
      const hasRequirePattern = /\brequire\s*\(/.test(content);

      expect(
        hasEsmPatterns,
        "Expected ESM output with import/export statements",
      ).to.be.true;
      expect(hasRequirePattern, "Expected ESM output to not use require()").to
        .be.false;
    });

    it("adds .js extensions to relative imports in ESM output", async function () {
      // Check that relative imports have .js extension
      const compiledDir = path.join(projectDir, ".moose/compiled");
      const jsFiles = walkJsFiles(compiledDir);

      testLogger.info("Checking .js extensions in relative imports", {
        fileCount: jsFiles.length,
      });

      for (const file of jsFiles) {
        const content = fs.readFileSync(file, "utf-8");

        // Find all relative imports using 'from' clause
        const relativeImports =
          content.match(/from\s+['"]\.\.?\/[^'"]+['"]/g) || [];

        for (const imp of relativeImports) {
          // Each relative import should end with .js before the quote
          const hasJsExtension = /\.js['"]$/.test(imp);
          expect(
            hasJsExtension,
            `Expected relative import to have .js extension: ${imp} in ${file}`,
          ).to.be.true;
        }
      }
    });
  });
});
