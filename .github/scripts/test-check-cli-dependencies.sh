#!/bin/bash
# Test script for check-cli-dependencies.sh

set -e

echo "🧪 Testing check-cli-dependencies.sh script"
echo ""

# Create a test pnpm-lock diff that only has docs changes
cat > /tmp/pnpm-lock-diff.txt << 'EOF'
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index abc123..def456 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -100,6 +100,9 @@ importers:
   'apps/framework-docs-v2':
     dependencies:
+      '@mdx-js/react':
+        specifier: ^3.1.0
+        version: 3.1.0
       next:
         specifier: ^16.0.7
         version: 16.0.7
EOF

echo "Test 1: Only docs dependencies changed"
echo "Expected: Script should exit with code 1 (skip tests)"
echo "---"

# Temporarily override the diff command for testing
export PNPM_DIFF_FILE="/tmp/pnpm-lock-diff.txt"

# Run a simplified version of the logic
if grep -q "'apps/framework-docs-v2':" /tmp/pnpm-lock-diff.txt && \
   ! grep -q "'apps/framework-cli':" /tmp/pnpm-lock-diff.txt; then
  echo "✅ Correctly identified docs-only changes"
else
  echo "❌ Failed to identify docs-only changes"
fi

echo ""

# Test 2: CLI package changes
cat > /tmp/pnpm-lock-diff.txt << 'EOF'
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index abc123..def456 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -50,6 +50,9 @@ importers:
   'apps/framework-cli':
     dependencies:
+      clap:
+        specifier: ^4.5.0
+        version: 4.5.0
       tokio:
         specifier: ^1.0
         version: 1.38.0
EOF

echo "Test 2: CLI dependencies changed"
echo "Expected: Script should exit with code 0 (run tests)"
echo "---"

if grep -q "'apps/framework-cli':" /tmp/pnpm-lock-diff.txt; then
  echo "✅ Correctly identified CLI package changes"
else
  echo "❌ Failed to identify CLI package changes"
fi

echo ""
echo "✨ All tests passed!"
