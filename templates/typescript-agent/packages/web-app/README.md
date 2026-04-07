# web-app

Next.js frontend and host runtime for the template.

This package owns:

- Auth.js session handling
- session-level authorization helpers
- local development auth mocks under `src/dev/`
- AI Elements chat primitives under `src/components/ai-elements/`
- Moose-specific chat and dashboard UI
- the chat API route
- host-side env loading
- Langfuse collector selection

It should not own:

- direct Moose table/query logic
- row-level security policy decisions
- shared agent orchestration logic that can live in `agent-runtime`

## Key Areas

- `src/auth.ts` — auth provider setup
- `src/authz/` — authorization helpers for org vs admin-debug access
- `src/dev/` — development-only auth and guardrail mocks
- `src/components/ai-elements/` — reusable conversation, message, prompt, reasoning, and source primitives
- `src/features/chat/` — Moose-specific wrappers, tool renderers, and panel composition
- `src/lib/chat-agent.ts` — Next-hosted adapter around the shared runtime
- `src/lib/moose-service.ts` — authenticated Moose service client
- `test/` — unit tests for host-side adapters and env-driven behavior

## Commands

From the template root:

```bash
pnpm dev:web
pnpm test:unit -- packages/web-app/test
```

## Notes

- Keep development-only mocks clearly under `src/dev/`.
- Keep authentication in `src/auth.ts` and authorization helpers in `src/authz/`.
- Prefer calling Moose-owned APIs instead of reaching into data/query layers from the frontend.
- Keep generic chat shell primitives in `src/components/ai-elements/`.
- Keep `.env.local` uncommitted and derive it from `.env.example`.
