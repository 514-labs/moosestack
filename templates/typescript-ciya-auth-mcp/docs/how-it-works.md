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

**Different organizations see different data. The backend wraps every SELECT query in a subquery with an org_id filter, using the `org_id` claim from a custom Clerk JWT template.**

### How it works

1. User opens `/tier3` — Clerk middleware redirects to `/sign-in`
2. User signs in and selects an organization via the Organization Switcher
3. User sends a message — frontend POSTs to `/api/tier3/chat`
4. The API route calls `auth()` from Clerk to get `userId`, `orgId`, and `getToken({ template: "moose-mcp" })`
5. The custom JWT template includes `org_id`, `email`, and `name` as claims — signed by Clerk
6. Calls `getAgentResponse(messages, { token: jwt, userContext: { userId, email, name, orgId } })`
7. `agent-config.ts` sends the JWT as Bearer token to the MCP backend
8. The MooseStack middleware validates the JWT signature via JWKS and reads `org_id` from the verified claims
9. `userContext.orgId` is set — this triggers query scoping
10. When the LLM calls `query_clickhouse`, the tool handler **wraps every SELECT in a subquery** with an `org_id` filter
11. Results only contain rows matching the user's organization

### Key code paths

| Step | File | What happens |
|------|------|-------------|
| API route | `web-app/src/app/api/tier3/chat/route.ts` | Same as Tier 2, plus extracts `orgId` from `auth()` and uses `getToken({ template: "moose-mcp" })` |
| JWT claims | Clerk JWT template `moose-mcp` | Includes `org_id`, `org_slug`, `email`, `name` — cryptographically signed |
| Auth middleware | `moosestack-service/app/apis/mcp.ts` | Validates JWT via JWKS, reads `org_id` from verified `payload.org_id` claim |
| Query scoping | `moosestack-service/app/apis/mcp.ts` | Wraps SELECT queries in subquery with `WHERE org_id = '...'` |
| Org switcher UI | `web-app/src/app/tier3/page.tsx` | Clerk `<OrganizationSwitcher>` lets user change active org |

### How query scoping works

When `userContext.orgId` is present, the `query_clickhouse` tool wraps SELECT queries in a subquery before execution:

```
Original:  SELECT * FROM DataEvent
Scoped:    SELECT * FROM (SELECT * FROM DataEvent) AS _scoped WHERE org_id = 'org_abc123'

Original:  SELECT * FROM DataEvent WHERE eventType = 'purchase'
Scoped:    SELECT * FROM (SELECT * FROM DataEvent WHERE eventType = 'purchase') AS _scoped WHERE org_id = 'org_abc123'

Original:  SELECT eventType, count() FROM DataEvent GROUP BY eventType
Scoped:    SELECT * FROM (SELECT eventType, count() FROM DataEvent GROUP BY eventType) AS _scoped WHERE org_id = 'org_abc123'
```

The subquery wrapping approach is robust against any inner query structure — JOINs, CTEs, subqueries, GROUP BY, HAVING, UNION — since it wraps rather than rewrites.

### Clerk JWT template setup

Create a JWT template named `moose-mcp` in Clerk dashboard (Configure → JWT Templates → New template → Blank):

```json
{
  "org_id": "{{org.id}}",
  "org_slug": "{{org.slug}}",
  "email": "{{user.primary_email_address}}",
  "name": "{{user.first_name}} {{user.last_name}}"
}
```

Standard claims (`sub`, `iat`, `exp`) are included automatically.

### What's enforced (beyond Tier 2)

- Every SELECT query is scoped to the user's active organization
- Users in org_acme cannot see org_globex data, even if they craft a specific query
- The Organization Switcher UI lets users change orgs — each org sees only its own data

### Known limitations

- **Application-layer scoping** — query scoping is enforced in `mcp.ts`, not at the database engine level. ClickHouse row policies (`CREATE ROW POLICY`) would add database-level enforcement as an additional layer.
- **Catalog is not filtered** — the LLM can see all table names regardless of org. Query results are scoped, but table discovery is not.

---

## Comparison

| | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| **Frontend auth** | None | Clerk sign-in | Clerk sign-in + org selection |
| **Backend auth** | PBKDF2 API key | JWT (JWKS validation) | JWT with org_id claim (custom template) |
| **User identity** | None | userId, email, name | userId, email, name, orgId |
| **Data access** | All data | All data | Org-scoped only |
| **Audit logging** | No | Yes | Yes (includes orgId) |
| **System prompt** | Base only | Personalized (name, email) | Personalized (name, email, org) |
| **Query modification** | None | None | Subquery wrapping with org_id filter |
| **Enforcement layer** | ClickHouse readonly | ClickHouse readonly + JWT | ClickHouse readonly + JWT (signed org_id) + app-layer scoping |

---

## Related Docs

- [README.md](../README.md) — Quick start and project overview
- [auth-guide.md](auth-guide.md) — Architecture decisions, security checklist, when to use each tier
- [demo-guide.md](demo-guide.md) — Step-by-step demo runbook
