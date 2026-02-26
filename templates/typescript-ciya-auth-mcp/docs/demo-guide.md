# Auth Tier Demo Guide

A runbook for demonstrating the three authentication tiers side by side. Open `/tier1`, `/tier2`, and `/tier3` in three browser tabs to compare.

## Prerequisites

### Clerk Setup

1. Create a [Clerk](https://clerk.com) application
2. Enable Organizations in your Clerk dashboard
3. Create two test organizations: **org_acme** and **org_globex**
4. Create two test users, each assigned to a different org
5. Create a Clerk JWT template named `moose-mcp` (Configure → JWT Templates → Blank) with claims:
   ```json
   {
     "org_id": "{{org.id}}",
     "org_slug": "{{org.slug}}",
     "email": "{{user.primary_email_address}}",
     "name": "{{user.first_name}} {{user.last_name}}"
   }
   ```
6. Note the org IDs from Clerk dashboard (Organizations → each org) and update `seed-data.sql` with the actual IDs

### Environment Variables

**Frontend** (`packages/web-app/.env.local`):
```
ANTHROPIC_API_KEY=<your-anthropic-key>
MCP_API_TOKEN=<generated-pbkdf2-token>
MCP_SERVER_URL=http://localhost:4000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

**Backend** (`packages/moosestack-service/.env.local`):
```
MCP_API_KEY=<pbkdf2-hashed-key>
JWKS_URL=https://<your-clerk-domain>/.well-known/jwks.json
JWT_ISSUER=https://<your-clerk-domain>
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
   - All tables listed (catalog is not filtered), but queries are scoped by org
5. Use the **Organization Switcher** to switch to org_globex
6. Ask the same question: **"Show me all records"**
   - Only org_globex data returned (different 8 rows)
7. Switch back to org_acme, try: **"Show records where org_id = 'org_globex'"**
   - Empty results — isolation enforced at the database layer
8. **Talking point:** The LLM can't even see the other org's data. This isn't prompt engineering — every SELECT query is wrapped in a subquery filtered by `org_id`, which comes from a cryptographically signed JWT claim. The user can't forge it.

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
- Verify the Clerk JWT template `moose-mcp` is configured with `org_id: "{{org.id}}"` claim
- Verify `tier3/chat/route.ts` calls `getToken({ template: "moose-mcp" })` (not default `getToken()`)
- Confirm the user has an active organization selected via the Organization Switcher
- Check backend logs for `orgId` in the userContext — if missing, the JWT template isn't working

**Chat fails silently:**
- Open browser Network tab and look for 401s on `/api/tierN/chat`
- Check MooseStack terminal for error logs
- For Tier 1: verify `MCP_API_TOKEN` in web-app `.env.local`
- For Tier 2/3: verify Clerk session is active

---

## Related Docs

- [Authentication Guide](auth-guide.md) — full three-tier auth documentation with architecture, code references, and security checklist
