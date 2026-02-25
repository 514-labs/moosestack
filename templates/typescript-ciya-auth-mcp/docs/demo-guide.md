# Auth Tier Demo Guide

A runbook for demonstrating the three authentication tiers side by side. Open `/tier1`, `/tier2`, and `/tier3` in three browser tabs to compare.

## Prerequisites

### Clerk Setup

1. Create a [Clerk](https://clerk.com) application
2. Enable Organizations in your Clerk dashboard
3. Create two test organizations: **org_acme** and **org_globex**
4. Create two test users, each assigned to a different org
5. Note the org IDs from Clerk — you may need to configure a JWT template that includes `org_id` in claims

### Environment Variables

**Frontend** (`packages/web-app/.env.local`):
```
ANTHROPIC_API_KEY=<your-anthropic-key>
MCP_API_TOKEN=<generated-pbkdf2-token>
NEXT_PUBLIC_MCP_SERVER_URL=http://localhost:4000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

**Backend** (`packages/moosestack-service/.env.local`):
```
MCP_API_KEY=<pbkdf2-hashed-key>
JWKS_URL=https://<your-clerk-domain>/.well-known/jwks.json
```

### Seed Data

After both services are running and the DataEvent table is created:

```bash
# Load multi-tenant test data (uses ClickHouse client inside Docker container)
docker exec -i moosestack-service-clickhousedb-1 clickhouse-client --database=local --multiquery < packages/moosestack-service/seed-data.sql
```

### Start Services

```bash
pnpm dev
```

This starts the MooseStack backend (port 4000) and Next.js frontend (port 3000).

---

## Demo Script

### Act 1: Tier 1 — Open Access, Shared Secret

1. Open `http://localhost:3000/tier1` — no login, page loads immediately
2. Open the chat panel
3. Ask: **"What tables are available?"**
   - `get_data_catalog` returns all tables including base tables
4. Ask: **"Show me all records in DataEvent"**
   - Query executes, all data from both orgs is returned
5. **Talking point:** No user identity, no audit trail. The API key proves the caller is your frontend, but anyone at the URL can chat. This is fine for internal demos.

### Act 2: Tier 2 — Identity and Audit

1. Open `http://localhost:3000/tier2` in a new tab
2. You are redirected to the Clerk sign-in page
3. Sign in as Test User A — redirected back to `/tier2`
4. Notice the `<UserButton>` showing your identity
5. Open the chat panel and ask: **"Who am I?"**
   - The LLM responds with your name and email
6. Ask a data question — same results as Tier 1
7. Check the MooseStack backend terminal for audit log entries:
   ```json
   {"event":"tool_invocation","tool":"query_clickhouse","userId":"user_xxx","email":"alice@example.com",...}
   ```
8. **Talking point:** Same data as Tier 1, but every query is now attributable. You know who asked what, and when. This is the minimum for any deployment beyond your immediate team.

### Act 3: Tier 3 — Data Isolation

1. Open `http://localhost:3000/tier3` — sign in if prompted
2. Use the **Organization Switcher** at the top to select org_acme
3. Ask: **"Show me all records"**
   - Only org_acme data returned (8 rows)
4. Ask: **"What tables are available?"**
   - Only `DataEvent_scoped` view is listed — base tables are hidden
5. Use the **Organization Switcher** to switch to org_globex
6. Ask the same question: **"Show me all records"**
   - Only org_globex data returned (different 8 rows)
7. Switch back to org_acme, try: **"Show records where org_id = 'org_globex'"**
   - Empty results — isolation enforced at the database layer
8. **Talking point:** The LLM can't even see the other org's data. This isn't prompt engineering — it's the database enforcing boundaries. The scoped view resolves `{org_id}` from the JWT claim automatically.

---

## Talking Points by Tier

| Tier | Security Boundary | What Backend Knows | When to Use |
|------|-------------------|-------------------|-------------|
| 1 | API key validates the calling app | Nothing about the user | Internal demos, prototyping |
| 2 | JWT validates user identity | userId, email, name | Internal tools, audit-required deployments |
| 3 | JWT + org scopes data access | userId, email, name, orgId | Customer-facing, multi-tenant SaaS |

---

## Troubleshooting

**Clerk redirect loop:**
- Verify `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set correctly
- Check that `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` is set
- Ensure the sign-in/sign-up routes exist at `/sign-in` and `/sign-up`

**JWT validation fails on backend:**
- Verify `JWKS_URL` in moosestack-service `.env.local` matches your Clerk domain
- Format: `https://<clerk-domain>/.well-known/jwks.json`
- Check that the Clerk JWT includes the expected claims (sub, email, org_id)

**Tier 3 returns all data (no isolation):**
- Verify the `DataEvent_scoped` view exists in ClickHouse
- Check that the JWT includes `org_id` in claims (may need a Clerk JWT template)
- Confirm the user has an active organization selected in Clerk

**Chat fails silently:**
- Open browser Network tab and look for 401s on `/api/tierN/chat`
- Check MooseStack terminal for error logs
- For Tier 1: verify `MCP_API_TOKEN` in web-app `.env.local`
- For Tier 2/3: verify Clerk session is active

**Scoped views not created:**
- Check MooseStack logs for "[MCP] Scoped views initialized" or errors
- Manually run: `CREATE VIEW IF NOT EXISTS DataEvent_scoped AS SELECT * FROM DataEvent WHERE org_id = {org_id:String}`

---

## Related Docs

- [Authentication Guide](auth-guide.md) — full three-tier auth documentation with architecture, code references, and security checklist
