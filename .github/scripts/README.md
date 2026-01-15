# CI/CD Scripts

This directory contains scripts used by GitHub Actions workflows to optimize CI/CD execution.

## check-cli-dependencies.sh

**Purpose**: Intelligently detect if `pnpm-lock.yaml` changes affect CLI packages, avoiding unnecessary test runs when only docs dependencies change.

### How It Works

1. **Checks if pnpm-lock.yaml changed**: If not, exits immediately
2. **Analyzes the diff**: Parses the pnpm-lock.yaml diff to see which packages were affected
3. **Determines impact**:
   - If CLI-related packages changed → Tests should run (exit 0)
   - If only docs packages changed → Tests can be skipped (exit 1)
   - If unsure → Tests should run for safety (exit 0)

### CLI-Related Packages

These packages trigger CLI tests when their dependencies change:
- `apps/framework-cli`
- `apps/framework-cli-e2e`
- `packages/ts-moose-lib`
- `packages/py-moose-lib`
- `templates/typescript`
- `templates/python`

### Docs-Only Packages

These packages can change without triggering CLI tests:
- `apps/framework-docs-v2`
- `packages/design-system`

### Exit Codes

- **0**: CLI tests should run (changes affect CLI)
- **1**: CLI tests can be skipped (changes don't affect CLI)

### Usage in CI/CD

The script is called automatically by `.github/workflows/test-framework-cli.yaml` when only `pnpm-lock.yaml` has changed:

```yaml
elif grep -q "pnpm-lock.yaml" changes.txt; then
  if .github/scripts/check-cli-dependencies.sh; then
    echo "should_run=true" >> $GITHUB_OUTPUT
  else
    echo "should_run=false" >> $GITHUB_OUTPUT
  fi
```

### Testing

Run the test suite to verify the logic:

```bash
.github/scripts/test-check-cli-dependencies.sh
```

### Debugging

To manually test the script on your branch:

```bash
# Ensure you're on your feature branch
git fetch origin main:main

# Run the script
.github/scripts/check-cli-dependencies.sh

# Check exit code
echo $?  # 0 = run tests, 1 = skip tests
```

## Benefits

- **Faster CI/CD**: Docs dependency changes no longer trigger expensive CLI test suites
- **Cost Savings**: Fewer unnecessary CI minutes used
- **Clear Feedback**: CI logs show why tests were run or skipped
- **Safe Defaults**: When unsure, always runs tests to avoid false negatives
