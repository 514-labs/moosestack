# How It Works: Auth Tier Implementation

This document explains how each authentication tier is implemented — what code runs, where the enforcement happens, and how data flows through the system.

## Request Flow (All Tiers)

Every chat message follows the same path:

```
Browser → Next.js /api/tierN/chat (POST)
  → getAgentResponse(messages, options?)
    → Claude Haiku 4.5 (streaming)
      → MCP tool calls (query_clickhouse, get_data_catalog)
        → MooseStack backend /tools (Express + dual auth middleware)
          → ClickHouse (readonly mode)
```

The tiers differ in what happens at two points: **the Next.js API route** (where identity is extracted) and **the MooseStack middleware** (where the token is validated and context is attached).

---

## Tier 1: API Key Auth

**No user identity. A shared PBKDF2 secret proves the caller is your frontend.**

### How it works

1. User opens `/tier1` — no login, page loads immediately
2. User sends a message — frontend POSTs to `/api/tier1/chat`
3. The API route calls `getAgentResponse(messages)` with **no options** — no token override, no user context
4. `agent-config.ts` falls back to the static `MCP_API_TOKEN` env var for the Bearer header
5. The MooseStack middleware receives the token, detects it's **not a JWT** (doesn't have 3 dot-separated segments), and delegates to the PBKDF2 middleware
6. PBKDF2 middleware validates the token against the hashed `MCP_API_KEY`
7. `userContext` is set to `undefined` — tools execute with no identity
8. No audit logging occurs (audit logging only fires when `userContext` is present)

### Key code paths

| Step | File | What happens |
|------|------|-------------|
| API route | `web-app/src/app/api/tier1/chat/route.ts` | Validates `messages` array, calls `getAgentResponse(messages)` with no options |
| Token selection | `web-app/src/features/chat/agent-config.ts` | `options?.token ?? getMcpApiToken()` — falls back to static env var |
| System prompt | `web-app/src/features/chat/system-prompt.ts` | No `userContext` → base prompt only, no personalization |
| Auth middleware | `moosestack-service/app/apis/mcp.ts` | `isJwt(token)` returns false → PBKDF2 path → `userContext = undefined` |
| Query execution | `moosestack-service/app/apis/mcp.ts` | No `orgId` → query runs unmodified against ClickHouse |

### What's enforced

- ClickHouse `readonly: 2` prevents any data modification
- Row limit (default 100, max 1000) prevents data exfiltration
- Only SELECT, SHOW, DESCRIBE, EXPLAIN queries are described to the LLM

### What's not enforced

- No user identity — all requests look the same
- No audit trail — you can't tell who asked what
- No data scoping — everyone sees everything

---

## Tier 2: JWT Passthrough

**Per-user identity flows through the system. Same data access as Tier 1, but every query is attributable.**

### How it works

1. User opens `/tier2` — Clerk middleware redirects to `/sign-in`
2. User signs in via Clerk — redirected back to `/tier2`
3. User sends a message — frontend POSTs to `/api/tier2/chat`
4. The API route calls `auth()` from Clerk to get `userId` and `getToken()`
5. It fetches the JWT and current user details in parallel
6. Calls `getAgentResponse(messages, { token: jwt, userContext: { userId, email, name } })`
7. `agent-config.ts` uses the JWT (not the static API key) as the Bearer token
8. The MooseStack middleware receives the JWT, detects it **is a JWT** (3 dot-separated segments), and validates it against the Clerk JWKS endpoint
9. Claims are extracted: `sub` → userId, `email`, `name`
10. `userContext` is attached to the request — tools can read identity
11. The system prompt includes the user's name and email — the LLM can greet them personally
12. After each tool execution, a structured JSON audit log is written to stdout

### Key code paths

| Step | File | What happens |
|------|------|-------------|
| Route protection | `web-app/src/middleware.ts` | `clerkMiddleware` + `createRouteMatcher` protects `/tier2(.*)` and `/api/tier2(.*)` |
| API route | `web-app/src/app/api/tier2/chat/route.ts` | Calls `auth()`, `getToken()`, `currentUser()` — returns 401 if no `userId` |
| Token selection | `web-app/src/features/chat/agent-config.ts` | `options.token` (the JWT) takes priority over static `MCP_API_TOKEN` |
| System prompt | `web-app/src/features/chat/system-prompt.ts` | `userContext` present → appends name, email to prompt + "address user by name" instruction |
| Auth middleware | `moosestack-service/app/apis/mcp.ts` | `isJwt(token)` returns true → `jwtVerify(token, jwks)` → extract claims → set `userContext` |
| Audit logging | `moosestack-service/app/apis/mcp.ts` | `if (userContext)` → `console.log(JSON.stringify({ event, tool, userId, email, query, rowCount, timestamp }))` |

### Dual auth auto-detection

The backend doesn't need a config switch to handle Tier 1 vs Tier 2 requests. The middleware inspects the token format:

```typescript
function isJwt(token: string): boolean {
  return token.split(".").length === 3;
}
```

- 3 dot-separated segments → JWT path (validate with JWKS)
- Anything else → PBKDF2 path (validate with hashed key)

This means Tier 1 and Tier 2 requests can hit the same backend simultaneously.

### Audit log format

Every tool invocation with `userContext` present produces:

```json
{
  "event": "tool_invocation",
  "tool": "query_clickhouse",
  "userId": "user_abc123",
  "email": "alice@example.com",
  "orgId": null,
  "query": "SELECT * FROM DataEvent LIMIT 10",
  "rowCount": 10,
  "timestamp": "2026-02-25T12:00:00.000Z"
}
```

### What's enforced (beyond Tier 1)

- User must sign in via Clerk to access `/tier2`
- JWT signature is validated against Clerk's JWKS endpoint
- Every query is logged with the user's identity

### What's not enforced

- No data scoping — authenticated users see all data

---

## Tier 3: Org-Scoped Data Isolation

**Different organizations see different data. The backend injects org-scoped WHERE clauses into every SELECT query.**

### How it works

1. User opens `/tier3` — Clerk middleware redirects to `/sign-in`
2. User signs in and selects an organization via the Organization Switcher
3. User sends a message — frontend POSTs to `/api/tier3/chat`
4. The API route calls `auth()` from Clerk to get `userId`, `orgId`, and `getToken()`
5. Calls `getAgentResponse(messages, { token: jwt, userContext: { userId, email, name, orgId } })`
6. `agent-config.ts` sends the JWT as Bearer token **and** the `orgId` as an `x-org-id` header
7. The MooseStack middleware validates the JWT, then reads `orgId` from JWT claims or the `x-org-id` header as fallback
8. `userContext.orgId` is set — this triggers query scoping
9. When the LLM calls `query_clickhouse`, the tool handler **injects a `WHERE org_id = '...'` clause** into every SELECT query before execution
10. Results only contain rows matching the user's organization

### Key code paths

| Step | File | What happens |
|------|------|-------------|
| API route | `web-app/src/app/api/tier3/chat/route.ts` | Same as Tier 2, plus extracts `orgId` from `auth()` |
| Org ID header | `web-app/src/features/chat/agent-config.ts` | Sends `x-org-id` header alongside Bearer JWT |
| Auth middleware | `moosestack-service/app/apis/mcp.ts` | Reads `orgId` from JWT `org_id` claim or `x-org-id` header |
| Query scoping | `moosestack-service/app/apis/mcp.ts` | Injects `WHERE org_id = '...'` into SELECT queries |
| Org switcher UI | `web-app/src/app/tier3/page.tsx` | Clerk `<OrganizationSwitcher>` lets user change active org |

### How query scoping works

When `userContext.orgId` is present, the `query_clickhouse` tool rewrites SELECT queries before execution:

```
Original:  SELECT * FROM DataEvent
Rewritten: SELECT * FROM DataEvent WHERE org_id = 'org_abc123'

Original:  SELECT * FROM DataEvent WHERE eventType = 'purchase'
Rewritten: SELECT * FROM DataEvent WHERE org_id = 'org_abc123' AND eventType = 'purchase'

Original:  SELECT eventType, count() FROM DataEvent GROUP BY eventType
Rewritten: SELECT eventType, count() FROM DataEvent WHERE org_id = 'org_abc123' GROUP BY eventType
```

The rewriting handles these SQL patterns:
- Queries with no WHERE clause → appends `WHERE org_id = '...'`
- Queries with existing WHERE → prepends `org_id = '...' AND` to existing conditions
- Queries with GROUP BY, ORDER BY, or LIMIT (no WHERE) → inserts WHERE before those clauses

### Why x-org-id header instead of JWT claims

Clerk's default JWT doesn't include `org_id` in claims. While you can configure a custom JWT template in Clerk to include it, the `x-org-id` header approach works out of the box:

1. The Next.js API route gets `orgId` from Clerk's `auth()` (server-side session)
2. It passes `orgId` in the `userContext` to `agent-config.ts`
3. `agent-config.ts` sends it as an `x-org-id` header to the MCP backend
4. The backend reads `orgId` from JWT claims first, falls back to `x-org-id` header

```typescript
const orgIdFromJwt = (payload.org_id as string) ?? undefined;
const orgIdFromHeader = req.headers["x-org-id"] as string | undefined;
// ...
orgId: orgIdFromJwt ?? orgIdFromHeader,
```

### What's enforced (beyond Tier 2)

- Every SELECT query is scoped to the user's active organization
- Users in org_acme cannot see org_globex data, even if they craft a specific query
- The Organization Switcher UI lets users change orgs — each org sees only its own data

### What's not yet enforced

- **Database-level row policies** — the current scoping is at the application layer (query rewriting in `mcp.ts`). ClickHouse row policies (`CREATE ROW POLICY`) would enforce isolation at the database engine level. This is planned for a future release.
- **Catalog filtering** — the LLM can see all table names. A future improvement could restrict the catalog to only show tables relevant to the user's org.

---

## Comparison

| | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| **Frontend auth** | None | Clerk sign-in | Clerk sign-in + org selection |
| **Backend auth** | PBKDF2 API key | JWT (JWKS validation) | JWT + x-org-id header |
| **User identity** | None | userId, email, name | userId, email, name, orgId |
| **Data access** | All data | All data | Org-scoped only |
| **Audit logging** | No | Yes | Yes (includes orgId) |
| **System prompt** | Base only | Personalized (name, email) | Personalized (name, email, org) |
| **Query modification** | None | None | WHERE org_id injected |
| **Enforcement layer** | ClickHouse readonly | ClickHouse readonly + JWT | ClickHouse readonly + JWT + app-layer scoping |

---

## Related Docs

- [README.md](../README.md) — Quick start and project overview
- [auth-guide.md](auth-guide.md) — Architecture decisions, security checklist, when to use each tier
- [demo-guide.md](demo-guide.md) — Step-by-step demo runbook
