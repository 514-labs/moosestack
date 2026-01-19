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

# Test 6: Catalog changes that only affect docs (should skip - exit 1)
# Note: Line numbers in diff hunks must match the mock lockfile structure
# In this lockfile: importers starts at line 9, apps/framework-docs-v2 at line 14, packages at line 50
cat > "$PNPM_DIFF_FILE" << 'EOF'
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index abc123..def456 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -3,0 +4,3 @@ catalogs:
+    github-slugger:
+      specifier: 2.0.0
+      version: 2.0.0
@@ -16,0 +20,3 @@ importers:
+      github-slugger:
+        specifier: 'catalog:'
+        version: 2.0.0
EOF

# Create a realistic lockfile for this test - line numbers must be consistent with diff
export PNPM_LOCKFILE="/tmp/test-lockfile-6.yaml"
cat > "$PNPM_LOCKFILE" << 'EOF'
lockfileVersion: '9.0'

catalogs:
  default:
    github-slugger:
      specifier: 2.0.0
      version: 2.0.0

importers:

  .:
    dependencies: {}

  apps/framework-docs-v2:
    dependencies:
      github-slugger:
        specifier: 'catalog:'
        version: 2.0.0
      next:
        specifier: ^16.0.0
        version: 16.0.7
      react:
        specifier: ^18.0.0
        version: 18.2.0
      react-dom:
        specifier: ^18.0.0
        version: 18.2.0
      tailwindcss:
        specifier: ^3.0.0
        version: 3.4.0
      some-other-dep:
        specifier: ^1.0.0
        version: 1.0.0
      another-dep:
        specifier: ^2.0.0
        version: 2.0.0
      yet-another:
        specifier: ^3.0.0
        version: 3.0.0
      more-deps:
        specifier: ^4.0.0
        version: 4.0.0
      even-more:
        specifier: ^5.0.0
        version: 5.0.0

packages:

  github-slugger@2.0.0:
    resolution: {integrity: sha512-abc}
EOF

echo "Test 6: Catalog changes affecting only docs package"
echo "Expected: exit 1 (skip tests)"
echo "---"

set +e
"$DETECTOR_SCRIPT" > /dev/null 2>&1
exit_code=$?
set -e

if [ "$exit_code" -eq 1 ]; then
  echo "✅ Correctly identified catalog change only affects docs (exit 1)"
else
  echo "❌ Failed: Script returned exit $exit_code but expected exit 1 (skip tests)"
  exit 1
fi

unset PNPM_LOCKFILE
echo ""

# Test 7: Catalog changes that affect CLI packages (should run - exit 0)
# In this lockfile: importers at line 9, packages/ts-moose-lib at line 14, packages at line 20
cat > "$PNPM_DIFF_FILE" << 'EOF'
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index abc123..def456 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -3,0 +4,3 @@ catalogs:
+    typescript:
+      specifier: 5.0.0
+      version: 5.0.0
@@ -15,0 +18,3 @@ importers:
+      typescript:
+        specifier: 'catalog:'
+        version: 5.0.0
EOF

# Create a realistic lockfile for this test - line numbers must match diff
export PNPM_LOCKFILE="/tmp/test-lockfile-7.yaml"
cat > "$PNPM_LOCKFILE" << 'EOF'
lockfileVersion: '9.0'

catalogs:
  default:
    typescript:
      specifier: 5.0.0
      version: 5.0.0

importers:

  .:
    dependencies: {}

  packages/ts-moose-lib:
    dependencies:
      typescript:
        specifier: 'catalog:'
        version: 5.0.0

packages:

  typescript@5.0.0:
    resolution: {integrity: sha512-abc}
EOF

echo "Test 7: Catalog changes affecting CLI package (ts-moose-lib)"
echo "Expected: exit 0 (run tests)"
echo "---"

set +e
"$DETECTOR_SCRIPT" > /dev/null 2>&1
exit_code=$?
set -e

if [ "$exit_code" -eq 0 ]; then
  echo "✅ Correctly identified catalog change affects CLI package (exit 0)"
else
  echo "❌ Failed: Script returned exit $exit_code but expected exit 0"
  exit 1
fi

unset PNPM_LOCKFILE
echo ""

# Test 8: Only packages section changed (transitive deps) - should skip
# In this lockfile: importers at line 7, packages at line 17
# Diff shows changes starting at line 20, which is in packages section
cat > "$PNPM_DIFF_FILE" << 'EOF'
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index abc123..def456 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -19,0 +20 @@ packages:
+    libc: [musl]
@@ -24,0 +26 @@ packages:
+    libc: [glibc]
EOF

# Create a realistic lockfile for this test - line numbers must match diff
export PNPM_LOCKFILE="/tmp/test-lockfile-8.yaml"
cat > "$PNPM_LOCKFILE" << 'EOF'
lockfileVersion: '9.0'

catalogs:
  default: {}

importers:

  .:
    dependencies: {}

  apps/framework-docs-v2:
    dependencies:
      next:
        specifier: ^16.0.0
        version: 16.0.7

packages:

  '@biomejs/cli-linux-arm64@2.3.6':
    resolution: {integrity: sha512-abc}
    engines: {node: '>=14.21.3'}
    cpu: [arm64]
    os: [linux]
    libc: [musl]
EOF

echo "Test 8: Only packages section changed (transitive deps, no importers)"
echo "Expected: exit 1 (skip tests)"
echo "---"

set +e
"$DETECTOR_SCRIPT" > /dev/null 2>&1
exit_code=$?
set -e

if [ "$exit_code" -eq 1 ]; then
  echo "✅ Correctly identified packages-only change (exit 1)"
else
  echo "❌ Failed: Script returned exit $exit_code but expected exit 1 (skip tests)"
  exit 1
fi

unset PNPM_LOCKFILE
echo ""

# Test 9: Real-world format with unquoted package names (modern pnpm-lock format)
# In this lockfile: importers at line 9, apps/framework-docs-v2 at line 16, packages at line 30
cat > "$PNPM_DIFF_FILE" << 'EOF'
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index abc123..def456 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -19,0 +20,3 @@ importers:
       flags:
         specifier: ^4.0.2
         version: 4.0.2
+      github-slugger:
+        specifier: 'catalog:'
+        version: 2.0.0
       gray-matter:
         specifier: ^4.0.3
EOF

# Create a realistic lockfile matching the real format - line numbers must match diff
export PNPM_LOCKFILE="/tmp/test-lockfile-9.yaml"
cat > "$PNPM_LOCKFILE" << 'EOF'
lockfileVersion: '9.0'

catalogs:
  default:
    github-slugger:
      specifier: 2.0.0
      version: 2.0.0

importers:

  .:
    devDependencies:
      turbo:
        specifier: ^2.5.5
        version: 2.6.0

  apps/framework-docs-v2:
    dependencies:
      flags:
        specifier: ^4.0.2
        version: 4.0.2
      github-slugger:
        specifier: 'catalog:'
        version: 2.0.0
      gray-matter:
        specifier: ^4.0.3
        version: 4.0.3

packages:

  github-slugger@2.0.0:
    resolution: {integrity: sha512-abc}
EOF

echo "Test 9: Real-world format - unquoted package names in importers"
echo "Expected: exit 1 (skip tests - only docs changed)"
echo "---"

set +e
"$DETECTOR_SCRIPT" > /dev/null 2>&1
exit_code=$?
set -e

if [ "$exit_code" -eq 1 ]; then
  echo "✅ Correctly handled real-world format with unquoted names (exit 1)"
else
  echo "❌ Failed: Script returned exit $exit_code but expected exit 1 (skip tests)"
  exit 1
fi

unset PNPM_LOCKFILE
echo ""

# Test 10: Unknown package changes (should run tests to be safe)
# In this lockfile: importers at line 7, apps/some-unknown-app at line 12, packages at line 18
cat > "$PNPM_DIFF_FILE" << 'EOF'
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index abc123..def456 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -13,0 +14,3 @@ importers:
+      some-new-dep:
+        specifier: ^1.0.0
+        version: 1.0.0
EOF

# Create a realistic lockfile with an unknown package - line numbers must match diff
export PNPM_LOCKFILE="/tmp/test-lockfile-10.yaml"
cat > "$PNPM_LOCKFILE" << 'EOF'
lockfileVersion: '9.0'

catalogs:
  default: {}

importers:

  .:
    dependencies: {}

  apps/some-unknown-app:
    dependencies:
      some-new-dep:
        specifier: ^1.0.0
        version: 1.0.0

packages:

  some-new-dep@1.0.0:
    resolution: {integrity: sha512-abc}
EOF

echo "Test 10: Unknown package changed (not in CLI or docs list)"
echo "Expected: exit 0 (run tests to be safe)"
echo "---"

set +e
"$DETECTOR_SCRIPT" > /dev/null 2>&1
exit_code=$?
set -e

if [ "$exit_code" -eq 0 ]; then
  echo "✅ Correctly runs tests for unknown package (exit 0)"
else
  echo "❌ Failed: Script returned exit $exit_code but expected exit 0"
  exit 1
fi

unset PNPM_LOCKFILE
echo ""

# Test 11: Docs + unknown package changes (should run tests to be safe)
# In this lockfile: importers at line 6, apps/framework-docs-v2 at line 11, apps/some-unknown-app at line 17, packages at line 23
# Diff hunks at lines 15 (in docs section) and 21 (in unknown-app section)
cat > "$PNPM_DIFF_FILE" << 'EOF'
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index abc123..def456 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -14,0 +15,3 @@ importers:
+      new-docs-dep:
+        specifier: ^1.0.0
+        version: 1.0.0
@@ -20,0 +21,3 @@ importers:
+      some-new-dep:
+        specifier: ^1.0.0
+        version: 1.0.0
EOF

# Create a lockfile with both docs and unknown packages
export PNPM_LOCKFILE="/tmp/test-lockfile-11.yaml"
cat > "$PNPM_LOCKFILE" << 'EOF'
lockfileVersion: '9.0'

catalogs:
  default: {}

importers:

  .:
    dependencies: {}

  apps/framework-docs-v2:
    dependencies:
      new-docs-dep:
        specifier: ^1.0.0
        version: 1.0.0

  apps/some-unknown-app:
    dependencies:
      some-new-dep:
        specifier: ^1.0.0
        version: 1.0.0

packages:

  new-docs-dep@1.0.0:
    resolution: {integrity: sha512-abc}
  some-new-dep@1.0.0:
    resolution: {integrity: sha512-def}
EOF

echo "Test 11: Docs + unknown package changed (should run tests)"
echo "Expected: exit 0 (run tests to be safe - unknown package present)"
echo "---"

set +e
"$DETECTOR_SCRIPT" > /dev/null 2>&1
exit_code=$?
set -e

if [ "$exit_code" -eq 0 ]; then
  echo "✅ Correctly runs tests when docs + unknown package changed (exit 0)"
else
  echo "❌ Failed: Script returned exit $exit_code but expected exit 0"
  exit 1
fi

unset PNPM_LOCKFILE
echo ""

echo "✨ All tests passed!"
