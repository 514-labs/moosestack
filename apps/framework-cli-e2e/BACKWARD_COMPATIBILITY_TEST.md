# Backward Compatibility Test

This test verifies that upgrading from the latest published version (n-1) to the current build (n) does not break existing deployments.

## What It Tests

The backward compatibility test:

1. **Initializes projects** using the latest published CLI from npm/pypi
2. **Starts the project** with `moose dev` to create infrastructure (tables, topics, etc.)
3. **Stops the project** and infrastructure
4. **Runs `moose plan`** with the NEW CLI from the current build
5. **Asserts** that no breaking changes are detected (no table drops/recreations)

This catches issues like:
- Infrastructure map format changes (e.g., table ID changes)
- Schema migration incompatibilities
- Breaking changes in how infrastructure is tracked

## Running the Test

### Prerequisites

- Internet connection (to download latest published CLI)

The `pretest` script automatically builds the CLI and packages.

### Run the Test

```bash
# From the e2e directory
cd apps/framework-cli-e2e

# Run just the backward compatibility test
pnpm test -- --grep "Backward Compatibility"
```

### Run for Specific Language

```bash
# TypeScript only
pnpm test -- --grep "TypeScript.*Backward Compatibility"

# Python only
pnpm test -- --grep "Python.*Backward Compatibility"
```

## Expected Behavior

### Success Case

The test should complete with:
```
✅ No changes detected - backward compatibility verified!
```

This means the infrastructure map from version n-1 is fully compatible with version n.

### Acceptable Minor Changes

Some minor changes may be acceptable, such as:
- Metadata updates
- Non-structural configuration changes

The test will log these but not fail.

### Failure Cases

The test will FAIL if it detects:

1. **Table drops**: `DROP TABLE` commands indicate tables from n-1 aren't recognized
2. **Table recreations**: `CREATE TABLE` for existing tables means ID/name mismatches
3. **Structural changes**: `ALTER TABLE ADD/DROP/MODIFY COLUMN` indicates schema incompatibility

## Debugging Failures

If the test fails:

1. **Check the plan output**: The test prints the full `moose plan` output
2. **Review table IDs**: Look for changes in how tables are identified (e.g., database prefix)
3. **Check infrastructure map**: The test creates a temp directory with the full project state
4. **Run manually**:
   ```bash
   # Initialize with latest published version
   npx -y @514labs/moose-cli@latest init test-app typescript-tests --location /tmp/compat-test
   cd /tmp/compat-test
   npm install
   
   # Start with latest version
   npx -y @514labs/moose-cli@latest dev
   # (wait for startup, then Ctrl+C to stop)
   
   # Run plan with your new build
   /path/to/moose/target/debug/moose-cli plan
   ```

## CI Integration

This test should be run:
- On all PRs that touch infrastructure code
- Before releasing new versions
- Regularly on main branch

## Timeout Configuration

The test has extended timeouts because it:
- Downloads the latest CLI via npx (can be slow)
- Starts full infrastructure twice (once with old CLI, verification with new)
- Installs dependencies twice

Typical runtime: 3-5 minutes per language template.

