# agent-observability-langfuse

Langfuse adapter for the shared `TraceCollector` contract.

## Ownership

This package owns:

- Langfuse client construction
- mapping runtime trace and step events into Langfuse records
- flushing Langfuse state at the end of a request

This package does not own:

- web app env loading
- runtime orchestration
- Moose service APIs
- fallback in-memory collectors

## Source Layout

| Path | Purpose |
| --- | --- |
| `src/index.ts` | `createLangfuseTraceCollector()` and the Langfuse-backed collector implementation. |

## Rules

- Implement the shared runtime tracing contract here; do not move Langfuse-specific behavior into `agent-runtime`.
- Keep host-specific config discovery in the host package. This package should accept config, not discover it.
- If a tracing feature is not Langfuse-specific, it likely belongs in the runtime contract instead of here.

## Testing

This package is mostly exercised through web-app tests and generated-template E2E coverage. From the template root, use:

```bash
pnpm test
pnpm build
```
