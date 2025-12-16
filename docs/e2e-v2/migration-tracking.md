# E2E Test Migration Tracking

This document tracks the migration from `framework-cli-e2e` to `e2e-v2` test suite.

## Migration Status

| Category | Old Tests | New Tests | Status |
|----------|-----------|-----------|--------|
| CLI Init | `framework-cli-e2e` | `e2e-v2/standalone/cli-init.test.ts` | In Progress |
| Basic Ingestion | `framework-cli-e2e` | `e2e-v2/scenarios/ingest-and-query.test.ts` | In Progress |
| Backward Compat | N/A (new) | `e2e-v2/release-gates/backward-compat.test.ts` | In Progress |

## Reliability Comparison

Track flake rates and test durations during parallel execution phase.

### Flake Rate (target: < 5%)

| Week | Old Suite | New Suite | Notes |
|------|-----------|-----------|-------|
| TBD | ~15-20% | TBD | Initial baseline |

### Total Duration

| Week | Old Suite | New Suite | Notes |
|------|-----------|-----------|-------|
| TBD | ~20-30min | TBD | Initial baseline |

## Migration Phases

### Phase A: Build Infrastructure (Current)
- [x] Extended /ready endpoint with detailed status
- [x] Added `moose ready` CLI command
- [x] Added fixtures loading system

### Phase B: Create e2e-v2 Package (Current)
- [x] Package structure created
- [x] Test runner library implemented
- [x] Capability matching system implemented

### Phase C: Run Parallel (Next)
- [ ] Both test suites running in CI
- [ ] Compare reliability metrics
- [ ] Compare coverage
- [ ] Track flake rates

### Phase D: Sunset Old Tests
- [ ] New suite catches all bugs old suite would catch
- [ ] Flake rate < 5%
- [ ] Total time < old suite time
- [ ] Team confidence established
- [ ] Remove old test suite

## Success Criteria for Phase D

Before sunsetting `framework-cli-e2e`:

1. **Bug Detection Parity**: New suite must catch at least the same bugs
2. **Flake Rate**: < 5% (vs current ~15-20%)
3. **Total Duration**: Less than or equal to old suite
4. **Team Confidence**: Explicit team sign-off that "we trust the new tests"

## Coverage Mapping

Map old test coverage to new scenarios:

| Old Test File | Covered By | Notes |
|---------------|------------|-------|
| TBD | TBD | Will be filled during migration |

## How to Update This Document

1. After adding new scenarios, update the migration status table
2. Weekly during Phase C, update reliability metrics
3. When porting tests, update the coverage mapping
4. When ready to sunset, verify all success criteria

## Commands

```bash
# Run old tests
cd apps/framework-cli-e2e && pnpm test

# Run new tests
cd apps/e2e-v2 && pnpm test

# Run only scenarios
cd apps/e2e-v2 && pnpm test:scenarios

# Run only standalone
cd apps/e2e-v2 && pnpm test:standalone

# Run only release gates
cd apps/e2e-v2 && pnpm test:release-gates
```
