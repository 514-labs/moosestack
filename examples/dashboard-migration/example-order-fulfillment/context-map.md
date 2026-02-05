# Context Map — example-order-fulfillment

This example shows a minimal, end-to-end map for Phases 1–3. Replace values with your real endpoint and paths.

## Status legend
Not started | In progress | Done | Blocked

## Phase 1 — Parity

| Inputs | Outputs | Status | Notes |
|---|---|---|---|
| - API spec: `/api/order-fulfillment` (POST) <br/>- Base URL: `http://localhost:4000` <br/>- Auth: `Authorization: Bearer $API_TOKEN` <br/>- Handler: `path/to/order-fulfillment.handler.ts` <br/>- Query: `path/to/order-fulfillment.query.ts` | - `test-cases/01-last-30-days.md` <br/>- `code/order-fulfillment-handler-olap-translation.ts` | Done | Dates are UTC; response ordered by `day` asc. |

## Phase 2 — Precompute

| Inputs | Outputs | Status | Notes |
|---|---|---|---|
| - `code/order-fulfillment-handler-olap-translation.ts` <br/>- Access pattern: merchant + date window <br/>- Source table model: `code/source-orders.ts` | - `code/order-fulfillment-daily-mv.ts` | Done | Serving grain: `merchant_id` + `day`. |

## Phase 3 — Serve

| Inputs | Outputs | Status | Notes |
|---|---|---|---|
| - Serving table + MV: `code/order-fulfillment-daily-mv.ts` <br/>- Handler: `path/to/order-fulfillment.handler.ts` <br/>- Contract: `/api/order-fulfillment` | - `code/query-model.ts` <br/>- Handler update: `path/to/order-fulfillment.handler.ts` | Done | Keep stable ordering by `day`. |

## Test cases
- `test-cases/01-last-30-days.md`
