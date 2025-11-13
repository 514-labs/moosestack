# Proptest Findings

This document tracks all issues discovered through property-based testing with proptest. Each finding will eventually be converted into a Linear ticket for tracking and resolution.

## Purpose

This file tracks bugs discovered by proptest to enable organizing fixes into separate jj changes:
- **Change 1**: Test infrastructure (proptest setup, generators, property tests)
- **Change 2+**: Individual bug fixes (one change per bug)

Each bug has a corresponding `#[ignore]` test case in the code that will be enabled when the bug is fixed.

## Table of Contents
- [ClickHouse Type Parser](#clickhouse-type-parser)
- [SQL Parser](#sql-parser)
- [String Parsers](#string-parsers)
- [Summary Statistics](#summary-statistics)

---

## ClickHouse Type Parser

Issues found in `apps/framework-cli/src/infrastructure/olap/clickhouse/type_parser.rs`

### Status Legend
- 🔴 **Critical**: Causes crashes, data corruption, or security issues
- 🟡 **High**: Incorrect parsing/serialization, affects functionality
- 🟢 **Medium**: Edge cases, minor inconsistencies
- ⚪ **Low**: Documentation, optimization opportunities

### Issue #1: JSON Type with Empty Parameters Fails Roundtrip ✅ FIXED

**Severity**: 🟡 High
**Parser**: ClickHouse Type Parser
**Date Found**: 2025-11-12
**Date Fixed**: 2025-11-12
**Status**: ✅ **RESOLVED**

**Failing Input** (minimized by proptest):
```rust
ClickHouseTypeNode::JSON(Some([]))
```

**Original Problem**:
- Serialization: `JSON(Some([]))` → `"JSON"`
- Parsing: `"JSON"` → `JSON(None)`
- Result: `JSON(Some([])) != JSON(None)` ✗ (roundtrip failed)

**Fix Applied**:
Implemented **Option C**: Custom `PartialEq` implementation that treats `JSON(Some([]))` and `JSON(None)` as semantically equivalent.

**Implementation** (type_parser.rs:342-382):
```rust
impl PartialEq for ClickHouseTypeNode {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            // Normalize JSON(Some([])) to JSON(None) for comparison
            (Self::JSON(Some(params1)), Self::JSON(Some(params2))) if params1.is_empty() && params2.is_empty() => true,
            (Self::JSON(Some(params)), Self::JSON(None)) | (Self::JSON(None), Self::JSON(Some(params))) if params.is_empty() => true,
            // ... rest of equality checks
        }
    }
}
```

**Verification**:
- ✅ `test_regression_json_empty_params_roundtrip()` passes
- ✅ `test_roundtrip_property()` passes with 1000 test cases
- ✅ All other type parser tests pass

**Linear Ticket**: [To be created]

---

## SQL Parser

Issues found in `apps/framework-cli/src/infrastructure/olap/clickhouse/sql_parser.rs`

---

**✅ All tests passed! No issues found.**

The SQL parser's manual extraction functions (`extract_engine_from_create_table`, `extract_table_settings_from_create_table`, `extract_sample_by_from_create_table`, `extract_indexes_from_create_table`) handle edge cases correctly:
- No panics on arbitrary strings
- Correct nested parentheses handling
- Proper string escape handling
- Keyword termination works as expected

---

## String Parsers

Issues found in:
- `apps/framework-cli/src/framework/versions.rs`
- `apps/framework-cli/src/framework/scripts/utils.rs`
- Other string parsing functions

### Issue #2: parse_timeout_to_seconds Panics on Multi-byte UTF-8 Characters ✅ FIXED

**Severity**: 🔴 Critical
**Parser**: `parse_timeout_to_seconds` in `apps/framework-cli/src/framework/scripts/utils.rs`
**Date Found**: 2025-11-12
**Date Fixed**: 2025-11-12
**Status**: ✅ **RESOLVED**

**Failing Input** (minimized by proptest):
```rust
parse_timeout_to_seconds("®")  // Previously panicked!
```

**Original Problem**:
- Function used byte-level `.split_at(timeout.len() - 1)`
- For multi-byte UTF-8 like "®" (2 bytes), this tried to split in the middle of the character
- Result: **Panic** with "byte index 1 is not a char boundary"

**Fix Applied**:
Implemented **character-aware string slicing** using `.chars().last()` and `.len_utf8()`.

**Implementation** (utils.rs:60-67):
```rust
// Use character-aware slicing to handle multi-byte UTF-8 characters correctly
let unit_char = timeout
    .chars()
    .last()
    .ok_or_else(|| TemporalExecutionError::TimeoutError("Timeout string is empty".to_string()))?;

// Get the byte index where the last character starts
let value_str = &timeout[..timeout.len() - unit_char.len_utf8()];
```

**Why This Works**:
- `.chars().last()` correctly extracts the last Unicode character
- `.len_utf8()` returns the correct byte length of that character (1-4 bytes)
- Slicing is done at proper UTF-8 boundaries, never in the middle of a character

**Verification**:
- ✅ `test_regression_timeout_multibyte_utf8()` passes (tests "®" specifically)
- ✅ `test_parse_timeout_never_panics()` passes with 1000 arbitrary UTF-8 strings
- ✅ `test_timeout_valid_formats()` passes (ensures valid inputs still work)
- ✅ No panics on any input, only proper errors

**Impact Resolution**:
- ✅ No more panics on multi-byte UTF-8 input
- ✅ Function now safely returns errors for invalid input
- ✅ Follows Rust error handling best practices

**Linear Ticket**: [To be created]

---

### Version Parser Results

**✅ All tests passed! No issues found.**

The version parser (`parse_version`, `version_to_string`, `Version` type) handles edge cases correctly:
- No panics on arbitrary strings
- Roundtrip property holds
- Comparison is consistent
- `as_suffix` works correctly

### Schedule Parser Results

**✅ All tests passed! No issues found.**

The schedule parser (`parse_schedule`) handles edge cases correctly:
- No panics on arbitrary strings
- Minute/hour formats produce correct cron expressions
- Cron expressions are preserved

---

## Summary Statistics

| Parser | Tests Run | Issues Found | Fixed | Critical | High | Medium | Low |
|--------|-----------|--------------|-------|----------|------|--------|-----|
| ClickHouse Type Parser | 5 tests | 1 | ✅ 1 | 0 | 0 | 0 | 0 |
| SQL Parser | 7 tests | 0 | - | 0 | 0 | 0 | 0 |
| String Parsers | 12 tests | 1 | ✅ 1 | 0 | 0 | 0 | 0 |
| **Total** | **24 tests** | **2** | **✅ 2** | **0** | **0** | **0** | **0** |

**All discovered bugs have been fixed! 🎉**

---

## Finding Template

Use this template when documenting new findings:

```markdown
### Issue #N: [Brief Description]

**Severity**: 🔴/🟡/🟢/⚪
**Parser**: [Parser name]
**Date Found**: YYYY-MM-DD

**Failing Input** (minimized by proptest):
\`\`\`
[minimal failing test case]
\`\`\`

**Expected Behavior**:
[What should happen]

**Actual Behavior**:
[What actually happens]

**Reproduction**:
\`\`\`rust
// Minimal test case to reproduce
\`\`\`

**Impact**:
[How this affects users/system]

**Proposed Fix**:
[Brief description of potential solution]

**Linear Ticket**: [To be created]
```

---

## Notes

- All findings are discovered through automated property-based testing
- Proptest automatically minimizes failing test cases to their simplest form
- Tests are configured in `apps/framework-cli/proptest.toml`
- Test code is colocated with parser implementations in their respective files
