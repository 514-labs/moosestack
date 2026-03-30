# agent-observability-langfuse

Langfuse adapter package for the shared `agent-runtime` tracing contract.

This package exists so the core runtime stays vendor-neutral while hosts can still share one Langfuse implementation.

It owns:

- Langfuse client construction
- mapping runtime traces and steps into Langfuse records
- flushing traces at the end of a request

It should not own:

- web app env loading
- runtime orchestration
- Moose service APIs

## Source

- `src/index.ts` — `createLangfuseTraceCollector()` and its implementation

## Testing

This package is exercised through the web app’s observability tests and generated-template E2E coverage.
