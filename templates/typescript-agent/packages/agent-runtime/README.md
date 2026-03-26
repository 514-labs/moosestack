# agent-runtime

Shared agent assembly logic that can be hosted by either Next.js or MooseStack.

It owns:

- model/provider selection
- MCP client setup
- system prompt defaults
- guardrail and tracing interfaces
- tool wrapping and trace step recording

It should not own:

- Next.js route handling
- Auth.js session logic
- Langfuse SDK wiring
- Moose data access

## Source

- `src/index.ts` — runtime creation, stream execution, and shared contracts
- `test/` — integration tests for provider and MCP runtime wiring

## Testing

From the template root:

```bash
pnpm test:integration -- packages/agent-runtime/test
```

Add tests here when you change:

- provider selection
- tool wrapping
- guardrail behavior
- trace lifecycle contracts
