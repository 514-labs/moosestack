#!/usr/bin/env node

const { spawn } = require("child_process");

function checkSafeChain() {
  // Skip check in CI environments
  if (process.env.CI) {
    console.log("⚠️  Skipping safe-chain check in CI environment");
    console.log(
      "ℹ️  For CI/CD integration, see: https://help.aikido.dev/code-scanning/aikido-malware-scanning/malware-scanning-with-safe-chain-in-ci-cd-environments",
    );

    process.exit(0);
  }

  // Safe-chain works by wrapping package managers with shell aliases/functions
  // We need to run the test in a shell context to properly test if safe-chain is working

  const child = spawn(
    "source ~/.bashrc 2>/dev/null || source ~/.zshrc 2>/dev/null && pnpm install --no-lockfile --ignore-scripts --ignore-workspace safe-chain-test 2>/dev/null >/dev/null",
    [],
    { stdio: "pipe", shell: process.env.SHELL || "/bin/bash" },
  );

  child.on("error", (error) => {
    console.error("❌ Failed to run test command:", error.message);
    console.error("   Unable to verify safe-chain status");
    process.exit(1);
  });

  child.on("close", (code) => {
    if (code === 0) {
      // Command succeeded - safe-chain is NOT working (it should have blocked the install)
      console.error("❌ Safe-chain is not properly installed or configured");
      console.error('   The test package "safe-chain-test" was not blocked');
      console.error("");
      console.error("📋 To install and configure safe-chain:");
      console.error("   1. npm install -g @aikidosec/safe-chain");
      console.error("   2. safe-chain setup");
      console.error("   3. Restart your terminal");
      console.error("   4. Verify with: npm install safe-chain-test");
      console.error("");
      console.error(
        "🛡️  Safe-chain protects against malicious packages during installation.",
      );
      console.error("📖 More info: https://github.com/AikidoSec/safe-chain");
      console.error("");
      process.exit(1);
    } else if (code === 127) {
      // Command not found (pnpm not installed)
      console.error("❌ pnpm not found - unable to verify safe-chain status");
      process.exit(1);
    } else if (code === 1) {
      // Non-zero exit code - likely safe-chain blocked the installation
      // console.log("✅ Safe-chain is properly installed and configured");
      process.exit(0);
    }

    // In unexpcted cases exit 1 to be cautious
    process.exit(1);
  });
}

checkSafeChain();
