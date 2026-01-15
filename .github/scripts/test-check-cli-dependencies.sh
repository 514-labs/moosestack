#!/bin/bash
# Test script for check-cli-dependencies.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DETECTOR_SCRIPT="$SCRIPT_DIR/check-cli-dependencies.sh"
export PNPM_DIFF_FILE="/tmp/pnpm-lock-diff.txt"

# Cleanup temporary file on exit/signals
trap 'rm -f "$PNPM_DIFF_FILE"' EXIT INT TERM

echo "🧪 Testing check-cli-dependencies.sh script"
echo ""

# Test 1: Only docs dependencies changed (should skip - exit 1)
cat > "$PNPM_DIFF_FILE" << 'EOF'
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index abc123..def456 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -100,6 +100,9 @@ importers:
+  'apps/framework-docs-v2':
     dependencies:
       '@mdx-js/react':
         specifier: ^3.1.0
         version: 3.1.0
EOF

echo "Test 1: Only docs dependencies changed"
echo "Expected: exit 1 (skip tests)"
echo "---"

set +e
"$DETECTOR_SCRIPT" > /dev/null 2>&1
exit_code=$?
set -e

if [ "$exit_code" -eq 1 ]; then
  echo "✅ Correctly identified docs-only changes (exit 1)"
else
  echo "❌ Failed: Script returned exit $exit_code but expected exit 1 (skip tests)"
  exit 1
fi

echo ""

# Test 2: CLI package changes (should run - exit 0)
cat > "$PNPM_DIFF_FILE" << 'EOF'
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index abc123..def456 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -50,6 +50,9 @@ importers:
+  'apps/framework-cli':
     dependencies:
       clap:
         specifier: ^4.5.0
EOF

echo "Test 2: CLI dependencies changed"
echo "Expected: exit 0 (run tests)"
echo "---"

set +e
"$DETECTOR_SCRIPT" > /dev/null 2>&1
exit_code=$?
set -e

if [ "$exit_code" -eq 0 ]; then
  echo "✅ Correctly identified CLI package changes (exit 0)"
else
  echo "❌ Failed: Script returned exit $exit_code but expected exit 0"
  exit 1
fi

echo ""

# Test 3: Both docs AND CLI changed (should run - exit 0)
cat > "$PNPM_DIFF_FILE" << 'EOF'
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index abc123..def456 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -50,6 +50,9 @@ importers:
+  'apps/framework-cli':
     dependencies:
       tokio:
         specifier: ^1.0
+  'apps/framework-docs-v2':
     dependencies:
       next:
         specifier: ^16.0.7
EOF

echo "Test 3: Both docs AND CLI dependencies changed"
echo "Expected: exit 0 (run tests)"
echo "---"

set +e
"$DETECTOR_SCRIPT" > /dev/null 2>&1
exit_code=$?
set -e

if [ "$exit_code" -eq 0 ]; then
  echo "✅ Correctly identified mixed changes - will NOT skip tests (exit 0)"
else
  echo "❌ Failed: Script returned exit $exit_code but expected exit 0"
  exit 1
fi

echo ""

# Test 4: Root dependency changed (not docs-specific)
cat > "$PNPM_DIFF_FILE" << 'EOF'
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index abc123..def456 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -10,6 +10,9 @@ packages:
+  '/@types/node@20.10.0':
     resolution:
       integrity: sha512-abc123
EOF

echo "Test 4: Root/shared dependency changed (should run tests)"
echo "Expected: exit 0 (run tests)"
echo "---"

set +e
"$DETECTOR_SCRIPT" > /dev/null 2>&1
exit_code=$?
set -e

if [ "$exit_code" -eq 0 ]; then
  echo "✅ Correctly detected root/shared dependency change (non-docs) (exit 0)"
else
  echo "❌ Failed: Script returned exit $exit_code but expected exit 0"
  exit 1
fi

echo ""

# Test 5: Docs package with MULTIPLE dependency changes (should skip - exit 1)
cat > "$PNPM_DIFF_FILE" << 'EOF'
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index abc123..def456 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -100,6 +100,15 @@ importers:
+  'apps/framework-docs-v2':
     dependencies:
       next:
         specifier: ^16.0.7
+      react:
+        specifier: ^18.0.0
+      '@mdx-js/react':
+        specifier: ^3.1.0
+      typescript:
+        specifier: ^5.0.0
EOF

echo "Test 5: Docs package with multiple dependency changes (should skip tests)"
echo "Expected: exit 1 (skip tests) - verifies unique package counting"
echo "---"

set +e
"$DETECTOR_SCRIPT" > /dev/null 2>&1
exit_code=$?
set -e

if [ "$exit_code" -eq 1 ]; then
  echo "✅ Correctly identified docs-only changes with multiple deps (exit 1)"
else
  echo "❌ Failed: Script returned exit $exit_code but expected exit 1 (skip tests)"
  echo "    This likely means total_changed_count is counting lines instead of unique packages"
  exit 1
fi

echo ""
echo "✨ All tests passed!"
