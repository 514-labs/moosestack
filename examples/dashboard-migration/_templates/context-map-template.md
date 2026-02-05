# Context Map — <component-name>

This file is the **single source of truth** for inputs, outputs, and progress. Update it whenever you add or move an output file.

## Status legend
Use one of: Not started | In progress | Done | Blocked

## Phase 1 — Parity

| Inputs | Outputs | Status | Notes |
|---|---|---|---|
| - API spec link (method/path/params/response) <br/>- Base URL + auth/headers <br/>- Handler/query file paths | - `test-cases/01-*.md` … `test-cases/0N-*.md` <br/>- `code/<component>-handler-olap-translation.ts` | Not started | |

## Phase 2 — Precompute

| Inputs | Outputs | Status | Notes |
|---|---|---|---|
| - `code/<component>-handler-olap-translation.ts` path <br/>- Access patterns (filters, sorts, time windows) <br/>- Source table model paths (for `selectTables`) | - `<PATH>/<ServingTable>-mv.ts` | Not started | |

## Phase 3 — Serve

| Inputs | Outputs | Status | Notes |
|---|---|---|---|
| - Serving table + MV file path <br/>- Existing handler path <br/>- API contract link | - `<PATH>/query-model.ts` <br/>- Handler update path | Not started | |

## Test cases
List the files once created:
- `test-cases/01-<short-name>.md`
- `test-cases/02-<short-name>.md`
- `test-cases/03-<short-name>.md`

Each test case file should include:
- a replayable `curl` request (GET with query params or POST with JSON)
- the **expected response** JSON (verbatim)

See the guide for the exact test case format.
