# web-app

Next.js frontend and host runtime for the TypeScript agent template.

## Ownership

This package owns:

- Auth.js production auth and local development auth mocks
- the landing page, dashboard UI, and chat UI
- Next.js route handlers for chat and auth flows
- host-side environment loading
- host-side runtime wiring around `agent-runtime`
- Langfuse collector selection and the local fallback collector

This package does not own:

- Moose table definitions or row policies
- direct ClickHouse query logic
- shared agent orchestration that can live in `agent-runtime`
- MCP tool allowlist policy

## Source Layout

| Path | Purpose |
| --- | --- |
| `src/app/` | App Router pages and route handlers. |
| `src/auth.ts` | Production auth wiring and provider/session setup. |
| `src/dev/` | Development-only auth and guardrail mocks. |
| `src/components/ai-elements/` | Generic chat shell primitives. |
| `src/features/chat/` | Moose-specific chat UI, tool renderers, and status UI. |
| `src/lib/chat-agent.ts` | Next-hosted adapter around the shared agent runtime. |
| `src/lib/moose-service.ts` | Authenticated client for Moose-owned frontend reads. |
| `src/lib/observability.ts` | Host-side trace collector selection. |
| `src/lib/in-memory-trace-collector.ts` | Local fallback trace collector implementation. |
| `test/` | Unit tests for host adapters, env wiring, and service clients. |

## Rules

- Keep development-only behavior under `src/dev/`.
- Keep generic AI Elements primitives under `src/components/ai-elements/`; Moose-specific behavior belongs in `src/features/chat/`.
- Prefer calling Moose-owned APIs instead of reaching into data/query logic from the frontend.
- Keep host-specific runtime assembly here and shared orchestration in `agent-runtime`.
- Do not commit `.env.local`; derive it from `.env.example`.
- Search for `EXAMPLE_APP_ONLY:` when replacing the seeded demo model. Those
  markers show which frontend files are coupled to the example dashboard and
  prompts.

## Testing

From the template root:

```bash
pnpm test
pnpm build
pnpm lint
```
