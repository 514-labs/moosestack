# agent-runtime

Shared agent assembly logic that can be hosted by either Next.js or MooseStack.

It owns:

- model/provider selection
- MCP client setup
- system prompt defaults
- guardrail interfaces
- the shared tracing contract
- single-agent and multi-agent orchestration
- tool wrapping and trace step recording

It should not own:

- Next.js route handling
- Auth.js session logic
- Langfuse SDK wiring or any other concrete trace sink
- host-side fallback collectors
- Moose data access

## Layout

```text
src/
  index.ts
  shared-types.ts
  observability-contract.ts
  errors.ts
  runtime/
  streams/
  mcp/
  providers/
  prompts/
  utils/
```

Key entry points:

- `src/index.ts` — public barrel only
- `src/runtime/create-agent-runtime.ts` — provider + MCP assembly
- `src/streams/create-agent-stream.ts` — single-agent execution
- `src/streams/create-multi-agent-stream.ts` — supervisor/specialist/narrator execution
- `src/observability-contract.ts` — `TraceCollector` and trace record contracts

The in-memory fallback collector now lives in the host app, not in this package. `agent-runtime` owns the contract, while host packages choose the concrete sink.

## Testing

From the template root:

```bash
pnpm test:integration
pnpm test
pnpm build
```

Add tests here when you change:

- provider selection
- tool wrapping
- guardrail behavior
- trace lifecycle contracts
- multi-agent routing or narration behavior
