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

# Support testing mode: if PNPM_DIFF_FILE is set and exists, use it directly
if [ -n "$PNPM_DIFF_FILE" ] && [ -f "$PNPM_DIFF_FILE" ]; then
  echo "ℹ️  Using provided diff file: $PNPM_DIFF_FILE"
  DIFF_FILE="$PNPM_DIFF_FILE"
else
  # Check if pnpm-lock.yaml was changed
  if ! git diff --name-only origin/main...HEAD | grep -q "pnpm-lock.yaml"; then
    echo "ℹ️  pnpm-lock.yaml not changed"
    exit 0
  fi

  echo "📦 pnpm-lock.yaml was modified, analyzing affected packages..."

  # Get the diff of pnpm-lock.yaml
  DIFF_FILE="/tmp/pnpm-lock-diff.txt"
  git diff origin/main...HEAD pnpm-lock.yaml > "$DIFF_FILE"
fi

# Check if any CLI-related package had dependency changes
CLI_AFFECTED=false

for package in "${CLI_RELATED_PACKAGES[@]}"; do
  # Look for the package path in the diff (in quotes)
  # PNPM lock file has entries like: "'apps/framework-cli':"
  if grep -q "'$package':" "$DIFF_FILE"; then
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
# Count how many docs packages changed
docs_match_count=0
for package in "${DOCS_ONLY_PACKAGES[@]}"; do
  if grep -q "'$package':" "$DIFF_FILE"; then
    echo "📚 Found changes in docs package: $package"
    docs_match_count=$((docs_match_count + 1))
  fi
done

# Count total number of UNIQUE packages that changed
# Match only importer packages (2-space indent), not dependencies
total_changed_count=$(grep "^[+-]  '[^']*':" "$DIFF_FILE" | \
  grep -o "'[^']*':" | \
  sort -u | \
  wc -l | \
  tr -d ' ' || echo "0")

echo "📊 Package change summary: $docs_match_count docs packages, $total_changed_count total unique packages"

# Set DOCS_ONLY=true only if at least one docs package changed AND
# the number of docs packages equals the total (meaning ONLY docs changed)
DOCS_ONLY=false
if [ "$docs_match_count" -gt 0 ] && [ "$docs_match_count" -eq "$total_changed_count" ]; then
  DOCS_ONLY=true
fi

# If only docs changed and no CLI packages, we can skip
if [ "$DOCS_ONLY" = true ]; then
  echo "⏭️  Only docs dependencies changed, CLI tests can be skipped"
  exit 1
fi

# Check for root-level dependency changes that could affect everything
# First check if there are any root dependency lines (starting with +...'/@ )
if grep -q "^+.*'/@" "$DIFF_FILE"; then
  # Then check if these changes are NOT exclusively in docs context
  # If the root deps line does NOT contain apps/framework-docs-v2, tests should run
  if ! grep "^+.*'/@" "$DIFF_FILE" | grep -q "apps/framework-docs-v2"; then
    echo "⚠️  Root or shared dependencies changed, tests should run"
    exit 0
  fi
fi

# If we can't determine safely, run tests to be safe
echo "⚠️  Unable to determine if changes affect CLI, running tests to be safe"
exit 0
