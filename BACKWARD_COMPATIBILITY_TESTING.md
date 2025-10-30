# Backward Compatibility Testing

## Overview

This branch includes a new end-to-end test suite that verifies backward compatibility when upgrading the MooseStack CLI from version n-1 (latest published) to version n (current build).

## What Was Added

### 1. Backward Compatibility Test Suite
**File**: `apps/framework-cli-e2e/test/backward-compatibility.test.ts`

This test suite:
- Initializes projects using the **latest published CLI** from npm/pypi
- Starts the project with `moose dev` to create infrastructure
- Stops the project
- Runs `moose plan` with the **new CLI** from the current build
- Asserts that no breaking changes are detected

The test runs for both:
- TypeScript tests template
- Python tests template

### 2. Documentation
**File**: `apps/framework-cli-e2e/BACKWARD_COMPATIBILITY_TEST.md`

Detailed documentation about:
- What the test does
- How to run it
- Expected behavior
- How to debug failures

## Why This Test Is Important

This test catches **breaking changes in infrastructure map format**, particularly:

### The Problem This Branch Fixes
This branch changes how table IDs are generated in the infrastructure map:
- **Old format**: `"TableName_1_0_0"`
- **New format**: `"local_db_TableName_1_0_0"` (includes database prefix)

Without backward compatibility, upgrading would cause:
- ❌ Existing tables not recognized (seen as "missing")
- ❌ New tables created with same name (data duplication)
- ❌ Old tables dropped (data loss)

### The Solution
The code includes migration logic in:
- `apps/framework-cli/src/framework/core/plan.rs` - Fixes up old IDs during reconciliation
- `apps/framework-cli/src/framework/core/infra_reality_checker.rs` - Finds tables with old or new ID format
- `apps/framework-cli/src/framework/core/infrastructure_map.rs` - Handles both ID formats in diffs

The backward compatibility test **verifies** that this migration logic works correctly.

## Running the Tests

```bash
# From repository root
cd apps/framework-cli-e2e
pnpm test -- --grep "Backward Compatibility"
```

The `pretest` script automatically builds the CLI and packages before running tests.

### Run Specific Language
```bash
# TypeScript only
pnpm test -- --grep "TypeScript.*Backward Compatibility"

# Python only  
pnpm test -- --grep "Python.*Backward Compatibility"
```

## Expected Output

### Success (Backward Compatible)
```
✅ No changes detected - backward compatibility verified!
```

### Failure (Breaking Change)
```
Error: Unexpected table drop detected in plan output.
This indicates a backward incompatible change:

DROP TABLE local_db_TableName_1_0_0
```

or

```
Error: Unexpected table creation detected in plan output.
This indicates tables weren't recognized:

CREATE TABLE local_db_TableName_1_0_0 (...)
```

## Test Timeouts

The test has extended timeouts because it:
- Downloads the latest CLI via `npx` (network I/O)
- Starts full infrastructure twice (Docker, ClickHouse, Kafka)
- Installs dependencies twice (npm/pip)

**Typical runtime**: 3-5 minutes per language template

## CI Integration

This test should be run:
- ✅ On PRs that modify infrastructure code
- ✅ Before releasing new versions
- ✅ Regularly on main branch

## Debugging

If the test fails, see the detailed debugging guide in:
`apps/framework-cli-e2e/BACKWARD_COMPATIBILITY_TEST.md`

## Files Modified/Added

```
apps/framework-cli-e2e/
├── test/
│   └── backward-compatibility.test.ts    (NEW - Test suite)
├── BACKWARD_COMPATIBILITY_TEST.md        (NEW - Detailed docs)

BACKWARD_COMPATIBILITY_TESTING.md        (NEW - This file)
```

## Related Changes

This test is specifically designed to verify the infrastructure map migration changes in:
- `infrastructure_map.rs` - Table ID format changes
- `plan.rs` - Reconciliation with old format
- `infra_reality_checker.rs` - Finding tables with either format
- `infrastructure_map.proto` - Added default_database field

## Future Improvements

Potential enhancements:
1. Test more infrastructure components (topics, APIs, etc.)
2. Test upgrades across multiple versions (n-2 → n-1 → n)
3. Add rollback testing (n → n-1)
4. Cache the published CLI to speed up test runs
5. Add to CI pipeline as a required check

