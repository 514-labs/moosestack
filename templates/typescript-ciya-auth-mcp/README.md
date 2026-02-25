# Auth Chat App

A data-connected AI chat application that demonstrates three authentication tiers — from shared API key to per-user identity to org-scoped data isolation — all running simultaneously. Users chat with Claude Haiku 4.5, which queries a ClickHouse database in real time via MCP tools, while the auth layer controls who can access what.

Open `/tier1`, `/tier2`, and `/tier3` in three browser tabs to compare side by side.

## The Three Tiers

| Route | Auth Model | What's Different |
|-------|-----------|-----------------|
| `/tier1` | PBKDF2 API key | No login. Everyone sees all data. Good for internal demos. |
| `/tier2` | Clerk sign-in + JWT | Per-user identity, audit trails, personalization. Ask "Who am I?" |
| `/tier3` | Clerk + org_id scoping | Different orgs see different data. Isolation enforced at the database layer. |

The backend auto-detects whether a request carries a PBKDF2 token or a JWT — no config switch needed.

## Quick Start

### Prerequisites

- Node.js >= 20 < 25
- pnpm
- Docker (for ClickHouse and other infrastructure)
- [MooseStack CLI](https://docs.fiveonefour.com/moosestack)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

Copy example files and fill in your keys:

```bash
cp packages/moosestack-service/.env.{example,local}
cp packages/web-app/.env.{example,local}
```

Generate the API key pair for Tier 1:

```bash
cd packages/moosestack-service
moose generate hash-token
```

Set the output values:

| Output | File | Variable |
|--------|------|----------|
| ENV API KEY (hashed) | `packages/moosestack-service/.env.local` | `MCP_API_KEY` |
| Bearer Token (plaintext) | `packages/web-app/.env.local` | `MCP_API_TOKEN` |

Then set your Anthropic key in `packages/web-app/.env.local`:

```
ANTHROPIC_API_KEY=<your-key>
MCP_SERVER_URL=http://localhost:4000
```

**For Tier 2/3 (optional):** Add Clerk keys — see [Environment Variables](#environment-variables) below.

### 3. Start services

```bash
pnpm dev
```

This starts the MooseStack backend on port 4000 and the Next.js frontend on port 3000.

### 4. Open the app

- `http://localhost:3000` — landing page with links to all three tiers
- `http://localhost:3000/tier1` — start chatting immediately (no login)

## How It Works

```
Browser → Next.js /api/tierN/chat → getAgentResponse() → Claude Haiku 4.5
    ↕ streaming                            ↓ tool calls
Chat UI ← streamed response         MCP Server /tools (dual auth)
                                           ↓
                                     ClickHouse (readonly, optionally scoped)
```

1. User opens a tier route — `TierProvider` sets which API endpoint the chat uses
2. User sends a message — frontend POSTs to `/api/tierN/chat`
3. The API route calls `getAgentResponse()` — Tier 2/3 include the JWT and user context
4. Claude decides whether to call MCP tools (`query_clickhouse`, `get_data_catalog`)
5. The backend validates the token (PBKDF2 or JWT) and executes the query
6. Tier 3: SELECT queries are wrapped in a subquery filtered by `org_id` from JWT claims
7. Results stream back to the chat UI with query visualization

## MCP Tools

Both tools are registered in `packages/moosestack-service/app/apis/mcp.ts` and served at `/tools`.

### `query_clickhouse`

Executes read-only SQL against ClickHouse. Only SELECT, SHOW, DESCRIBE, and EXPLAIN queries are allowed. Row limit defaults to 100, max 1000. ClickHouse `readonly: 2` is enforced at the database level.

In Tier 3, the tool wraps SELECT queries in a subquery with an `org_id` filter: `SELECT * FROM (<original query>) AS _scoped WHERE org_id = '<orgId>'`. The `org_id` comes from a cryptographically signed JWT claim (Clerk JWT template `moose-mcp`).

### `get_data_catalog`

Discovers tables and views with their schemas. Supports `summary` (names + column counts) and `detailed` (full JSON schemas) formats.

In Tier 3, the catalog returns all tables (the LLM sees the same schema), but all query results are scoped to the user's organization.

## Project Structure

```
auth-chat-app/
├── packages/
│   ├── moosestack-service/          # Backend MCP server (port 4000)
│   │   ├── app/
│   │   │   ├── apis/mcp.ts          # MCP server: dual auth, tools, audit logging
│   │   │   └── ingest/models.ts     # DataEvent model (includes org_id)
│   │   └── seed-data.sql            # Multi-tenant test data
│   └── web-app/                     # Next.js frontend (port 3000)
│       └── src/
│           ├── app/
│           │   ├── tier1/           # Tier 1 route (no auth)
│           │   ├── tier2/           # Tier 2 route (Clerk auth)
│           │   ├── tier3/           # Tier 3 route (Clerk + org)
│           │   ├── sign-in/         # Clerk sign-in
│           │   ├── sign-up/         # Clerk sign-up
│           │   └── api/
│           │       ├── tier1/chat/  # Static API key
│           │       ├── tier2/chat/  # JWT + user identity
│           │       └── tier3/chat/  # JWT + org_id
│           ├── features/
│           │   ├── chat/            # Chat UI, streaming, tool rendering
│           │   └── tier/            # TierProvider context
│           └── middleware.ts        # Route protection (tier2/tier3)
├── tests/                          # Auth operations test suite (vitest)
│   ├── backend/                    # Token detection, middleware, scoping, audit
│   └── frontend/                   # System prompt, env var validation
├── docs/
│   ├── auth-guide.md               # Full auth architecture and security reference
│   └── demo-guide.md               # Step-by-step demo runbook
└── pnpm-workspace.yaml
```

## Environment Variables

### Frontend (`packages/web-app/.env.local`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | All tiers | Claude API key |
| `MCP_API_TOKEN` | Tier 1 | PBKDF2 bearer token for MCP backend |
| `MCP_SERVER_URL` | All tiers | MooseStack backend URL (`http://localhost:4000`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Tier 2/3 | Clerk frontend key |
| `CLERK_SECRET_KEY` | Tier 2/3 | Clerk server key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Tier 2/3 | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Tier 2/3 | `/sign-up` |

### Backend (`packages/moosestack-service/.env.local`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `MCP_API_KEY` | Tier 1 | PBKDF2-hashed API key |
| `JWKS_URL` | Tier 2/3 | Clerk JWKS endpoint (`https://<clerk-domain>/.well-known/jwks.json`) |
| `JWT_ISSUER` | Tier 2/3 (optional) | Clerk issuer URL for JWT `iss` claim validation — the base URL of your `JWKS_URL` (found in Clerk dashboard → Configure → API Keys → Frontend API URL) |

## Setting Up Tier 2/3 (Clerk)

Tier 1 works out of the box. For Tier 2 and 3, you need a [Clerk](https://clerk.com) account:

1. Create a Clerk application
2. Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `packages/web-app/.env.local`
3. Add `JWKS_URL` to `packages/moosestack-service/.env.local`
4. Set `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`

**For Tier 3 (data isolation):**

5. Enable Organizations in your Clerk dashboard
6. Create test organizations (e.g., org_acme and org_globex)
7. Assign test users to different organizations
8. Create a JWT template named `moose-mcp` in Clerk (Configure → JWT Templates → Blank):
   ```json
   {
     "org_id": "{{org.id}}",
     "org_slug": "{{org.slug}}",
     "email": "{{user.primary_email_address}}",
     "name": "{{user.first_name}} {{user.last_name}}"
   }
   ```
9. Update `seed-data.sql` with your actual Clerk org IDs (found in Clerk dashboard → Organizations)
10. Load seed data after services are running:
   ```bash
   docker exec -i moosestack-service-clickhousedb-1 clickhouse-client --database=local --multiquery < packages/moosestack-service/seed-data.sql
   ```

## Demo Walkthrough

For a full three-act demo script with talking points, see [docs/demo-guide.md](docs/demo-guide.md). The short version:

**Tier 1** — Open `/tier1`, chat immediately. Ask "What tables are available?" All tables visible, all data accessible, no identity.

**Tier 2** — Open `/tier2`, get redirected to sign in. After login, ask "Who am I?" — the LLM knows your name. Check backend logs for audit entries with your userId.

**Tier 3** — Open `/tier3`, use the **Organization Switcher** to select org_acme, ask "Show me all records" — only org_acme data. Switch to org_globex — same question, different data. Try to query across orgs — empty results.

## Testing

The project includes a unit test suite that validates auth operations across all three tiers. Tests use [vitest](https://vitest.dev) and run without external services for pure logic tests.

### Running tests

```bash
pnpm test              # Run all tests (single run)
pnpm test:watch        # Run in watch mode during development
```

### What's tested

| Test file | What it covers |
|-----------|---------------|
| `tests/backend/auth-detection.test.ts` | `isJwt()` token format detection — the function that routes requests to JWT vs PBKDF2 auth |
| `tests/backend/auth-middleware.test.ts` | Dual auth middleware routing logic, Bearer token extraction, JWT claim parsing |
| `tests/backend/scoped-views.test.ts` | Tier 3 data isolation — subquery wrapping with org_id filter, SQL injection escaping |
| `tests/backend/audit-logging.test.ts` | Structured audit log output for tool invocations (Tier 2/3 only) |
| `tests/frontend/system-prompt.test.ts` | User context personalization in AI system prompts |
| `tests/frontend/env-vars.test.ts` | Required/optional environment variable validation |

### Prerequisites for the full test suite

The current tests validate auth logic in isolation and do not require running services. If you extend the suite with integration tests that hit the MCP server or ClickHouse directly, you'll need:

1. Start the MooseStack backend first:
   ```bash
   pnpm dev:moose
   ```
2. Wait for ClickHouse and infrastructure to be ready.
3. Then run tests:
   ```bash
   pnpm test
   ```

## Commands

```bash
pnpm dev              # Start both services
pnpm dev:moose        # Start MooseStack backend only
pnpm dev:web          # Start Next.js frontend only
pnpm test             # Run test suite
pnpm test:watch       # Run tests in watch mode
```

```bash
pnpm --filter moosestack-service moose generate hash-token   # Generate API key pair
pnpm --filter web-app build                                   # Production build
```

## Using with Claude Code

You can connect Claude Code directly to the MCP server:

```bash
claude mcp add --transport http clickhouse http://localhost:4000/tools
```

Then ask questions like "What tables exist?" or "Show me the latest 10 events."

## Tech Stack

**Backend:** MooseStack, Express.js v5, MCP SDK, dual auth (PBKDF2 + JWT/JWKS via jose), Zod

**Frontend:** Next.js 16, React 19, Vercel AI SDK, Clerk, Radix UI, Tailwind CSS, Recharts

**Infrastructure:** ClickHouse, Redpanda/Kafka, Redis, PostgreSQL, Temporal

## Documentation

| Doc | What it covers |
|-----|---------------|
| [docs/how-it-works.md](docs/how-it-works.md) | Implementation details — code paths, query scoping, dual auth detection |
| [docs/auth-guide.md](docs/auth-guide.md) | Auth architecture — tier selection guide, security checklist, decision reference |
| [docs/demo-guide.md](docs/demo-guide.md) | Step-by-step demo runbook with setup, three-act script, and troubleshooting |

## Troubleshooting

**Port 4000 already in use:** Update `packages/moosestack-service/moose.config.toml` under `[server]`.

**Chat fails silently:** Check browser Network tab for 401 errors on `/api/tierN/chat`. For Tier 1, verify `MCP_API_TOKEN`. For Tier 2/3, verify Clerk session is active.

**Clerk redirect loop:** Verify `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and sign-in URL env vars are set.

**JWT validation fails:** Verify `JWKS_URL` matches your Clerk domain.

**Tier 3 shows all data:** Verify the Clerk JWT template `moose-mcp` is configured with `org_id` claim, verify `tier3/chat/route.ts` uses `getToken({ template: "moose-mcp" })`, and confirm the user has an active organization selected.

See [docs/demo-guide.md](docs/demo-guide.md) for more troubleshooting details.

## Learn More

- [MooseStack Documentation](https://docs.fiveonefour.com/moosestack)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Clerk Documentation](https://clerk.com/docs)
- [Vercel AI SDK](https://sdk.vercel.ai)
