# Tracing Migration Design: fern → tracing-subscriber

**Date**: 2025-11-14
**Author**: Claude & Lucio Franco
**Status**: Approved for Implementation
**Linear Issue**: [ENG-1270](https://linear.app/514/issue/ENG-1270)

## Executive Summary

Migrate the Moose CLI logging infrastructure from `fern` to `tracing-subscriber` to enable dynamic log filtering via `RUST_LOG` environment variable. The migration will maintain backward compatibility through dual format support, allowing a gradual transition without breaking existing log consumers (Boreal/hosting_telemetry).

## Goals

### Primary Goals
1. Enable `RUST_LOG` environment variable support for module-level filtering
2. Maintain 100% backward compatibility with existing log format
3. Preserve all current features: date rotation, cleanup, OTEL export, session/machine IDs
4. Convert all 91 files using `log::` macros to `tracing::` macros

### Secondary Goals
1. Provide opt-in path to modern tracing format via env var
2. Set foundation for future structured logging with spans
3. Improve maintainability by using standard ecosystem tools

## Current State Analysis

### Current Implementation (fern)
- **91 files** using `log::` macros (~236 log statements)
- **Configuration**: `apps/framework-cli/src/cli/logger.rs` (351 lines)
- **Dependencies**: `fern` v0.7, `log` v0.4, `opentelemetry-appender-log` v0.29

### Features to Preserve
1. **Date-based file rotation**: `~/.moose/YYYY-MM-DD-cli.log`
2. **7-day automatic cleanup**: Delete logs older than 7 days
3. **Dual format support**: Text (human-readable) and JSON (structured)
4. **Session ID tracking**: Optional per-session identifier
5. **Machine ID tracking**: Included in every log
6. **OpenTelemetry export**: Optional OTLP/HTTP JSON export
7. **Configurable outputs**: File and/or stdout
8. **Configurable levels**: DEBUG, INFO, WARN, ERROR

### Critical Dependencies (Boreal)

The hosting_telemetry system in `~/code/commercial` depends on exact JSON format:

**Required JSON Fields:**
```json
{
  "timestamp": "2025-11-14T10:30:45+00:00",
  "severity": "INFO",
  "target": "moose_cli::cli::dev",
  "message": "Starting development server",
  "session_id": "abc123"
}
```

**Breaking changes if we use `format::json()`:**
- `"severity"` → `"level"` (field name change)
- `"message"` at root → nested in `"fields.message"`
- Structure becomes incompatible with current parsers

## Architecture Design

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Application Code                       │
│              (tracing::info!, tracing::warn!)           │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              tracing-subscriber::Registry                │
│                  (coordinator layer)                     │
└────────┬────────────────────────────────────────────────┘
         │
         ├──────────────────────────────────────────────────┐
         │                                                   │
         ▼                                                   ▼
┌────────────────────┐                          ┌──────────────────────┐
│   EnvFilter Layer  │                          │  Custom Fields Layer │
│  (RUST_LOG support)│                          │ (session_id, machine)│
└────────┬───────────┘                          └──────────┬───────────┘
         │                                                   │
         └─────────────────┬─────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────────┐
              │  Format Selection Layer    │
              │ (USE_TRACING_FORMAT check) │
              └────────┬───────────────────┘
                       │
         ┌─────────────┴──────────────┐
         │                            │
         ▼                            ▼
┌─────────────────┐          ┌─────────────────┐
│ Legacy Formatter│          │Modern Formatter │
│  (match fern)   │          │(tracing native) │
└────────┬────────┘          └────────┬────────┘
         │                            │
         └─────────────┬──────────────┘
                       │
         ┌─────────────┴──────────────┐
         │                            │
         ▼                            ▼
┌─────────────────┐          ┌─────────────────┐
│  File Appender  │          │ Stdout Appender │
│ (date rotation) │          │   (optional)    │
└─────────────────┘          └─────────────────┘
         │
         └──────────────┐
                        │
                        ▼
               ┌─────────────────┐
               │  OTEL Exporter  │
               │   (optional)    │
               └─────────────────┘
```

### Layer Responsibilities

**1. Registry**
- Base coordinator for all layers
- Standard `tracing-subscriber::Registry`

**2. EnvFilter Layer**
- Reads `RUST_LOG` environment variable
- Provides module-level filtering (e.g., `RUST_LOG=moose_cli::infrastructure=debug`)
- Falls back to configured level if `RUST_LOG` not set

**3. Custom Fields Layer**
- Injects `session_id` and `machine_id` into every event
- Makes these fields available to all formatters
- Implemented as custom `Layer<S>` trait

**4. Format Selection Layer**
- Checks `MOOSE_LOGGER__USE_TRACING_FORMAT` environment variable
- Routes to either legacy or modern formatter
- Both paths share same custom fields

**5. Legacy Formatter**
- Custom `Layer<S>` implementation
- Matches current fern output exactly
- Supports Text and JSON formats
- Ensures Boreal compatibility

**6. Modern Formatter**
- Uses `tracing-subscriber::fmt` layer
- `format::compact()` for text
- `format::json()` for JSON
- Future-proof format

**7. File Appender**
- `tracing_appender::rolling::RollingFileAppender`
- `Rotation::DAILY` for date-based files
- Outputs to `~/.moose/`

**8. OTEL Exporter**
- `tracing-opentelemetry::OpenTelemetryLayer`
- OTLP/HTTP JSON protocol
- Includes resource attributes from `MOOSE_METRIC__LABELS`

## Implementation Details

### Dependency Changes

**Remove from Cargo.toml:**
```toml
fern = { version = "0.7", features = ["date-based"] }
log = "0.4"
opentelemetry-appender-log = "0.29"
```

**Add to Cargo.toml:**
```toml
tracing = "0.1.40"  # Already present
tracing-subscriber = { version = "0.3", features = ["env-filter", "json", "fmt"] }
tracing-appender = "0.2"
tracing-opentelemetry = "0.29"
```

### Configuration Changes

**Extend LoggerSettings:**
```rust
#[derive(Deserialize, Debug, Clone)]
pub struct LoggerSettings {
    #[serde(default = "default_log_file")]
    pub log_file_date_format: String,

    #[serde(default = "default_log_level")]
    pub level: LoggerLevel,

    #[serde(default = "default_log_stdout")]
    pub stdout: bool,

    #[serde(default = "default_log_format")]
    pub format: LogFormat,

    #[serde(deserialize_with = "parsing_url", default = "Option::default")]
    pub export_to: Option<Uri>,

    #[serde(default = "default_include_session_id")]
    pub include_session_id: bool,

    // NEW FIELD
    #[serde(default = "default_use_tracing_format")]
    pub use_tracing_format: bool,
}

fn default_use_tracing_format() -> bool {
    env::var("MOOSE_LOGGER__USE_TRACING_FORMAT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(false)  // Default to legacy for backward compat
}
```

### Core setup_logging() Implementation

```rust
pub fn setup_logging(
    settings: &LoggerSettings,
    machine_id: &str
) -> Result<(), LoggerError> {
    clean_old_logs();  // Keep existing function

    let session_id = CONTEXT.get(CTX_SESSION_ID).unwrap();

    // 1. Create base registry
    let registry = tracing_subscriber::registry();

    // 2. Add EnvFilter for RUST_LOG support
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| {
            EnvFilter::new(settings.level.to_tracing_level())
        });
    let registry = registry.with(env_filter);

    // 3. Add custom fields layer (session_id, machine_id)
    let custom_fields = CustomFieldsLayer::new(
        session_id.to_string(),
        machine_id.to_string()
    );
    let registry = registry.with(custom_fields);

    // 4. Create writer (file or stdout)
    let writer = if settings.stdout {
        MakeWriterExt::and(std::io::stdout)
    } else {
        let file_appender = tracing_appender::rolling::RollingFileAppender::new(
            tracing_appender::rolling::Rotation::DAILY,
            user_directory(),
            "cli.log"
        );
        MakeWriterExt::and(file_appender)
    };

    // 5. Add format layer (legacy or modern)
    let registry = if settings.use_tracing_format {
        // Modern format using tracing built-ins
        let format_layer = tracing_subscriber::fmt::layer()
            .with_writer(writer)
            .with_target(true)
            .with_level(true);

        let format_layer = if settings.format == LogFormat::Json {
            format_layer.json().boxed()
        } else {
            format_layer.compact().boxed()
        };

        registry.with(format_layer)
    } else {
        // Legacy format matching fern exactly
        let legacy_layer = LegacyFormatLayer::new(
            writer,
            settings.format.clone(),
            settings.include_session_id,
        );
        registry.with(legacy_layer)
    };

    // 6. Add OTEL layer if configured
    let registry = if let Some(endpoint) = &settings.export_to {
        let otel_layer = create_otel_layer(
            endpoint,
            session_id,
            machine_id,
            settings.level.to_tracing_level()
        )?;
        registry.with(otel_layer)
    } else {
        registry
    };

    // 7. Set as global default
    tracing::subscriber::set_global_default(registry)?;

    Ok(())
}
```

### Custom Layers

**CustomFieldsLayer** - Injects session/machine ID:
```rust
struct CustomFieldsLayer {
    session_id: String,
    machine_id: String,
}

impl CustomFieldsLayer {
    fn new(session_id: String, machine_id: String) -> Self {
        Self { session_id, machine_id }
    }
}

impl<S> Layer<S> for CustomFieldsLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_event(&self, event: &Event<'_>, ctx: Context<'_, S>) {
        // Store fields in extensions for formatters to access
        let mut extensions = ctx.extensions_mut();
        extensions.insert(CustomFields {
            session_id: self.session_id.clone(),
            machine_id: self.machine_id.clone(),
        });
    }
}

struct CustomFields {
    session_id: String,
    machine_id: String,
}
```

**LegacyFormatLayer** - Matches fern format exactly:
```rust
struct LegacyFormatLayer<W> {
    writer: W,
    format: LogFormat,
    include_session_id: bool,
}

impl<S, W> Layer<S> for LegacyFormatLayer<W>
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    W: for<'writer> MakeWriter<'writer> + 'static,
{
    fn on_event(&self, event: &Event<'_>, ctx: Context<'_, S>) {
        // Extract metadata
        let metadata = event.metadata();
        let level = metadata.level();
        let target = metadata.target();

        // Extract custom fields from extensions
        let extensions = ctx.extensions();
        let custom_fields = extensions.get::<CustomFields>();

        // Extract message using visitor
        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        let message = visitor.message;

        // Format based on LogFormat
        let output = if self.format == LogFormat::Text {
            self.format_text(level, target, &message, custom_fields)
        } else {
            self.format_json(level, target, &message, custom_fields)
        };

        // Write to output
        let mut writer = self.writer.make_writer();
        let _ = writer.write_all(output.as_bytes());
        let _ = writer.write_all(b"\n");
    }
}

impl<W> LegacyFormatLayer<W> {
    fn format_text(
        &self,
        level: &Level,
        target: &str,
        message: &str,
        custom_fields: Option<&CustomFields>,
    ) -> String {
        // Match current fern text format exactly
        format!(
            "[{} {}{} - {}] {}",
            humantime::format_rfc3339_seconds(SystemTime::now()),
            level,
            if self.include_session_id {
                custom_fields
                    .map(|cf| format!(" {}", cf.session_id))
                    .unwrap_or_default()
            } else {
                String::new()
            },
            target,
            message
        )
    }

    fn format_json(
        &self,
        level: &Level,
        target: &str,
        message: &str,
        custom_fields: Option<&CustomFields>,
    ) -> String {
        // Match current fern JSON format exactly
        let mut log_json = serde_json::json!({
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "severity": level.to_string(),
            "target": target,
            "message": message,
        });

        if self.include_session_id {
            if let Some(cf) = custom_fields {
                log_json["session_id"] = serde_json::Value::String(cf.session_id.clone());
            }
        }

        serde_json::to_string(&log_json).unwrap()
    }
}

#[derive(Default)]
struct MessageVisitor {
    message: String,
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{:?}", value);
        }
    }
}
```

### OTEL Integration

```rust
fn create_otel_layer(
    endpoint: &Uri,
    session_id: &str,
    machine_id: &str,
    level: LevelFilter,
) -> Result<impl Layer<Registry>, LoggerError> {
    use opentelemetry_otlp::{Protocol, WithExportConfig, WithHttpConfig};
    use opentelemetry_sdk::logs::SdkLoggerProvider;

    // Create OTLP exporter
    let reqwest_client = reqwest::blocking::Client::new();
    let exporter = opentelemetry_otlp::LogExporter::builder()
        .with_http()
        .with_http_client(reqwest_client)
        .with_endpoint(endpoint.to_string())
        .with_protocol(Protocol::HttpJson)
        .with_timeout(Duration::from_millis(5000))
        .build()?;

    // Build resource attributes
    let mut resource_attributes = vec![
        KeyValue::new(SERVICE_NAME, "moose-cli"),
        KeyValue::new("session_id", session_id.to_string()),
        KeyValue::new("machine_id", machine_id.to_string()),
    ];

    // Add labels from MOOSE_METRIC__LABELS
    if let Ok(base64) = env::var("MOOSE_METRIC__LABELS") {
        if let Ok(Value::Object(labels)) = decode_base64_to_json(&base64) {
            for (key, value) in labels {
                if let Some(value_str) = value.as_str() {
                    resource_attributes.push(KeyValue::new(key, value_str.to_string()));
                }
            }
        }
    }

    // Create logger provider
    let resource = Resource::builder()
        .with_attributes(resource_attributes)
        .build();

    let logger_provider = SdkLoggerProvider::builder()
        .with_resource(resource)
        .with_batch_exporter(exporter)
        .build();

    // Create tracing-opentelemetry layer
    let otel_layer = tracing_opentelemetry::layer()
        .with_logger_provider(logger_provider)
        .with_filter(level);

    Ok(otel_layer)
}
```

### Error Handling

```rust
#[derive(thiserror::Error, Debug)]
pub enum LoggerError {
    #[error("Error setting up tracing subscriber")]
    SubscriberInit(#[from] tracing_subscriber::util::TryInitError),

    #[error("Error setting up otel logger")]
    Exporter(#[from] opentelemetry_sdk::error::OTelSdkError),

    #[error("Error building the exporter")]
    ExporterBuild(#[from] opentelemetry_otlp::ExporterBuildError),
}
```

### Macro Conversion

**Simple find/replace across 91 files:**

```rust
// Before
use log::{debug, info, warn, error};

// After
use tracing::{debug, info, warn, error};
```

**No code changes needed** - macro signatures are identical:
```rust
// Both work the same
info!("Starting sync process: {:?}", sync.id());
warn!("Connection timeout, retrying");
error!("Failed to connect: {}", err);
```

## Migration Strategy

### Phase 1: Infrastructure Replacement (Week 1)

**Tasks:**
1. Update Cargo.toml dependencies
2. Rewrite `apps/framework-cli/src/cli/logger.rs`
   - Implement `setup_logging()` with subscriber layers
   - Implement `CustomFieldsLayer`
   - Implement `LegacyFormatLayer`
   - Implement `create_otel_layer()`
   - Keep `clean_old_logs()` function as-is
3. Update `LoggerError` enum
4. Ensure compilation succeeds

**Validation:**
- Cargo build succeeds
- Unit tests pass (if any)
- Logger initializes without errors

### Phase 2: Macro Conversion (Week 1)

**Strategy:**
- Batch conversion by directory (e.g., all of `infrastructure/`, then `cli/`, etc.)
- Simple find/replace: `use log::` → `use tracing::`
- Run tests after each batch

**Files to convert:** 91 files
- `infrastructure/` modules (~20 files)
- `cli/` command modules (~15 files)
- `framework/` core (~25 files)
- `utilities/` helpers (~10 files)
- Other modules (~21 files)

**Validation after each batch:**
- `cargo build` succeeds
- `cargo test` passes
- Spot-check log output

### Phase 3: Testing & Validation (Week 2)

**Test Legacy Format (default):**
```bash
# Should produce current fern-style output
cargo run -- dev

# Check log file format
cat ~/.moose/$(date +%Y-%m-%d)-cli.log

# Test RUST_LOG filtering
RUST_LOG=moose_cli::infrastructure=debug cargo run -- dev

# Test JSON format
MOOSE_LOGGER__FORMAT=Json cargo run -- dev
```

**Test Modern Format (opt-in):**
```bash
# Enable new format
MOOSE_LOGGER__USE_TRACING_FORMAT=true cargo run -- dev

# Check new format
cat ~/.moose/$(date +%Y-%m-%d)-cli.log

# Test RUST_LOG with new format
RUST_LOG=moose_cli::infrastructure=debug \
MOOSE_LOGGER__USE_TRACING_FORMAT=true \
cargo run -- dev
```

**Test OTEL Export:**
- Configure `MOOSE_LOGGER__EXPORT_TO`
- Run CLI commands
- Verify logs appear in OTEL collector
- Check resource attributes are correct

**Test Feature Preservation:**
- File rotation: Check files created with date format
- 7-day cleanup: Manually create old log files, verify deletion
- Session ID: Check appears in logs when enabled
- Stdout vs file: Test both modes

### Phase 4: Staging Deployment (Week 3)

**Deploy to staging with legacy format:**
```yaml
# Deployment config - no changes needed
MOOSE_LOGGER__LEVEL: Info
MOOSE_LOGGER__STDOUT: true
MOOSE_LOGGER__FORMAT: Json
# use_tracing_format defaults to false
```

**Validation:**
- Boreal ingestion continues working
- Check `hosting_telemetry` receives logs correctly
- Verify no format-related errors

**Test modern format on specific projects:**
```yaml
# Test project config
MOOSE_LOGGER__USE_TRACING_FORMAT: true
```

### Phase 5: Production Rollout (Week 4)

**Deploy to production:**
- Legacy format as default (backward compatible)
- Monitor telemetry ingestion
- Watch for any log-related errors
- Gather user feedback

**Communication:**
- Document new `RUST_LOG` capability
- Explain opt-in modern format
- Provide migration timeline

### Phase 6: Format Migration (Future - 3-6 months)

**After Boreal updates:**
1. Update `hosting_telemetry` to handle both formats
2. Test dual-format ingestion in staging
3. Flip default: `default_use_tracing_format() -> bool { true }`
4. Deploy to production
5. Deprecation notice for legacy format
6. Eventually remove `LegacyFormatLayer` code

## Testing Strategy

### Unit Tests

**Test logger setup:**
```rust
#[test]
fn test_setup_logging_legacy_format() {
    let settings = LoggerSettings {
        use_tracing_format: false,
        format: LogFormat::Json,
        ..Default::default()
    };

    assert!(setup_logging(&settings, "test-machine").is_ok());
}

#[test]
fn test_setup_logging_modern_format() {
    let settings = LoggerSettings {
        use_tracing_format: true,
        format: LogFormat::Json,
        ..Default::default()
    };

    assert!(setup_logging(&settings, "test-machine").is_ok());
}
```

**Test format output:**
```rust
#[test]
fn test_legacy_json_format() {
    // Capture log output
    // Parse JSON
    // Verify fields: timestamp, severity, target, message, session_id
}

#[test]
fn test_legacy_text_format() {
    // Capture log output
    // Verify format: [timestamp LEVEL - target] message
}
```

**Test RUST_LOG filtering:**
```rust
#[test]
fn test_env_filter() {
    env::set_var("RUST_LOG", "moose_cli::infrastructure=debug");
    // Initialize logger
    // Verify debug logs from infrastructure show up
    // Verify info logs from other modules filtered out
}
```

### Integration Tests

**End-to-end CLI tests:**
```bash
# Test various commands produce logs
moose dev &
moose build
moose ls

# Verify log files created
ls ~/.moose/*.log

# Verify RUST_LOG works
RUST_LOG=debug moose dev
```

### Compatibility Tests

**Boreal ingestion test:**
1. Deploy to staging with legacy format
2. Generate logs from test Moose project
3. Query `hosting_telemetry` database
4. Verify logs ingested correctly with all fields

## Rollback Plan

### If Issues Discovered

**Before production deploy:**
- Revert PR, fix issues, redeploy

**After production deploy:**
- If critical logging issues:
  1. Revert to previous version immediately
  2. Investigate root cause
  3. Fix and redeploy

**Low risk because:**
- Logger is isolated module
- Backward compatible by default
- Extensive testing before production
- Feature flag for new format

## Success Metrics

### Phase 1 Success (Infrastructure)
- ✅ Cargo build succeeds
- ✅ Logger initializes without errors
- ✅ All existing tests pass

### Phase 2 Success (Macro Conversion)
- ✅ All 91 files converted
- ✅ No compilation errors
- ✅ All tests still pass

### Phase 3 Success (Validation)
- ✅ Legacy format produces identical output to fern
- ✅ Modern format works correctly
- ✅ RUST_LOG filtering works
- ✅ OTEL export includes all resource attributes
- ✅ File rotation creates daily files
- ✅ Old logs cleaned up after 7 days

### Phase 4 Success (Staging)
- ✅ Boreal ingestion works without changes
- ✅ No format-related errors in logs
- ✅ Performance equivalent to fern

### Phase 5 Success (Production)
- ✅ Zero log ingestion failures
- ✅ Users can use RUST_LOG for debugging
- ✅ No performance degradation
- ✅ Positive user feedback

## Future Enhancements

### Post-Migration Improvements

**1. Strategic Span Usage**
- Add spans to major CLI commands
- Instrument key workflows (sync, build, deploy)
- Provide structured context for debugging

**2. Enhanced RUST_LOG Docs**
- Document common filter patterns
- Provide examples for debugging scenarios
- Add to CLI help text

**3. Dynamic Reloading** (if needed)
- Implement reload-on-SIGHUP
- Allow changing log level without restart
- Useful for long-running `moose dev`

**4. Log Aggregation Integration**
- Better integration with log aggregators
- Structured context propagation
- Correlation IDs for distributed tracing

**5. Performance Optimization**
- Async logging for high-volume scenarios
- Buffered writes
- Conditional compilation of debug logs

## References

- [Linear Issue ENG-1270](https://linear.app/514/issue/ENG-1270)
- [tracing-subscriber Documentation](https://docs.rs/tracing-subscriber)
- [tracing Documentation](https://docs.rs/tracing)
- [Format Comparison Document](./logging-format-comparison.md)
- Current Implementation: `apps/framework-cli/src/cli/logger.rs`
- Boreal Dependencies: `~/code/commercial/apps/hosting_telemetry_app/`

## Appendices

### A. Environment Variables

**New:**
- `RUST_LOG`: Standard Rust log filtering (e.g., `RUST_LOG=moose_cli::infrastructure=debug`)
- `MOOSE_LOGGER__USE_TRACING_FORMAT`: Opt-in to modern format (default: `false`)

**Existing (unchanged):**
- `MOOSE_LOGGER__LEVEL`: Log level (DEBUG, INFO, WARN, ERROR)
- `MOOSE_LOGGER__STDOUT`: Output to stdout vs file (default: `false`)
- `MOOSE_LOGGER__FORMAT`: Text or JSON (default: Text)
- `MOOSE_LOGGER__EXPORT_TO`: OTEL endpoint URL
- `MOOSE_LOGGER__INCLUDE_SESSION_ID`: Include session ID in logs (default: `false`)
- `MOOSE_METRIC__LABELS`: Base64-encoded JSON with orgId, projectId, branchId

### B. Dependency Versions

**Added:**
- `tracing-subscriber = "0.3"`
- `tracing-appender = "0.2"`
- `tracing-opentelemetry = "0.29"`

**Removed:**
- `fern = "0.7"`
- `log = "0.4"`
- `opentelemetry-appender-log = "0.29"`

**Unchanged:**
- `tracing = "0.1.40"` (already present)
- All other OTEL dependencies

### C. File Changes Summary

**Modified Files:**
- `apps/framework-cli/Cargo.toml` - Dependency changes
- `apps/framework-cli/src/cli/logger.rs` - Complete rewrite (~500 lines)
- 91 source files - Macro imports (`log::` → `tracing::`)

**New Files:**
- `docs/logging-format-comparison.md` - Format documentation
- `docs/plans/2025-11-14-tracing-migration-design.md` - This document

**Unchanged:**
- Configuration file structure
- CLI command interface
- External APIs
