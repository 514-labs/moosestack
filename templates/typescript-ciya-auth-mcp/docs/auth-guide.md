# Authentication Guide for Chat-over-Data Applications

## TL;DR

This app implements a three-tier auth progression — from shared secret to user identity to row-level data isolation. All three tiers run simultaneously at `/tier1`, `/tier2`, and `/tier3`, letting you compare them side by side. This guide explains the architecture of each tier, where the code lives, and how to choose the right tier for your deployment.

## Why auth matters

Auth is the gate between "cool demo" and "production feature." No one ships chat-over-data to real users without it.

A data-connected chat is different from a typical web app because every user query can become a SQL query against your database. That means auth isn't just about access to the UI — it governs what data the LLM can retrieve and surface. Getting this wrong means either locking down too much (killing the value of the chat) or too little (leaking data across tenants, roles, or permissions).

Auth covers the full request path:

```
Browser → Next.js (session) → MooseStack API (validate, extract identity) → MCP tools (scoped context) → ClickHouse (query execution)
```

## Choose your tier

Each tier builds on the previous one. Start with the tier that matches your current deployment scope, then upgrade as requirements grow.

| Tier | Auth model | Identity | Data isolation | Best for |
|------|-----------|----------|----------------|----------|
| **1. API Key** | Shared secret (PBKDF2) | None — all users share one key | None — everyone sees everything | Internal demos, prototyping |
| **2. JWT Passthrough** | User JWT validated at API layer | Per-user identity in every request | None — same views, but auditable | Internal tools, audit-required deployments |
| **3. Org-Scoped Data Isolation** | JWT with org_id claim + subquery wrapping | Per-user and per-tenant identity | Per-tenant data filtering | Customer-facing products, multi-tenant SaaS |

### How to decide

- **Tier 1** if you are demoing internally, prototyping with your own data, or running a proof of concept where everyone on the team should see all the data.
- **Tier 2** if you need to know *who* is asking (audit trails, personalization, usage tracking) but all authenticated users can see the same data.
- **Tier 3** if different users or tenants must see different slices of data — the LLM must never surface rows that belong to another tenant or role.

> **Recommendation:** Start with Tier 1 to get your chat working. Move to Tier 2 before any deployment beyond your immediate team. Plan for Tier 3 before shipping customer-facing.

### Decision reference

| Scenario | Tier | Why |
|----------|------|-----|
| Internal demo with your team | 1 | No user identity needed, shared key is fine |
| Internal tool for a department | 2 | Need audit trails, personalization |
| Internal tool across departments with different data access | 3 | Data isolation required |
| Customer-facing analytics, single-tenant | 2 | Audit + identity, but all users see the same data |
| Customer-facing analytics, multi-tenant | 3 | Each customer must only see their own data |
| Compliance-regulated environment | 2 or 3 | Depends on whether audit trails alone satisfy requirements |

### Implementation decisions

The decisions below define the shape of the chat system. The app defaults to an opinionated stack and shows where to extend or harden as requirements grow.

| Decision | Options | Current implementation |
|----------|---------|----------------------|
| **Data access scope** | Narrow (specific tables) vs Broad (full schema) | Readonly mode with row limits in `mcp.ts`; Tier 3 wraps queries with org_id filter |
| **Data sources** | Batch (S3/Parquet), Operational (streams, OLTP replicas) | Tutorial covers S3/Parquet bulk load; see [Ingest docs](https://docs.fiveonefour.com/moosestack/ingest) for streaming |
| **Latency optimization** | Raw tables, Materialized views, Denormalized models | Define MVs in moosestack-service/app/ for time buckets, top-N, common group-bys |
| **Schema context** | None, Table comments, Column comments with semantics | `get_data_catalog` tool exposes column comments; add JSDoc comments to data models |
| **MCP tools** | query_clickhouse only, Add catalog discovery, Add search/RAG | Both tools in `mcp.ts`; extend `serverFactory()` to add more |
| **Model provider** | Anthropic Claude, OpenRouter, Others | Set `ANTHROPIC_API_KEY`; change model in `agent-config.ts` |
| **Deployment scope** | Internal only, Customer-facing | Ship internal with audit trail (Tier 2); add governance before customer-facing (Tier 3) |
| **Frontend auth** | None, Clerk, Auth0, NextAuth | Clerk for Tier 2/3 routes; Tier 1 has no frontend auth |
| **Backend auth** | No auth, API key, User JWT passthrough | Dual-mode: PBKDF2 API key (Tier 1) + JWT via JWKS (Tier 2/3), auto-detected per request |
| **Access controls** | Tool allowlists, Scoped views, Row-level security | ClickHouse readonly mode (all tiers); subquery wrapping with org_id from JWT claims (Tier 3) |

---

## Frontend vs. Backend Auth

Auth in a chat-over-data application has two independent layers:

| | Frontend Application Auth | Backend API Auth |
|---|---|---|
| **What it protects** | Who can access the Next.js app (the chat UI) | How the app authenticates to the MooseStack API |
| **Where enforced** | Clerk + `middleware.ts` in Next.js | Bearer token validation in `mcp.ts` |
| **Mechanisms** | Login page, session cookies, route protection | PBKDF2 API key (Tier 1), JWT signature validation (Tier 2/3) |
| **Current status** | Tier 1: open (no login). Tier 2/3: Clerk sign-in required | Dual-mode auth — auto-detects PBKDF2 vs JWT from token format |

**Relationship to tiers:**
- **Tier 1** works without frontend auth because the API key protects the backend and all users are trusted (internal team).
- **Tier 2/3** require Clerk sign-in. The middleware in `src/middleware.ts` protects `/tier2(.*)` and `/tier3(.*)` routes, redirecting unauthenticated users to `/sign-in`.

---

## Route Architecture

All three tiers are accessible simultaneously via route-based switching:

| Route | Auth | API endpoint | Layout |
|-------|------|-------------|--------|
| `/tier1` | None | `/api/tier1/chat` | `TierProvider tier={1}` → `ChatLayoutWrapper` |
| `/tier2` | Clerk required | `/api/tier2/chat` | `ClerkProvider` → `TierProvider tier={2}` → `ChatLayoutWrapper` |
| `/tier3` | Clerk + org required | `/api/tier3/chat` | `ClerkProvider` → `TierProvider tier={3}` → `ChatLayoutWrapper` |

The `TierProvider` context tells `ChatUI` which API endpoint to hit. Each tier's API route handles auth differently:

- **Tier 1** (`src/app/api/tier1/chat/route.ts`): Calls `getAgentResponse(messages)` with no options — uses static `MCP_API_TOKEN`.
- **Tier 2** (`src/app/api/tier2/chat/route.ts`): Calls `auth()` from Clerk, extracts JWT via `getToken()`, passes `{ token, userContext: { userId, email, name } }`.
- **Tier 3** (`src/app/api/tier3/chat/route.ts`): Same as Tier 2, plus extracts `orgId` from Clerk session claims.

---

## Tier 1: API Key Authentication

### What it is

A shared secret (API key) secures the connection between the Next.js frontend and the MooseStack backend. The MCP server validates every request against a hashed version of this key using PBKDF2.

### Architecture

```
Browser → Next.js App → [Bearer Token in Authorization header] → MooseStack API → MCP Server → ClickHouse (readonly)
```

There is no user identity. Every request looks the same to the backend. The API key proves that the caller is your frontend, not an unauthorized client.

### What you get

- Backend is not publicly accessible — only callers with the key can reach the MCP tools
- ClickHouse runs in `readonly` mode with row limits, preventing destructive or runaway queries
- No login page — immediate access at `/tier1`

### Risks and limitations

- **No user identity.** You cannot audit who asked what, personalize responses, or enforce per-user permissions.
- **Shared secret rotation is disruptive.** Changing the key requires redeploying both frontend and backend simultaneously.
- **Not viable for customer-facing deployments.** Anyone with the key has full read access to every table the MCP tools expose.

### Key files

| File | Role |
|------|------|
| `packages/moosestack-service/app/apis/mcp.ts` | PBKDF2 middleware validates Bearer token (lines 318-320, 360-363) |
| `packages/web-app/src/app/api/tier1/chat/route.ts` | API route — calls `getAgentResponse(messages)` with no options |
| `packages/web-app/src/features/chat/agent-config.ts` | Falls back to `getMcpApiToken()` when no token in options |

### Setup

Generate the key pair:

```bash
cd packages/moosestack-service
moose generate hash-token
```

| Output | Where it goes |
|--------|--------------|
| **ENV API KEY** (hashed) | `packages/moosestack-service/.env.local` as `MCP_API_KEY` |
| **Bearer Token** (plaintext) | `packages/web-app/.env.local` as `MCP_API_TOKEN` |

### When to upgrade

Move to Tier 2 when any of these apply:

- You need to know which user asked a question (compliance, audit)
- You want personalized responses ("Hi Sarah, here's your team's data...")
- You're deploying beyond your immediate team
- You're building toward per-user or per-tenant data access

---

## Tier 2: JWT Passthrough

### What it is

A JSON Web Token (JWT) flows from the browser through the Next.js backend to the MooseStack API. The system now knows *who* is asking — user ID, email, role — but everyone still queries the same data.

### Architecture

```
Browser → Clerk (sign-in) → Next.js (session + JWT) → MooseStack API (validate JWT, extract claims) → MCP tools (user context available) → ClickHouse (readonly, same views)
```

The JWT carries user identity claims. The MooseStack API validates the token signature via JWKS, extracts the claims, and makes them available to MCP tools. The LLM can use this context for personalization, and every query is attributable to a specific user.

### What you get

- **Per-user audit trail.** Every tool invocation is logged as structured JSON with userId, email, tool name, query, and timestamp.
- **Personalization.** The LLM can greet users by name — the system prompt includes user identity when available.
- **Foundation for Tier 3.** Row-level security requires user identity — Tier 2 puts that identity in place.
- **Standard auth integration.** Uses Clerk; the pattern works with any JWT-issuing provider.

### Risks and limitations

- **No data isolation.** Every authenticated user can still see all data.
- **Token management complexity.** Token expiry, refresh, and revocation are handled by Clerk.
- **Auth provider dependency.** You depend on Clerk's uptime and JWKS endpoint availability.

### Key files

| File | Role |
|------|------|
| `packages/web-app/src/middleware.ts` | Protects `/tier2(.*)` routes via `clerkMiddleware` |
| `packages/web-app/src/app/tier2/layout.tsx` | Wraps with `ClerkProvider` → `TierProvider tier={2}` |
| `packages/web-app/src/app/api/tier2/chat/route.ts` | Extracts JWT + user identity from Clerk, passes to `getAgentResponse()` |
| `packages/web-app/src/features/chat/system-prompt.ts` | Appends user identity (name, email) to system prompt when provided |
| `packages/web-app/src/features/chat/agent-config.ts` | Forwards JWT as Bearer token to MCP backend |
| `packages/moosestack-service/app/apis/mcp.ts` | JWT auto-detection (3 dot-separated segments), JWKS validation, `userContext` threading |

### How the backend dual auth works

The backend auth middleware in `mcp.ts` auto-detects the token format:

1. Extract Bearer token from `Authorization` header
2. If token has 3 dot-separated segments → **JWT path**: validate with `jwtVerify()` against JWKS, extract claims, attach `userContext` to request
3. Otherwise → **PBKDF2 path**: delegate to existing PBKDF2 middleware, no `userContext`
4. No token + no auth configured → dev mode (allow)

This means Tier 1 and Tier 2/3 requests can hit the same backend endpoint simultaneously.

### Audit logging

When `userContext` is present, every tool invocation logs structured JSON to stdout:

```json
{
  "event": "tool_invocation",
  "tool": "query_clickhouse",
  "userId": "user_2abc...",
  "email": "alice@example.com",
  "orgId": null,
  "query": "SELECT * FROM DataEvent LIMIT 10",
  "rowCount": 10,
  "timestamp": "2026-02-24T12:00:00.000Z"
}
```

### Setup

Requires a [Clerk](https://clerk.com) account. Add to `packages/web-app/.env.local`:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

Add to `packages/moosestack-service/.env.local`:

```
JWKS_URL=https://<your-clerk-domain>/.well-known/jwks.json
```

### Verification

1. Navigate to `/tier2` — redirected to `/sign-in`
2. Sign in via Clerk — redirected back to `/tier2`
3. Open chat, ask "Who am I?" — the LLM responds with your name/email
4. Check the MooseStack backend terminal for audit log entries

### When to upgrade

Move to Tier 3 when any of these apply:

- Different users or tenants must see different data
- You are building a customer-facing analytics product
- Compliance requires data isolation (not just audit trails)
- You are onboarding multiple organizations that share infrastructure

---

## Tier 3: Org-Scoped Data Isolation

### What it is

Different users see different data. A custom Clerk JWT template includes `org_id` in the signed claims, and the backend wraps every SELECT query in a subquery filtered by `org_id`. The LLM cannot surface rows that belong to another tenant — the scoping is enforced at the application layer before queries reach ClickHouse, and the `org_id` is cryptographically signed so it cannot be forged.

### Architecture

```
Browser → Clerk (sign-in, org selected) → Next.js → getToken({ template: "moose-mcp" }) → MooseStack API (validate JWT, extract org_id from claims) → MCP tools (wrap query with org_id filter) → ClickHouse (readonly)
```

### What you get

- **Data isolation via subquery wrapping.** Every SELECT query is wrapped: `SELECT * FROM (<original query>) AS _scoped WHERE org_id = '<orgId>'`. This is robust against any inner query structure.
- **Cryptographically signed org_id.** The `org_id` comes from a Clerk JWT template, not a forgeable header — only Clerk can issue tokens with valid org claims.
- **Multi-tenant SaaS ready.** Each customer sees only their data through the same chat interface.
- **Defense in depth.** Security does not depend on the LLM behaving correctly — the backend enforces scoping before query execution.

### Risks and limitations

- **Application-layer scoping.** The current approach wraps queries at the application layer in `mcp.ts`. For maximum security, ClickHouse row policies (`CREATE ROW POLICY`) would enforce isolation at the database engine level — this is planned for a future release.
- **Performance considerations.** For large tables, ensure the `org_id` column is part of the primary key or has an index. The subquery wrapper relies on ClickHouse's optimizer to push the filter down.
- **Requires Tier 2 as a prerequisite.** User identity must flow through the system before you can scope data by identity.
- **Requires Clerk Organizations.** The user must have an active organization selected for `org_id` to be present in JWT claims.
- **Requires Clerk JWT template.** A custom JWT template named `moose-mcp` must be configured in Clerk — see Setup below.

### How query scoping works

When `userContext.orgId` is present, every SELECT query is wrapped in a subquery:

```sql
-- Original query (from the LLM):
SELECT * FROM DataEvent WHERE eventType = 'purchase'

-- After scoping:
SELECT * FROM (SELECT * FROM DataEvent WHERE eventType = 'purchase') AS _scoped WHERE org_id = 'org_abc123'
```

This works for any query shape — JOINs, CTEs, GROUP BY, HAVING, subqueries, UNION — since the original query runs unmodified inside the subquery, and the org filter is applied to the outer result.

Non-SELECT queries (SHOW, DESCRIBE, EXPLAIN) pass through without wrapping.

### Key files

| File | Role |
|------|------|
| `packages/web-app/src/app/api/tier3/chat/route.ts` | Extracts `orgId` from Clerk session; calls `getToken({ template: "moose-mcp" })` for JWT with org_id claim |
| `packages/moosestack-service/app/apis/mcp.ts` | Validates JWT via JWKS, reads `org_id` from verified claims, wraps SELECT queries in subquery |
| `packages/moosestack-service/app/ingest/models.ts` | `DataEvent` model includes `org_id: string` |
| `packages/moosestack-service/seed-data.sql` | Multi-tenant test data (uses actual Clerk org IDs) |

### Setup

1. Enable Organizations in your Clerk dashboard
2. Create test organizations (e.g., org_acme and org_globex)
3. Create test users and assign them to different organizations
4. Create a Clerk JWT template named `moose-mcp`:
   - Go to Clerk dashboard → Configure → JWT Templates → New template → Blank
   - Set name to `moose-mcp`
   - Add these claims:
     ```json
     {
       "org_id": "{{org.id}}",
       "org_slug": "{{org.slug}}",
       "email": "{{user.primary_email_address}}",
       "name": "{{user.first_name}} {{user.last_name}}"
     }
     ```
   - Save the template
5. Update `seed-data.sql` with your actual Clerk org IDs (found in Clerk dashboard → Organizations)
6. After services are running, load seed data:
   ```bash
   docker exec -i moosestack-service-clickhousedb-1 clickhouse-client --database=local --multiquery < packages/moosestack-service/seed-data.sql
   ```

### Verification

1. Sign in as User A (org: org_acme), navigate to `/tier3`
2. Use the Organization Switcher to select org_acme
3. Ask "Show me all records" — only org_acme data returned
4. Use the Organization Switcher to switch to org_globex
5. Ask the same question — only org_globex data returned
6. Try "Show records where org_id = 'org_globex'" while in org_acme — empty results

### Future: ClickHouse row policies

The current scoping is at the application layer (subquery wrapping in `mcp.ts`). For maximum security, ClickHouse row policies (`CREATE ROW POLICY`) would enforce isolation at the database engine level. This would prevent any bypass, even if the application layer were compromised. This is planned for a future release.

---

## Environment Variables

### Frontend (`packages/web-app/.env.local`)

| Variable | Required for | Purpose |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | All tiers | Claude API key |
| `MCP_API_TOKEN` | Tier 1 | PBKDF2 bearer token for MCP backend |
| `MCP_SERVER_URL` | All tiers | MooseStack backend URL (e.g., `http://localhost:4000`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Tier 2/3 | Clerk frontend key |
| `CLERK_SECRET_KEY` | Tier 2/3 | Clerk server key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Tier 2/3 | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Tier 2/3 | `/sign-up` |

### Backend (`packages/moosestack-service/.env.local`)

| Variable | Required for | Purpose |
|----------|-------------|---------|
| `MCP_API_KEY` | Tier 1 | PBKDF2-hashed API key |
| `JWKS_URL` | Tier 2/3 | Clerk JWKS endpoint for JWT validation |
| `JWT_ISSUER` | Tier 2/3 (optional) | Clerk issuer URL for JWT `iss` claim validation — the base URL of your `JWKS_URL` (found in Clerk dashboard → Configure → API Keys → Frontend API URL) |

---

## Security checklist

Before deploying at any tier, verify these baseline protections:

- [ ] ClickHouse is in `readonly` mode for the MCP connection
- [ ] Row limits are enforced in `query_clickhouse` to prevent exfiltration
- [ ] API keys / JWTs are stored as server-side environment variables, never exposed to the browser
- [ ] The MCP server is not publicly accessible without authentication
- [ ] Sensitive environment variables (`.env.local`) are in `.gitignore`
- [ ] HTTPS is enforced in production

**Tier 2+ (frontend auth):**

- [ ] Clerk configured with publishable key and secret key
- [ ] `middleware.ts` protects `/tier2` and `/tier3` routes
- [ ] Unauthenticated users are redirected to `/sign-in`
- [ ] Session tokens are HTTP-only cookies (handled by Clerk)

**Tier 2+ (backend auth):**

- [ ] JWT signature validation uses JWKS (not a hardcoded secret)
- [ ] Token expiry is enforced — expired tokens are rejected
- [ ] User identity is logged with every MCP tool invocation

**Tier 3 (data isolation):**

- [ ] Clerk JWT template `moose-mcp` is configured with `org_id` claim
- [ ] Tier 3 API route uses `getToken({ template: "moose-mcp" })` (not default `getToken()`)
- [ ] Backend reads `org_id` exclusively from verified JWT claims (no header fallback)
- [ ] Subquery wrapping scopes every SELECT to the user's org
- [ ] Cross-tenant queries return no results (tested explicitly)
- [ ] Seed data uses actual Clerk org IDs (not friendly names)
