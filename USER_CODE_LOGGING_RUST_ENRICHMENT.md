# User Code Logging - Rust-Level Enrichment

## Document Purpose

This document describes how to enrich user code logs (TypeScript/Python) with resource context at the Rust level using tracing spans.

---

## Approach Overview

**Key Insight:** Rust spawns TypeScript/Python processes and captures their stdout/stderr. We can use tracing spans to attach resource context to all logs from user code without modifying TS/Python.

**Benefits:**
- ✅ No changes to TypeScript/Python user code
- ✅ Centralized enrichment in Rust
- ✅ Automatic propagation of context fields
- ✅ Works for all user code: transforms, consumers, APIs, workflows

---

## Implementation

### Step 1: Modify TypeScript Streaming Runner

**File:** `apps/framework-cli/src/framework/typescript/streaming.rs`

**Current code (lines 16-102):**
```rust
pub fn run(
    kafka_config: &KafkaConfig,
    source_topic: &StreamConfig,
    target_topic: Option<&StreamConfig>,
    streaming_function_file: &Path,
    project: &Project,
    project_path: &Path,
    max_subscriber_count: usize,
    is_dmv2: bool,
) -> Result<Child, std::io::Error> {
    // ... spawn process ...

    tokio::spawn(async move {
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            info!("{}", line);
        }
    });

    tokio::spawn(async move {
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            error!("{}", line);
        }
    });

    Ok(streaming_function_process)
}
```

**New code with resource context:**
```rust
use tracing::{error, info, info_span};

pub fn run(
    kafka_config: &KafkaConfig,
    source_topic: &StreamConfig,
    target_topic: Option<&StreamConfig>,
    streaming_function_file: &Path,
    project: &Project,
    project_path: &Path,
    max_subscriber_count: usize,
    is_dmv2: bool,
    resource_name: &str,        // NEW
    resource_type: &str,        // NEW
) -> Result<Child, std::io::Error> {
    // ... spawn process ...

    // Create span with resource context
    let stdout_span = info_span!(
        "user_code_stdout",
        context = "runtime",
        resource_type = resource_type,
        resource_name = resource_name
    );

    let stderr_span = info_span!(
        "user_code_stderr",
        context = "runtime",
        resource_type = resource_type,
        resource_name = resource_name
    );

    tokio::spawn(async move {
        let _guard = stdout_span.entered();  // Enter span
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            info!("{}", line);  // Inherits resource context from span
        }
    });

    tokio::spawn(async move {
        let _guard = stderr_span.entered();  // Enter span
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            error!("{}", line);  // Inherits resource context from span
        }
    });

    Ok(streaming_function_process)
}
```

---

### Step 2: Pass Resource Context from Function Registry

**File:** `apps/framework-cli/src/infrastructure/processes/functions_registry.rs`

**Current code (lines 87-99):**
```rust
let start_fn: StartChildFn<FunctionRegistryError> =
    if function_process.is_ts_function_process() {
        Box::new(move || {
            Ok(typescript::streaming::run(
                &redpanda_config,
                &source_topic,
                Some(&target_topic),
                &executable,
                &project,
                &project_location,
                parallel_process_count,
                data_model_v2,
            )?)
        })
    }
```

**New code:**
```rust
let resource_name = function_process.name.clone();
let resource_type = if function_process.target_topic_id.is_some() {
    "transform"
} else {
    "consumer"
};

let start_fn: StartChildFn<FunctionRegistryError> =
    if function_process.is_ts_function_process() {
        Box::new(move || {
            Ok(typescript::streaming::run(
                &redpanda_config,
                &source_topic,
                Some(&target_topic),
                &executable,
                &project,
                &project_location,
                parallel_process_count,
                data_model_v2,
                &resource_name,    // NEW
                &resource_type,    // NEW
            )?)
        })
    }
```

---

### Step 3: Update Rust Logger to Include Span Fields

**File:** `apps/framework-cli/src/cli/logger.rs`

The tracing system needs to be configured to include span fields in logs.

**Modify JsonFormatter (lines 321-349):**
```rust
impl LegacyFormatter for JsonFormatter {
    fn write_event<W: Write>(
        &self,
        writer: &mut W,
        level: &Level,
        target: &str,
        event: &Event<'_>,
        span_context: Option<&SpanContext>,  // NEW
    ) -> std::io::Result<()> {
        let mut message_visitor = MessageVisitor::default();
        event.record(&mut message_visitor);

        let mut log_entry = serde_json::json!({
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "level": level.to_string(),
            "target": target,
            "message": message_visitor.message,
        });

        // Add span fields if available
        if let Some(ctx) = span_context {
            if let Some(context) = ctx.context {
                log_entry["context"] = serde_json::Value::String(context.to_string());
            }
            if let Some(resource_type) = ctx.resource_type {
                log_entry["resource_type"] = serde_json::Value::String(resource_type.to_string());
            }
            if let Some(resource_name) = ctx.resource_name {
                log_entry["resource_name"] = serde_json::Value::String(resource_name.to_string());
            }
        }

        if self.include_session_id {
            log_entry["session_id"] = serde_json::Value::String(self.session_id.clone());
        }

        serde_json::to_writer(&mut *writer, &log_entry).map_err(std::io::Error::other)?;
        writeln!(writer)
    }
}
```

**Add SpanContext struct:**
```rust
/// Resource context extracted from tracing spans
struct SpanContext {
    context: Option<String>,
    resource_type: Option<String>,
    resource_name: Option<String>,
}
```

**Modify LegacyFormatLayer::on_event (lines 372-381):**
```rust
impl<S, W, F> Layer<S> for LegacyFormatLayer<W, F>
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    W: for<'writer> MakeWriter<'writer> + 'static,
    F: LegacyFormatter + 'static,
{
    fn on_event(&self, event: &Event<'_>, ctx: Context<'_, S>) {
        let metadata = event.metadata();
        let mut writer = self.writer.make_writer();

        // Extract span context
        let span_context = ctx.event_scope(event)
            .and_then(|scope| {
                // Walk up span hierarchy to find resource context
                for span in scope.from_root() {
                    let extensions = span.extensions();
                    if let Some(context) = extensions.get::<SpanContext>() {
                        return Some(context.clone());
                    }
                }
                None
            });

        let _ = self.formatter.write_event(
            &mut writer,
            metadata.level(),
            metadata.target(),
            event,
            span_context.as_ref(),
        );
    }
}
```

---

### Step 4: Apply to All User Code Processes

**Transform Processes:** ✅ Done above

**Consumer Processes:** ✅ Same code path, already handled

**Consumption APIs:**
- **File:** `apps/framework-cli/src/infrastructure/processes/consumption_api_registry.rs`
- Add resource context when spawning API server:
  ```rust
  let span = info_span!(
      "consumption_api",
      context = "runtime",
      resource_type = "consumption_api",
      resource_name = api_name
  );
  ```

**Workflows:**
- **File:** Temporal worker spawning location
- Add resource context:
  ```rust
  let span = info_span!(
      "workflow",
      context = "runtime",
      resource_type = "workflow",
      resource_name = workflow_name
  );
  ```

---

## Log Output Examples

### Before (Current):
```
[2026-01-09T10:15:23.456Z INFO - moose_cli::framework::typescript::streaming] Processing message from topic Foo
[2026-01-09T10:15:23.789Z ERROR - moose_cli::framework::typescript::streaming] Error processing message: TypeError
```

### After (With Spans):
**Text Format:**
```
[2026-01-09T10:15:23.456Z INFO - moose_cli::framework::typescript::streaming] Processing message from topic Foo
```

**JSON Format:**
```json
{
  "timestamp": "2026-01-09T10:15:23.456Z",
  "level": "INFO",
  "target": "moose_cli::framework::typescript::streaming",
  "message": "Processing message from topic Foo",
  "context": "runtime",
  "resource_type": "transform",
  "resource_name": "user_event_to_session"
}
```

```json
{
  "timestamp": "2026-01-09T10:15:23.789Z",
  "level": "ERROR",
  "target": "moose_cli::framework::typescript::streaming",
  "message": "Error processing message: TypeError",
  "context": "runtime",
  "resource_type": "transform",
  "resource_name": "user_event_to_session"
}
```

---

## User Code Examples (NO CHANGES NEEDED)

### TypeScript Transform (user writes this):
```typescript
export default async function transform(event: UserEvent) {
  console.log("Processing user event");  // ← Rust captures and enriches

  if (event.userId === null) {
    console.error("Missing userId");  // ← Rust captures and enriches
    return null;
  }

  return { ... };
}
```

### Python Consumer (user writes this):
```python
async def consume(event: UserEvent, logger: Logger):
    print("Processing event")  # ← Rust captures and enriches
    logger.info("Custom log")  # ← Also captured and enriched
```

---

## Implementation Checklist

### Phase 1: Core Transform/Consumer Logging
- [ ] Modify `typescript::streaming::run()` to accept resource context
- [ ] Create tracing spans around stdout/stderr capture
- [ ] Pass resource context from `FunctionProcessRegistry`
- [ ] Test with TypeScript transform
- [ ] Test with Python consumer

### Phase 2: Logger Updates
- [ ] Add span context extraction to `LegacyFormatLayer::on_event()`
- [ ] Update `JsonFormatter` to include span fields
- [ ] Update `TextFormatter` to include span fields (optional)
- [ ] Test JSON log output contains resource fields

### Phase 3: Consumption APIs
- [ ] Find consumption API spawning code
- [ ] Add resource context span
- [ ] Test API logs include resource context

### Phase 4: Workflows
- [ ] Find workflow spawning code
- [ ] Add resource context span
- [ ] Test workflow logs include resource context

---

## Benefits

1. **No user code changes:** Users continue using console.log(), print(), Logger unchanged
2. **Centralized:** All enrichment logic in Rust
3. **Consistent:** All user code logs have same structure
4. **Efficient:** Span fields are cheap (just pointers)
5. **Maintainable:** Single place to update if we add fields

---

## Related Documents

- `P0_FILTERS.md` - P0 filter requirements
- `LOGGING_CURRENT_STATE.md` - Current logging baseline
- `apps/framework-cli/CLAUDE.md` - Rust development standards

---

**Document Version:** 1.0
**Date:** 2026-01-09
**Status:** Implementation Plan
