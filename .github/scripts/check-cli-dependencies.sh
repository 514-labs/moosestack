#!/bin/bash
# Check if pnpm-lock.yaml changes affect CLI-related packages
# Returns exit code 0 if CLI tests should run, 1 if they can be skipped
#
# Testing mode:
#   Set PNPM_DIFF_FILE to a file containing mock diff output
#   Set PNPM_LOCKFILE to a file containing mock pnpm-lock.yaml content
#   When these are set, git commands are bypassed for testing

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

# Testing mode support
if [ -n "$PNPM_DIFF_FILE" ] && [ -f "$PNPM_DIFF_FILE" ]; then
  echo "ℹ️  Test mode: using provided diff file $PNPM_DIFF_FILE"
  TEST_MODE=true
  DIFF_CONTENT=$(cat "$PNPM_DIFF_FILE")
  
  # For test mode, we also need a lockfile. If not provided, create a synthetic one
  # based on the packages mentioned in the diff
  if [ -n "$PNPM_LOCKFILE" ] && [ -f "$PNPM_LOCKFILE" ]; then
    LOCKFILE="$PNPM_LOCKFILE"
  else
    # Create synthetic lockfile from diff for backward compatibility with old tests
    LOCKFILE="/tmp/synthetic-pnpm-lock.yaml"
    echo "lockfileVersion: '9.0'" > "$LOCKFILE"
    echo "" >> "$LOCKFILE"
    echo "catalogs:" >> "$LOCKFILE"
    echo "  default:" >> "$LOCKFILE"
    echo "    some-dep:" >> "$LOCKFILE"
    echo "      specifier: 1.0.0" >> "$LOCKFILE"
    echo "" >> "$LOCKFILE"
    echo "importers:" >> "$LOCKFILE"
    echo "" >> "$LOCKFILE"
    echo "  .:" >> "$LOCKFILE"
    echo "    dependencies: {}" >> "$LOCKFILE"
    echo "" >> "$LOCKFILE"
    # Extract package names from diff (both quoted and unquoted formats)
    # Old format: +'apps/framework-docs-v2':
    # New format:    apps/framework-docs-v2:
    grep -oE "(apps|packages|templates)/[a-zA-Z0-9_-]+" "$PNPM_DIFF_FILE" | sort -u | while read -r pkg; do
      echo "  $pkg:" >> "$LOCKFILE"
      echo "    dependencies:" >> "$LOCKFILE"
      echo "      some-dep:" >> "$LOCKFILE"
      echo "        specifier: ^1.0.0" >> "$LOCKFILE"
      echo "" >> "$LOCKFILE"
    done
    echo "packages:" >> "$LOCKFILE"
    echo "" >> "$LOCKFILE"
    echo "  some-package@1.0.0:" >> "$LOCKFILE"
    echo "    resolution: {integrity: sha512-abc}" >> "$LOCKFILE"
  fi
else
  TEST_MODE=false
  LOCKFILE="pnpm-lock.yaml"
  
  # Check if pnpm-lock.yaml was changed
  if ! git diff --name-only origin/main...HEAD | grep -q "pnpm-lock.yaml"; then
    echo "ℹ️  pnpm-lock.yaml not changed"
    exit 0
  fi
fi

echo "📦 pnpm-lock.yaml was modified, analyzing affected packages..."

# Find where the importers section starts and the packages section starts
# Changes in 'packages:' section are global and don't map to specific importers
IMPORTERS_START=$(grep -n "^importers:$" "$LOCKFILE" | cut -d: -f1)
PACKAGES_START=$(grep -n "^packages:$" "$LOCKFILE" | cut -d: -f1)

# Handle case where sections aren't found (shouldn't happen with real lockfiles)
if [ -z "$IMPORTERS_START" ]; then
  IMPORTERS_START=0
fi
if [ -z "$PACKAGES_START" ]; then
  PACKAGES_START=999999
fi

echo "📍 importers section starts at line $IMPORTERS_START"
echo "📍 packages section starts at line $PACKAGES_START"

# Function to find which importer package contains a given line number
# Only valid for lines within the importers section
find_package_for_line() {
  local line_num=$1
  local file=$2
  
  # Only process if line is within importers section
  if [ "$line_num" -lt "$IMPORTERS_START" ] || [ "$line_num" -ge "$PACKAGES_START" ]; then
    echo ""
    return
  fi
  
  # Search backwards from the line to find the package header
  # Package headers are at 2-space indent: "  apps/...: " or "  packages/...:"
  head -n "$line_num" "$file" | \
    grep -n "^  \(apps\|packages\|templates\)/[a-zA-Z0-9_-]*:$" | \
    tail -1 | \
    sed 's/[0-9]*://' | \
    sed 's/^  //' | \
    sed 's/:$//'
}

# Get the diff content
if [ "$TEST_MODE" = true ]; then
  DIFF_OUTPUT="$DIFF_CONTENT"
else
  DIFF_OUTPUT=$(git diff --unified=0 origin/main...HEAD pnpm-lock.yaml)
fi

# Get list of affected packages by analyzing what changed
# Get line numbers that changed in the new file
CHANGED_LINES=$(echo "$DIFF_OUTPUT" | \
  grep "^@@" | \
  sed -n 's/.*+\([0-9]*\).*/\1/p')

ALL_AFFECTED=""
CATALOG_CHANGED=false
PACKAGES_SECTION_CHANGED=false

# For each hunk, find the package it belongs to
for line in $CHANGED_LINES; do
  # Skip if not a valid number
  if ! [[ "$line" =~ ^[0-9]+$ ]]; then
    continue
  fi
  
  # Check if this change is in the packages section (global deps)
  if [ "$line" -ge "$PACKAGES_START" ]; then
    PACKAGES_SECTION_CHANGED=true
    continue
  fi
  
  pkg=$(find_package_for_line "$line" "$LOCKFILE")
  if [ -n "$pkg" ]; then
    ALL_AFFECTED="$ALL_AFFECTED$pkg"$'\n'
  fi
done

# Also extract packages directly mentioned in the diff (for test compatibility)
# This handles both old format ('pkg':) and mentions in context
if [ "$TEST_MODE" = true ]; then
  DIFF_PACKAGES=$(echo "$DIFF_OUTPUT" | \
    grep -oE "(apps|packages|templates)/[a-zA-Z0-9_-]+" | \
    sort -u || true)
  if [ -n "$DIFF_PACKAGES" ]; then
    ALL_AFFECTED="$ALL_AFFECTED$DIFF_PACKAGES"$'\n'
  fi
fi

# Check for changes in catalogs section
if echo "$DIFF_OUTPUT" | grep -q "^@@.*catalogs"; then
  echo "📚 Changes detected in catalogs section"
  CATALOG_CHANGED=true
fi

# Clean up the list
ALL_AFFECTED=$(echo "$ALL_AFFECTED" | grep -v "^$" | sort -u || true)

echo "📋 Detected affected packages:"
if [ -n "$ALL_AFFECTED" ]; then
  echo "$ALL_AFFECTED" | while read -r pkg; do
    [ -n "$pkg" ] && echo "   - $pkg"
  done
else
  echo "   (none detected in importers section)"
fi

# Check if any CLI-related package had dependency changes
CLI_AFFECTED=false

for package in "${CLI_RELATED_PACKAGES[@]}"; do
  if [ -n "$ALL_AFFECTED" ] && echo "$ALL_AFFECTED" | grep -q "^${package}$"; then
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
docs_match_count=0
for package in "${DOCS_ONLY_PACKAGES[@]}"; do
  if [ -n "$ALL_AFFECTED" ] && echo "$ALL_AFFECTED" | grep -q "^${package}$"; then
    echo "📚 Found changes in docs package: $package"
    docs_match_count=$((docs_match_count + 1))
  fi
done

# Count total number of UNIQUE packages that changed
if [ -n "$ALL_AFFECTED" ]; then
  total_changed_count=$(echo "$ALL_AFFECTED" | grep -c -v "^$" || echo "0")
else
  total_changed_count=0
fi

echo "📊 Package change summary: $docs_match_count docs packages, $total_changed_count total unique packages"

# If only the packages section changed (no importers changed), these are typically
# transitive dependency updates that don't require re-testing unless they affect CLI
if [ "$PACKAGES_SECTION_CHANGED" = true ] && [ "$total_changed_count" -eq 0 ] && [ "$CATALOG_CHANGED" = false ]; then
  echo "📦 Only packages section changed (transitive deps), not importers"
  echo "⏭️  No importer changes detected, CLI tests can be skipped"
  exit 1
fi

# If catalog changed, check if any catalog dep is used by CLI packages
# For now, be conservative - if catalogs changed, run tests
if [ "$CATALOG_CHANGED" = true ]; then
  echo "⚠️  Catalog dependencies changed"
  # Check if it's ONLY docs that use this catalog entry
  # For simplicity, if docs packages are the only ones detected and catalogs changed,
  # we can still skip if the catalog change is for a docs-only dependency
  if [ "$docs_match_count" -gt 0 ] && [ "$docs_match_count" -eq "$total_changed_count" ]; then
    echo "📚 Catalog change appears to only affect docs packages"
    echo "⏭️  Only docs dependencies changed, CLI tests can be skipped"
    exit 1
  fi
  echo "🚀 Catalog changes may affect CLI, tests should run"
  exit 0
fi

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

# If we detected packages but none matched CLI or docs, be safe and run tests
if [ "$total_changed_count" -gt 0 ] && [ "$docs_match_count" -eq 0 ] && [ "$CLI_AFFECTED" = false ]; then
  echo "⚠️  Unknown packages changed, running tests to be safe"
  exit 0
fi

# If no packages detected at all but there were changes, run tests to be safe
if [ "$total_changed_count" -eq 0 ]; then
  echo "⚠️  Unable to determine affected packages, running tests to be safe"
  exit 0
fi

# Default: skip tests if we got here (only docs changed)
echo "⏭️  No CLI-related changes detected, tests can be skipped"
exit 1
