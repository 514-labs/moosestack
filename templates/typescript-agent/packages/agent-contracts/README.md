# agent-contracts

Shared TypeScript contracts used by the web app and Moose service.

This package should stay small and boring:

- DTOs shared across package boundaries
- stable path constants like API routes
- no environment loading
- no network clients
- no provider-specific runtime logic

## Source

- `src/index.ts` — exported shared interfaces and constants

## When to change it

Update this package when:

- the Moose service response shape changes
- the web app needs a typed contract for a shared endpoint
- a package boundary needs a shared constant instead of a string literal

## Testing

There are no dedicated tests here yet. Coverage usually lands through:

- web app unit tests
- Moose service tests
- generated-template E2E coverage
