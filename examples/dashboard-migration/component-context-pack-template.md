---
title: COMPONENT_NAME
description: Context pack for the COMPONENT_NAME dashboard/report component
---

## 1) The contract (what must not change)

### API surface

- **Endpoint(s)**:
  - Method: `<GET|POST>`
  - Path: `<PATH>` (example: `/dataset`)
- **Authentication / tenancy rules**:
  - `<describe tenant scoping, merchant scoping, roles, row-level constraints>`
- **Request schema**:
  - Location: `<PATH_OR_LINK>` (OpenAPI, TypeScript types, JSON schema, etc.)
- **Response schema**:
  - Location: `<PATH_OR_LINK>`

### Example requests (realistic dashboard usage)

Provide 2–5 concrete examples that represent typical usage (date ranges, filters, sorting, pagination).

| Case | Description | Request payload / params | Notes |
|------|-------------|--------------------------|-------|
| 1 | `<short>` | `<PATH_OR_INLINE_JSON>` | `<e.g. default page load>` |
| 2 | `<short>` | `<PATH_OR_INLINE_JSON>` | `<e.g. filter + sort>` |
| 3 | `<short>` | `<PATH_OR_INLINE_JSON>` | `<e.g. edge-case>` |

---

## 2) Current OLTP implementation (what you’re replacing)

### Frontend caller (what the UI needs)

- **Component file(s)**:
  - `<PATH>` (example: `app/components/Dashboard/OrderFulfillment.tsx`)

### Backend handler (OLTP-backed)

- **Handler file(s)**:
  - `<PATH>` (example: `api/dataset/order-fulfillment.ts`)
- **Supporting helpers / middleware**:
  - `<PATHS>` (auth, permissions, parsing, paging, etc.)
- **Auth/tenancy enforcement**:
  - `<where + how>`

### OLTP query logic (ground truth, referenced by the handler)

For parity work, the **backend handler is the source of truth**. Your copilot should start from the handler and follow the chain to whatever it ultimately executes (ORM query builder, raw SQL, stored procedures, views, etc.).

- **Primary OLTP database**: `<Postgres|MySQL|MSSQL|...>`
- **How the handler queries OLTP**: `<ORM|query builder|raw SQL|stored procedure call|view>`

If the handler relies on external SQL artifacts, include them here so the copilot can reason about the full pipeline:

- **Raw SQL file(s)** (if any): `<PATHS>`
- **Stored procedures** (names + definitions + where called):  
  - `<proc_name>`: `<where defined>`, `<where called>`
- **Views** (names + definitions + where used):  
  - `<view_name>`: `<where defined>`, `<where used>`
- **Just-in-time joins** (tables joined at read time, and why):  
  - `<list joins and purpose>`


## 3) Verification context (how to prove parity)

### Golden test cases (input → expected output)

For parity work, you need “golden” responses for known inputs.

| Case | Input (request) | Expected output | How to validate |
|------|------------------|----------------|-----------------|
| 1 | `<payload/path>` | `<payload/path>` | `<exact match vs. tolerance>` |
| 2 | `<payload/path>` | `<payload/path>` | `<notes>` |

### Data access for testing

- **Optional staging/prod connection string(s)**: `<CONNECTION_STRING>`

