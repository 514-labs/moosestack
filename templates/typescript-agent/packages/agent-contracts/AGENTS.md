# agent-contracts

Shared cross-package TypeScript contracts for the template.

## Ownership

This package owns:

- DTOs shared between the web app and Moose service
- stable path constants that cross package boundaries

This package does not own:

- environment loading
- network clients
- provider-specific runtime logic
- Moose service query or API implementations

## Source Layout

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Shared interfaces, DTOs, and route constants. Keep it small. |

## Rules

- Only put types and constants here when they are genuinely shared across package boundaries.
- Do not move host-only helpers here just to avoid an import path.
- Keep the package boring. If logic starts showing up here, the boundary has probably drifted.

## Testing

This package is mostly validated through its consumers. From the template root, use:

```bash
pnpm test
pnpm build
```
