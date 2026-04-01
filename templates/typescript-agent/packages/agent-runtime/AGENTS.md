# agent-runtime

Shared runtime assembly for the TypeScript agent template.

## Ownership

This package owns:

- provider/model selection
- MCP endpoint normalization and MCP client wiring
- the default system prompt and multi-agent specialist prompts
- single-agent and multi-agent stream orchestration
- the shared observability contract used by host-side trace collectors

This package does not own:

- Next.js route handlers
- Auth.js session management
- Langfuse or any other vendor-specific tracing sink
- host-side fallback collectors

## Source Layout

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Public barrel only. Keep it thin. |
| `src/runtime/` | Runtime contracts and `createAgentRuntime()` assembly. |
| `src/streams/` | Single-agent and multi-agent execution flows, trace lifecycle, and tool timing helpers. |
| `src/mcp/` | MCP URL normalization and client creation/cleanup. |
| `src/providers/` | Model/provider selection. |
| `src/prompts/` | Default and multi-agent prompts. |
| `src/observability-contract.ts` | `TraceCollector`, `AgentStepRecord`, and `AgentTraceSummary`. |
| `src/shared-types.ts` | Provider and guardrail contracts shared across runtime modules. |
| `src/utils/` | AI SDK type aliases and message/tool helpers. |

## Rules

- Do not add concrete tracing implementations here. The runtime should emit trace events, not own Langfuse or local fallback sinks.
- Keep `src/index.ts` as a barrel. If it starts growing logic again, the structure has regressed.
- Put MCP connection behavior under `src/mcp/`, not inside stream orchestration files.
- Keep prompt text in `src/prompts/` so prompt changes do not mix with transport or tracing changes.
- When single-agent and multi-agent flows share behavior, extract it into `src/streams/` helpers instead of duplicating it.

## Testing

From the template root:

```bash
pnpm test:integration
pnpm test
pnpm build
```

If you change runtime behavior that affects the generated app, rerun the TypeScript template E2E suite from `apps/framework-cli-e2e`.
