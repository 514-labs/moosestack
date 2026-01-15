#!/bin/bash
# Check if pnpm-lock.yaml changes affect CLI-related packages
# Returns exit code 0 if CLI tests should run, 1 if they can be skipped

set -e

# Packages that affect CLI testing
CLI_RELATED_PACKAGES=(
  "apps/framework-cli"
  "apps/framework-cli-e2e"
  "packages/ts-moose-lib"
  "packages/py-moose-lib"
  "templates/typescript"
  "templates/python"
)

# Packages that don't affect CLI (can be skipped)
DOCS_ONLY_PACKAGES=(
  "apps/framework-docs-v2"
  "packages/design-system"
)

echo "🔍 Analyzing pnpm-lock.yaml changes..."

# Check if pnpm-lock.yaml was changed
if ! git diff --name-only origin/main...HEAD | grep -q "pnpm-lock.yaml"; then
  echo "ℹ️  pnpm-lock.yaml not changed"
  exit 0
fi

echo "📦 pnpm-lock.yaml was modified, analyzing affected packages..."

# Get the diff of pnpm-lock.yaml
git diff origin/main...HEAD pnpm-lock.yaml > /tmp/pnpm-lock-diff.txt

# Check if any CLI-related package had dependency changes
CLI_AFFECTED=false

for package in "${CLI_RELATED_PACKAGES[@]}"; do
  # Look for the package path in the diff (in quotes)
  # PNPM lock file has entries like: "'apps/framework-cli':"
  if grep -q "'$package':" /tmp/pnpm-lock-diff.txt; then
    echo "✅ Found changes affecting CLI package: $package"
    CLI_AFFECTED=true
    break
  fi
done

# If CLI packages were affected, tests must run
if [ "$CLI_AFFECTED" = true ]; then
  echo "🚀 CLI-related packages changed, tests should run"
  exit 0
fi

# Check if only docs packages were affected
DOCS_ONLY=false
for package in "${DOCS_ONLY_PACKAGES[@]}"; do
  if grep -q "'$package':" /tmp/pnpm-lock-diff.txt; then
    echo "📚 Found changes only in docs package: $package"
    DOCS_ONLY=true
  fi
done

# If only docs changed and no CLI packages, we can skip
if [ "$DOCS_ONLY" = true ]; then
  echo "⏭️  Only docs dependencies changed, CLI tests can be skipped"
  exit 1
fi

# Check for root-level dependency changes that could affect everything
if grep -q "^+.*'/@" /tmp/pnpm-lock-diff.txt | grep -v "apps/framework-docs-v2"; then
  echo "⚠️  Root or shared dependencies changed, tests should run"
  exit 0
fi

# If we can't determine safely, run tests to be safe
echo "⚠️  Unable to determine if changes affect CLI, running tests to be safe"
exit 0
