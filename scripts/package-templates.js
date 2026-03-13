#! /usr/bin/env node

// The goal of this script is to get all the templates from the templates folder
// and package them in tar files to be uploaded to Google Cloud Storage

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const toml = require("@iarna/toml");

const TEMPLATE_PACKAGES_DIR = "template-packages";
const TEMPLATE_DIR = "templates";
const SHARED_DIR = path.join(TEMPLATE_DIR, "_shared");

// Create packages directory
fs.mkdirSync(TEMPLATE_PACKAGES_DIR, { recursive: true });

// First create the manifest
const manifest = {
  templates: {},
};

// Log base directories
console.log(
  "Template Packages Directory:",
  path.resolve(TEMPLATE_PACKAGES_DIR),
);
console.log("Templates Directory:", path.resolve(TEMPLATE_DIR));

// Collect shared files
const sharedFiles = [];
if (fs.existsSync(SHARED_DIR)) {
  const collectSharedFiles = (dir, prefix = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = prefix ? path.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        collectSharedFiles(path.join(dir, entry.name), relPath);
      } else {
        sharedFiles.push(relPath);
      }
    }
  };
  collectSharedFiles(SHARED_DIR);
  console.log("\nShared files:", sharedFiles);
}

// Collect language-specific shared files
const langSharedFiles = {};
for (const lang of ["typescript", "python"]) {
  const langSharedDir = path.join(TEMPLATE_DIR, `_shared-${lang}`);
  if (fs.existsSync(langSharedDir)) {
    langSharedFiles[lang] = [];
    const collectLangSharedFiles = (dir, prefix = "") => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const relPath = prefix ? path.join(prefix, entry.name) : entry.name;
        if (entry.isDirectory()) {
          collectLangSharedFiles(path.join(dir, entry.name), relPath);
        } else {
          langSharedFiles[lang].push(relPath);
        }
      }
    };
    collectLangSharedFiles(langSharedDir);
    console.log(`\nShared files for ${lang}:`, langSharedFiles[lang]);
  }
}

// Read versions
let versions = null;
const versionsPath = path.join(TEMPLATE_DIR, "_versions.toml");
if (fs.existsSync(versionsPath)) {
  const versionsContent = fs.readFileSync(versionsPath, "utf8");
  versions = toml.parse(versionsContent).versions;
  console.log("\nVersions from _versions.toml:", versions);
}

function injectVersionsIntoPackageJson(filePath, versions) {
  const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
  let changed = false;

  for (const depKey of ["dependencies", "devDependencies"]) {
    const deps = content[depKey];
    if (!deps) continue;

    // Skip "latest" — some test templates intentionally track latest
    if (
      deps["@514labs/moose-lib"] &&
      deps["@514labs/moose-lib"] !== "latest" &&
      versions["moose-lib"]
    ) {
      deps["@514labs/moose-lib"] = versions["moose-lib"];
      changed = true;
    }
    if (
      deps["@514labs/moose-cli"] &&
      deps["@514labs/moose-cli"] !== "latest" &&
      versions["moose-cli"]
    ) {
      deps["@514labs/moose-cli"] = versions["moose-cli"];
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + "\n");
    console.log(`  Injected versions into: ${filePath}`);
  }
}

function injectVersionsIntoRequirementsTxt(filePath, versions) {
  let content = fs.readFileSync(filePath, "utf8");
  let changed = false;

  if (versions["moose-lib"]) {
    const newContent = content.replace(
      /moose-lib==[\w.\-]+/g,
      `moose-lib==${versions["moose-lib"]}`,
    );
    if (newContent !== content) {
      content = newContent;
      changed = true;
    }
  }
  if (versions["moose-cli"]) {
    const newContent = content.replace(
      /moose-cli==[\w.\-]+/g,
      `moose-cli==${versions["moose-cli"]}`,
    );
    if (newContent !== content) {
      content = newContent;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content);
    console.log(`  Injected versions into: ${filePath}`);
  }
}

function injectVersionsRecursively(dir, versions) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      injectVersionsRecursively(fullPath, versions);
    } else if (entry.name === "package.json") {
      injectVersionsIntoPackageJson(fullPath, versions);
    } else if (entry.name === "requirements.txt") {
      injectVersionsIntoRequirementsTxt(fullPath, versions);
    }
  }
}

function verifyVersions(stagingDir, versions, templateName) {
  const checkFile = (filePath) => {
    const content = fs.readFileSync(filePath, "utf8");
    const basename = path.basename(filePath);

    if (basename === "package.json") {
      const json = JSON.parse(content);
      for (const depKey of ["dependencies", "devDependencies"]) {
        const deps = json[depKey] || {};
        for (const [name, ver] of [
          ["@514labs/moose-lib", versions["moose-lib"]],
          ["@514labs/moose-cli", versions["moose-cli"]],
        ]) {
          if (
            ver &&
            deps[name] &&
            deps[name] !== ver &&
            deps[name] !== "latest"
          ) {
            throw new Error(
              `${templateName} ${filePath} has ${name}@${deps[name]}, expected ${ver}`,
            );
          }
        }
      }
    } else if (basename === "requirements.txt") {
      for (const [pkg, ver] of [
        ["moose-lib", versions["moose-lib"]],
        ["moose-cli", versions["moose-cli"]],
      ]) {
        const match = content.match(new RegExp(`${pkg}==([\\w.\\-]+)`));
        if (ver && match && match[1] !== ver) {
          throw new Error(
            `${templateName} ${filePath} has ${pkg}==${match[1]}, expected ${ver}`,
          );
        }
      }
    }
  };

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") {
        walk(fullPath);
      } else if (
        entry.name === "package.json" ||
        entry.name === "requirements.txt"
      ) {
        checkFile(fullPath);
      }
    }
  };
  walk(stagingDir);
}

function regenerateLockfiles(stagingDir) {
  // Find all directories that contain a package.json
  // and determine the package manager from existing lockfiles
  const regenerateInDir = (dir) => {
    const packageJsonPath = path.join(dir, "package.json");
    if (!fs.existsSync(packageJsonPath)) return;

    const hasPnpmLock = fs.existsSync(path.join(dir, "pnpm-lock.yaml"));
    const hasNpmLock = fs.existsSync(path.join(dir, "package-lock.json"));

    try {
      if (hasPnpmLock) {
        console.log(`  Regenerating pnpm-lock.yaml in: ${dir}`);
        execFileSync("pnpm", ["install", "--lockfile-only"], { cwd: dir });
      } else if (hasNpmLock) {
        console.log(`  Regenerating package-lock.json in: ${dir}`);
        execFileSync("npm", ["install", "--package-lock-only"], { cwd: dir });
      }
      // If no lockfile exists, skip — some templates don't have lockfiles
    } catch (error) {
      console.warn(
        `  Warning: lockfile regeneration failed in ${dir}: ${error.message}`,
      );
      // Remove stale lockfile so users get a fresh one on install
      if (hasPnpmLock) {
        fs.rmSync(path.join(dir, "pnpm-lock.yaml"), { force: true });
        console.log(`  Removed stale pnpm-lock.yaml from: ${dir}`);
      }
      if (hasNpmLock) {
        fs.rmSync(path.join(dir, "package-lock.json"), { force: true });
        console.log(`  Removed stale package-lock.json from: ${dir}`);
      }
    }
  };

  // Walk directories to find all package.json locations
  const walkForLockfiles = (dir) => {
    regenerateInDir(dir);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        entry.name !== "node_modules" &&
        entry.name !== ".git"
      ) {
        walkForLockfiles(path.join(dir, entry.name));
      }
    }
  };

  walkForLockfiles(stagingDir);
}

// Process each template and create manifest
const templates = fs
  .readdirSync(TEMPLATE_DIR)
  .filter(
    (dir) =>
      fs.statSync(path.join(TEMPLATE_DIR, dir)).isDirectory() &&
      !dir.startsWith("_"),
  );

console.log("\nFound templates:", templates);

const failures = [];

templates.forEach((template) => {
  const configPath = path.join(TEMPLATE_DIR, template, "template.config.toml");
  console.log(`\nProcessing template: ${template}`);
  console.log("Config path:", path.resolve(configPath));

  if (fs.existsSync(configPath)) {
    const stagingDir = path.join(TEMPLATE_PACKAGES_DIR, `_staging_${template}`);
    try {
      const configContent = fs.readFileSync(configPath, "utf8");
      const config = toml.parse(configContent);

      // Add all fields from the config directly
      manifest.templates[template] = {
        ...config,
      };

      console.log(
        `Template ${template} fields:`,
        Object.keys(config).join(", "),
      );

      // Create a staging directory for this template
      fs.rmSync(stagingDir, { recursive: true, force: true });
      fs.cpSync(path.join(TEMPLATE_DIR, template), stagingDir, {
        recursive: true,
        filter: (src) => !src.includes("node_modules"),
      });

      // Inject shared files (only if template doesn't have its own version)
      for (const sharedFile of sharedFiles) {
        const destPath = path.join(stagingDir, sharedFile);
        if (!fs.existsSync(destPath)) {
          const destDir = path.dirname(destPath);
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(path.join(SHARED_DIR, sharedFile), destPath);
          console.log(`  Injected shared file: ${sharedFile}`);
        }
      }

      // Inject language-specific shared files
      const language = config.language;
      if (language && langSharedFiles[language]) {
        const langSharedDir = path.join(TEMPLATE_DIR, `_shared-${language}`);
        for (const sharedFile of langSharedFiles[language]) {
          const destPath = path.join(stagingDir, sharedFile);
          if (!fs.existsSync(destPath)) {
            const destDir = path.dirname(destPath);
            fs.mkdirSync(destDir, { recursive: true });
            fs.copyFileSync(path.join(langSharedDir, sharedFile), destPath);
            console.log(`  Injected ${language} shared file: ${sharedFile}`);
          }
        }
      }

      // Inject versions from _versions.toml
      if (versions) {
        injectVersionsRecursively(path.resolve(stagingDir), versions);
        verifyVersions(path.resolve(stagingDir), versions, template);
      }

      // Regenerate lockfiles after version injection
      if (versions) {
        regenerateLockfiles(path.resolve(stagingDir));
      }

      // Package the template from staging
      const outputFilePath = path.join(
        __dirname,
        "..",
        TEMPLATE_PACKAGES_DIR,
        `${template}.tgz`,
      );
      console.log("Staging directory:", path.resolve(stagingDir));
      console.log("Output tar file:", path.resolve(outputFilePath));

      execFileSync(
        "tar",
        ["-czf", outputFilePath, "--exclude", "node_modules", "."],
        {
          cwd: path.resolve(stagingDir),
        },
      );
      console.log(`Successfully created tar file for ${template}`);
    } catch (error) {
      console.error(`Error processing ${template}:`, error.message);
      failures.push(template);
    }
  } else {
    console.warn(`Warning: No template.config.toml found in ${template}`);
  }
});

// Write manifest file to the packages directory
try {
  const manifestPath = path.join(TEMPLATE_PACKAGES_DIR, "manifest.toml");
  console.log("\nWriting manifest to:", path.resolve(manifestPath));
  const manifestContent = toml.stringify(manifest);
  fs.writeFileSync(manifestPath, manifestContent);

  console.log("\nTemplates packaged successfully");
  console.log("Files in packages directory:");
  fs.readdirSync(TEMPLATE_PACKAGES_DIR).forEach((file) => {
    const fullPath = path.resolve(TEMPLATE_PACKAGES_DIR, file);
    console.log(`- ${file} (${fullPath})`);
  });
} catch (error) {
  console.error("Error writing manifest file:", error.message);
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`\nFailed to package templates: ${failures.join(", ")}`);
  process.exit(1);
}
