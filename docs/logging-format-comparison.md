# Logging Format Comparison: fern vs tracing

This document compares the current `fern` logging formats with `tracing-subscriber` built-in formats.

## Current Formats (fern)

### Text Format
```
[{timestamp} {level}{session_id} - {target}] {message}
```

**Example:**
```
[2025-11-14T10:30:45Z INFO abc123 - moose_cli::cli::dev] Starting development server
[2025-11-14T10:30:46Z WARN abc123 - moose_cli::infrastructure::clickhouse] Connection timeout, retrying
```

**Format details:**
- Timestamp: RFC3339 seconds format (no microseconds)
- Level: DEBUG, INFO, WARN, ERROR
- Session ID: Optional, included when `include_session_id: true`
- Target: Module path (e.g., `moose_cli::cli::dev`)
- Message: The log message

### JSON Format
```json
{
  "timestamp": "2025-11-14T10:30:45+00:00",
  "severity": "INFO",
  "target": "moose_cli::cli::dev",
  "message": "Starting development server",
  "session_id": "abc123"
}
```

**Format details:**
- Timestamp: ISO 8601 / RFC3339 format with timezone
- Severity: Log level as string
- Target: Module path
- Message: Flat field at root level
- Session ID: Optional field at root level

## Tracing-Subscriber Built-in Formats

### Compact Text Format (`format::compact()`)
```
2025-11-14T10:30:45.123456Z  INFO moose_cli::cli::dev: Starting development server
2025-11-14T10:30:46.789012Z  WARN moose_cli::infrastructure::clickhouse: Connection timeout, retrying
```

**Format details:**
- Timestamp: RFC3339 with microseconds
- Level: DEBUG, INFO, WARN, ERROR
- Target: Module path
- Message: After colon separator
- No brackets, more compact

### JSON Format (`format::json()`)
```json
{
  "timestamp": "2025-11-14T10:30:45.123456Z",
  "level": "INFO",
  "target": "moose_cli::cli::dev",
  "fields": {
    "message": "Starting development server"
  },
  "span": {
    "name": "dev_command"
  }
}
```

**Format details:**
- Timestamp: RFC3339 with microseconds
- Level: "level" instead of "severity"
- Fields: Nested under "fields" object
- Span: Includes span information if events occur within spans
- Extensible structure for additional metadata

### Pretty Format (`format::pretty()`)
```
  2025-11-14T10:30:45.123456Z  INFO moose_cli::cli::dev
    Starting development server

  2025-11-14T10:30:46.789012Z  WARN moose_cli::infrastructure::clickhouse
    Connection timeout, retrying
      at apps/framework-cli/src/infrastructure/clickhouse.rs:145
```

**Format details:**
- Multi-line format with indentation
- Includes file/line information
- More readable for development
- Takes more vertical space

## Key Differences

### Text Format
| Aspect | fern (current) | tracing compact | tracing pretty |
|--------|----------------|-----------------|----------------|
| Brackets | Yes `[...]` | No | No |
| Timestamp precision | Seconds | Microseconds | Microseconds |
| Session ID | Optional inline | Would need custom layer | Would need custom layer |
| File location | No | No | Yes |
| Multi-line | No | No | Yes |

### JSON Format
| Aspect | fern (current) | tracing json |
|--------|----------------|--------------|
| Level field name | "severity" | "level" |
| Message location | Root level | Nested in "fields" |
| Timestamp precision | Milliseconds | Microseconds |
| Session ID | Optional at root | Would need custom field |
| Span info | No | Yes (when applicable) |
| Extensibility | Limited | Highly extensible |

## Recommendation

**For JSON:** Use `format::json()` - It's more standard, better structured, and extensible. The structure change is an improvement (nested fields allow for richer metadata).

**For Text:** Two options:
1. **Use `format::compact()`** - Simpler, well-maintained, slightly different look but all same info
2. **Custom formatter** - Match exact current format by implementing `FormatEvent` trait

**For Session/Machine ID:**
- Add as custom fields via `Registry::with()` layers
- Example: Add a layer that injects session_id and machine_id into every event

## Migration Impact

### Low Impact (users likely won't care)
- Timestamp precision (microseconds vs seconds)
- Bracket style in text format
- JSON structure changes (if using format::json)

### Medium Impact (might need communication)
- JSON field names changing ("severity" → "level", flat message → "fields.message")
- Log parsers/aggregators might need updates

### High Impact (requires careful handling)
- If external systems parse the exact format
- If log format is part of API/contract

## Decision Point

Do you want to:
1. **Use tracing built-ins** (`format::compact()` + `format::json()`) with custom fields for session/machine ID?
2. **Match current format exactly** by implementing custom `FormatEvent` for both text and JSON?

Option 1 is simpler and gives you better tooling/ecosystem support.
Option 2 gives you zero user-facing changes but more maintenance burden.
