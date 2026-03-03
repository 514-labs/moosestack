# LLM Auth Implementation Guide

> **Audience:** This guide is written for an LLM (such as Claude) to follow step-by-step. It adds authentication to a chat-over-data app built from the [Chat in Your App tutorial](https://docs.fiveonefour.com/guides/chat-in-your-app/tutorial?lang=typescript).

## Before You Begin

Before writing any code, ask the user:

1. **Do you have an existing project from the [Chat in Your App tutorial](https://docs.fiveonefour.com/guides/chat-in-your-app/tutorial?lang=typescript)?**
   - If **yes**, ask for the project path and work within that existing project.
   - If **no**, follow the [Chat in Your App tutorial](https://docs.fiveonefour.com/guides/chat-in-your-app/tutorial?lang=typescript) first to create the base project, then return to this guide to add auth.

2. **Which tier do you need?**
   - **Tier 2** — JWT passthrough (user identity, audit trails, personalization)
   - **Tier 3** — Org-scoped data isolation (multi-tenant SaaS with row-level security). Includes everything in Tier 2.
   - Tier 1 (API key auth) is already part of the base tutorial — no changes needed.

3. **Do you have a Clerk account?** (Required for Tier 2 and 3)
   - If not, they need to create one at [clerk.com](https://clerk.com) and have these ready:
     - Publishable key (`pk_test_...`)
     - Secret key (`sk_test_...`)
     - Their Clerk domain (e.g., `your-app.clerk.accounts.dev`)

4. **For Tier 3 only:** Have they enabled Clerk Organizations and created at least one organization?

5. **What is the MCP endpoint path?** The base tutorial uses `/mcp`. This guide uses `/tools` (to avoid collision with MooseStack's built-in `/mcp`). Confirm which path their backend uses so the frontend URL matches.

Once you have these answers, proceed to the relevant tier section. **Implement Tier 2 first**, then continue to Tier 3 if needed — the tiers are cumulative.

## Prerequisites

- A working app from the [Chat in Your App tutorial](https://docs.fiveonefour.com/guides/chat-in-your-app/tutorial?lang=typescript)
- The base tutorial already includes **Tier 1** (PBKDF2 API key auth between frontend and MCP backend)
- This guide adds **Tier 2** (JWT passthrough with user identity) and **Tier 3** (org-scoped data isolation)

---

## Tier Selection Guide

| Tier | Use Case | What It Adds | Auth Provider Needed? |
|------|----------|-------------|----------------------|
| **Tier 1** | Internal tools, demos | API key between frontend and backend, ClickHouse readonly mode | No |
| **Tier 2** | Apps needing audit trails, personalization | JWT passthrough, per-user identity in system prompt and logs | Yes (Clerk) |
| **Tier 3** | Multi-tenant SaaS with data isolation | Org-scoped query wrapping, row-level security via `org_id` | Yes (Clerk with Organizations) |

Tiers are **cumulative**: Tier 2 builds on Tier 1, and Tier 3 builds on Tier 2. The backend auto-detects which tier is in use based on the token format.

---

## Architecture Overview

### Request Flow

```
Browser → Next.js /api/chat (POST) → getAgentResponse(messages, options?) → Claude
    ↕ streaming                                    ↓ tool calls
Chat UI ← streamed response                 MCP Server (dual auth: PBKDF2 or JWT)
                                                   ↓
                                             ClickHouse (readonly, optionally org-scoped)
```

### Auth Flow by Tier

**Tier 1 (base tutorial):**
```
Frontend sends Bearer <API_TOKEN> → Backend validates PBKDF2 hash → No user context → Query executes
```

**Tier 2:**
```
Clerk sign-in → getToken() returns JWT → Frontend sends Bearer <JWT> → Backend validates via JWKS
→ Extracts userId, email, name → Passes to system prompt + audit logs → Query executes
```

**Tier 3:**
```
Clerk sign-in + org selected → getToken({ template: "moose-mcp" }) returns JWT with org_id claim
→ Backend validates JWT → Extracts org_id → Wraps SELECT in subquery with org_id filter → Query executes
```

### Dual Auth Auto-Detection

The backend inspects the `Authorization: Bearer <token>` header:
- **3 dot-separated segments** (`xxxxx.yyyyy.zzzzz`) → JWT path (Tier 2/3)
- **Otherwise** → PBKDF2 path (Tier 1)
- **No token + no auth configured** → Dev mode (allowed, no user context)

This means both Tier 1 and Tier 2/3 requests can hit the same backend endpoint simultaneously — no config switch needed.

---

## Tier 2: JWT Passthrough

### 2.1 Set Up Clerk

1. Create a [Clerk](https://clerk.com) application
2. From the Clerk dashboard, copy:
   - **Publishable key** (`pk_test_...`)
   - **Secret key** (`sk_test_...`)
   - **JWKS URL**: `https://<your-clerk-domain>/.well-known/jwks.json`

### 2.2 Install Dependencies

**Frontend (Next.js app):**
```bash
npm install @clerk/nextjs
```

**Backend (MooseStack service):**
```bash
npm install jose express-rate-limit
```

> The backend already has `express` and `@514labs/express-pbkdf2-api-key-auth` from the base tutorial.

### 2.3 Environment Variables

Add these to your **frontend** `.env.local`:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
CLERK_SECRET_KEY=sk_test_your_key_here
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

Add these to your **backend** `.env.local`:

```env
JWKS_URL=https://your-clerk-domain.clerk.accounts.dev/.well-known/jwks.json
# Optional: validates the JWT issuer claim
JWT_ISSUER=https://your-clerk-domain.clerk.accounts.dev
```

### 2.4 Create Types

Create `src/features/chat/types.ts`:

```typescript
export interface UserContext {
  userId?: string;
  email?: string;
  name?: string;
  orgId?: string; // Used by Tier 3 only — safe to include now, ignored until Tier 3 is implemented
}

export interface AgentOptions {
  token?: string;
  userContext?: UserContext;
}
```

> The `orgId` field is only populated in Tier 3. Including it here avoids changing this file later.

### 2.5 Wrap Root Layout with ClerkProvider

Modify your root `src/app/layout.tsx` to wrap the app in `<ClerkProvider>`:

```typescript
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chat App",
  description: "Data-connected AI chat",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ClerkProvider>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
```

### 2.6 Create Middleware for Route Protection

Create `src/middleware.ts`:

```typescript
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/chat(.*)",
  "/api/chat(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
```

> Adjust the route patterns in `createRouteMatcher` to match your app's protected routes. The example above protects `/chat` and `/api/chat`.

### 2.7 Create Sign-In and Sign-Up Pages

Create `src/app/sign-in/[[...sign-in]]/page.tsx`:

```typescript
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn />
    </div>
  );
}
```

Create `src/app/sign-up/[[...sign-up]]/page.tsx`:

```typescript
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignUp />
    </div>
  );
}
```

### 2.8 Create env-vars.ts Helper

The base tutorial's `agent-config.ts` reads environment variables directly. Create `src/env-vars.ts` to centralize these lookups — the remaining steps import from this file:

```typescript
export function getMcpServerUrl(): string {
  const value = process.env.MCP_SERVER_URL;

  if (!value) {
    throw new Error("MCP_SERVER_URL environment variable is not set");
  }

  return value;
}

export function getAnthropicApiKey(): string {
  const value = process.env.ANTHROPIC_API_KEY;

  if (!value) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  return value;
}

export function getMcpApiToken(): string | undefined {
  return process.env.MCP_API_TOKEN || undefined;
}
```

> If your base tutorial app already has an `env-vars.ts` or reads these variables inline, adapt accordingly — the key requirement is that `getMcpApiToken()` returns the static API key (Tier 1) or `undefined`.

### 2.9 Update agent-config.ts

Modify `src/features/chat/agent-config.ts` to accept an optional `AgentOptions` parameter. When a JWT token is provided (Tier 2/3), it is used instead of the static API key (Tier 1):

```typescript
import { createAnthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, UIMessage, stepCountIs } from "ai";
import { experimental_createMCPClient } from "@ai-sdk/mcp";
import { getAISystemPrompt } from "./system-prompt";
import { getAnthropicApiKey, getMcpApiToken, getMcpServerUrl } from "@/env-vars";
import type { AgentOptions } from "./types";

export async function getAnthropicAgentStreamTextOptions(
  messages: UIMessage[],
  options?: AgentOptions,
): Promise<any> {
  const apiKey = getAnthropicApiKey();

  const anthropic = createAnthropic({
    apiKey: apiKey,
  });

  // Convert UIMessages to ModelMessages for AI SDK v5
  const modelMessages = convertToModelMessages(messages);

  // Create MCP client and get tools
  const mcpServerUrl = getMcpServerUrl();

  // Use JWT token if provided (Tier 2/3), otherwise fall back to static API key (Tier 1)
  const mcpToken = options?.token ?? getMcpApiToken();

  const mcpClient = await experimental_createMCPClient({
    name: "moose-mcp-server",
    transport: {
      type: "http",
      url: `${mcpServerUrl}/tools`,
      ...(mcpToken && {
        headers: {
          Authorization: `Bearer ${mcpToken}`,
        },
      }),
    },
  });

  const tools = await mcpClient.tools();

  return {
    model: anthropic("claude-haiku-4-5"),
    system: getAISystemPrompt(options?.userContext),
    messages: modelMessages,
    tools: tools,
    toolChoice: "auto",
    stopWhen: stepCountIs(25),
  };
}
```

**Key changes from the base tutorial:**
- Added `options?: AgentOptions` parameter
- Token selection: `options?.token ?? getMcpApiToken()` — JWT when available, static key otherwise
- System prompt receives `options?.userContext` for personalization

> **Note:** The MCP endpoint URL above uses `/tools` to avoid collision with MooseStack's built-in `/mcp` endpoint. If your base tutorial app uses `/mcp` as its MCP mount path, change the URL here to match. The path must agree with the `mountPath` in the backend's `WebApp` export (see step 2.13).

### 2.10 Update get-agent-response.ts

Modify `src/features/chat/get-agent-response.ts` to forward the `AgentOptions`:

```typescript
import {
  UIMessage,
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { getAnthropicAgentStreamTextOptions } from "./agent-config";
import type { AgentOptions } from "./types";

export async function getAgentResponse(
  messages: UIMessage[],
  options?: AgentOptions,
) {
  const streamTextOptions = await getAnthropicAgentStreamTextOptions(
    messages,
    options,
  );

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = streamText(streamTextOptions);
      writer.merge(result.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
}
```

**Key change:** Added `options?: AgentOptions` parameter and passed it through to `getAnthropicAgentStreamTextOptions`.

### 2.11 Update system-prompt.ts

Modify `src/features/chat/system-prompt.ts` to include user identity when available:

```typescript
import type { UserContext } from "./types";

export function getAISystemPrompt(userContext?: UserContext): string {
  let prompt = `You are a helpful AI assistant that can help users with various tasks using available tools.

When users ask questions:
1. Use the available tools to help answer their questions
2. Be conversational and explain what you're doing
3. Return clear, concise answers
4. If a tool is available for a task, use it rather than making assumptions
5. Format results appropriately for easy reading

Be helpful, accurate, and transparent about what tools you're using.`;

  if (userContext) {
    const parts: string[] = [];
    if (userContext.name) parts.push(`name: ${userContext.name}`);
    if (userContext.email) parts.push(`email: ${userContext.email}`);
    if (userContext.orgId) parts.push(`organization: ${userContext.orgId}`);

    if (parts.length > 0) {
      prompt += `\n\nThe current user's identity:\n${parts.join("\n")}\n\nYou may address the user by name when appropriate. Never expose raw user IDs or internal identifiers in responses.`;
    }
  }

  return prompt;
}
```

### 2.12 Update the Chat API Route

The base tutorial's `src/app/api/chat/route.ts` looks like this (no auth, no user context):

```typescript
// BEFORE (base tutorial — Tier 1)
import { NextRequest } from "next/server";
import { UIMessage } from "ai";
import { getAgentResponse } from "@/features/chat/get-agent-response";

interface ChatBody {
  messages: UIMessage[];
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatBody = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({
          error: "Invalid request body",
          details: "messages must be an array",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    return await getAgentResponse(messages);
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
```

**Replace the entire file** with this Tier 2 version that authenticates via Clerk and passes the JWT + user context:

```typescript
import { NextRequest } from "next/server";
import { UIMessage } from "ai";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getAgentResponse } from "@/features/chat/get-agent-response";

interface ChatBody {
  messages: UIMessage[];
}

export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const [token, user, body] = await Promise.all([
      getToken(),
      currentUser(),
      request.json() as Promise<ChatBody>,
    ]);

    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({
          error: "Invalid request body",
          details: "messages must be an array",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    return await getAgentResponse(messages, {
      token: token ?? undefined,
      userContext: {
        userId,
        email: user?.primaryEmailAddress?.emailAddress ?? undefined,
        name: user?.fullName ?? undefined,
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
```

**Key changes from the base tutorial route:**
- Import `auth` and `currentUser` from `@clerk/nextjs/server`
- Call `auth()` to get `userId` and `getToken`
- Return 401 if not authenticated
- Pass `{ token, userContext }` to `getAgentResponse`

### 2.13 Update Backend: Dual Auth Middleware

**Replace the entire contents** of your backend MCP file (e.g., `app/apis/mcp.ts`) with the following. This adds JWT validation via JWKS alongside the existing PBKDF2 auth, plus rate limiting and audit logging:

```typescript
import express, { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod/v3";
import { WebApp, getMooseUtils, MooseUtils } from "@514labs/moose-lib";
import { createAuthMiddleware } from "@514labs/express-pbkdf2-api-key-auth";
import { jwtVerify, createRemoteJWKSet } from "jose";
import rateLimit from "express-rate-limit";

/**
 * User context extracted from JWT claims (Tier 2/3).
 * Undefined for Tier 1 (PBKDF2 API key auth).
 */
export interface UserContext {
  userId: string;
  email?: string;
  name?: string;
  orgId?: string;
}

// Helper: ClickHouse readonly query with optional parameterized values
export function clickhouseReadonlyQuery(
  client: MooseUtils["client"],
  sql: string,
  limit = 100,
  queryParams?: Record<string, string>,
): ReturnType<MooseUtils["client"]["query"]["client"]["query"]> {
  return client.query.client.query({
    query: sql,
    format: "JSONEachRow",
    clickhouse_settings: {
      readonly: "2",
      limit: limit.toString(),
    },
    ...(queryParams && { query_params: queryParams }),
  });
}

// --- Auth detection helper ---

export function isJwt(token: string): boolean {
  return token.split(".").length === 3;
}

// --- Express app setup ---

const app = express();
app.use(express.json());

// Environment variables for auth
const mcpApiKey = process.env.MCP_API_KEY;
const jwksUrl = process.env.JWKS_URL;
const jwtIssuer = process.env.JWT_ISSUER;

// Lazy-init JWKS keyset on first JWT request
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks() {
  if (!jwks && jwksUrl) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
  }
  return jwks;
}

// PBKDF2 middleware (Tier 1) — only created if MCP_API_KEY is set
const pbkdf2Middleware = mcpApiKey
  ? createAuthMiddleware(() => mcpApiKey)
  : undefined;

// Rate limiting: 300 requests per minute per IP
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

// --- Dual auth middleware ---
// Auto-detects PBKDF2 vs JWT from token format
app.use(async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : undefined;

  if (!token) {
    // No token: if any auth is configured, reject; otherwise dev mode
    if (mcpApiKey || jwksUrl) {
      res.status(401).json({ error: "Missing authorization token" });
      return;
    }
    (req as any).userContext = undefined;
    next();
    return;
  }

  if (isJwt(token) && jwksUrl) {
    // JWT path (Tier 2/3)
    try {
      const keyset = getJwks();
      if (!keyset) {
        res.status(500).json({ error: "JWKS not configured" });
        return;
      }
      const { payload } = await jwtVerify(token, keyset, {
        ...(jwtIssuer && { issuer: jwtIssuer }),
      });
      const userContext: UserContext = {
        userId: payload.sub ?? "unknown",
        email: (payload.email as string) ?? undefined,
        name: (payload.name as string) ?? undefined,
        orgId: (payload.org_id as string) || undefined,
      };
      (req as any).userContext = userContext;
      next();
    } catch (error) {
      console.error("[MCP Auth] JWT validation failed:", error);
      res.status(401).json({ error: "Invalid JWT" });
    }
  } else if (pbkdf2Middleware) {
    // PBKDF2 path (Tier 1)
    (req as any).userContext = undefined;
    pbkdf2Middleware(req, res, next);
  } else if (mcpApiKey || jwksUrl) {
    res.status(401).json({ error: "Invalid authorization token" });
  } else {
    // Dev mode: no auth configured
    (req as any).userContext = undefined;
    next();
  }
});

// --- MCP server factory ---

export const serverFactory = (mooseUtils: MooseUtils, userContext?: UserContext) => {
  const server = new McpServer({
    name: "moosestack-mcp-tools",
    version: "1.0.0",
  });

  server.tool(
    "query_clickhouse",
    "Execute a read-only query against the ClickHouse OLAP database and return results as JSON.",
    {
      query: z.string().describe("SQL query to execute against ClickHouse"),
      limit: z
        .number()
        .min(1)
        .max(1000)
        .default(100)
        .optional()
        .describe("Maximum number of rows to return (default: 100, max: 1000)"),
    },
    { title: "Query ClickHouse Database" },
    async ({ query, limit = 100 }) => {
      try {
        const { client } = mooseUtils;
        const finalQuery = query.trim();

        const result = await clickhouseReadonlyQuery(client, finalQuery, limit);
        const data = await result.json();
        const rows = Array.isArray(data) ? data : [];

        // Audit logging (Tier 2/3)
        if (userContext) {
          console.log(
            JSON.stringify({
              event: "tool_invocation",
              tool: "query_clickhouse",
              userId: userContext.userId,
              email: userContext.email,
              orgId: userContext.orgId,
              query: query.trim(),
              rowCount: rows.length,
              timestamp: new Date().toISOString(),
            }),
          );
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ rows, rowCount: rows.length }, null, 2) }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error executing query: ${errorMessage}` }],
          isError: true,
        };
      }
    },
  );

  // Register additional tools (get_data_catalog, etc.) following the same pattern...

  return server;
};

// --- MCP request handler ---

app.all("/", async (req, res) => {
  try {
    const mooseUtils = await getMooseUtils();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = serverFactory(mooseUtils, (req as any).userContext);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[MCP Error] Failed to handle request:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Mount at /tools to avoid collision with MooseStack's built-in /mcp endpoint.
// This path must match the URL in agent-config.ts (step 2.9).
export const mcpServer = new WebApp("mcpServer", app, {
  mountPath: "/tools",
});
```

### 2.14 Verify Tier 2

1. Start both services (`pnpm dev` or equivalent)
2. Open your app — you should be redirected to the Clerk sign-in page
3. Sign in and open the chat
4. Ask: **"Who am I?"** — the AI should address you by name
5. Check your backend console for audit log entries like:
   ```json
   {"event":"tool_invocation","tool":"query_clickhouse","userId":"user_xxx","email":"you@example.com","query":"...","rowCount":5,"timestamp":"..."}
   ```

---

> **STOP HERE if the user only needs Tier 2.** Tier 2 is complete. The app now has Clerk sign-in, JWT-authenticated MCP calls, per-user system prompts, and audit logging. Continue below only if the user needs Tier 3 (org-scoped data isolation).

---

## Tier 3: Org-Scoped Data Isolation

Tier 3 builds on Tier 2. Complete all Tier 2 steps (2.1–2.14) first.

### 3.1 Configure Clerk Organizations

1. In the Clerk Dashboard, go to **Organizations** and enable the feature
2. Create at least one organization and invite your test user
3. Go to **JWT Templates** → **Create template**:
   - **Name:** `moose-mcp`
   - **Claims:**
     ```json
     {
       "org_id": "{{org.id}}",
       "org_slug": "{{org.slug}}",
       "email": "{{user.primary_email_address}}",
       "name": "{{user.full_name}}"
     }
     ```
   - Save the template

> **CRITICAL:** The template **must** be named exactly `moose-mcp`. The Tier 3 API route calls `getToken({ template: "moose-mcp" })` to request this specific template. If the name doesn't match, `getToken()` silently returns `null`, and the backend will reject the request with a 401 or fall back to Tier 1 (PBKDF2) auth — with no org_id in the JWT and therefore no data isolation.

### 3.2 Add org_id to Your Data Model

Ensure your data model includes an `org_id` field for tenant identification:

```typescript
import { IngestPipeline, Key } from "@514labs/moose-lib";

export interface DataEvent {
  eventId: Key<string>;
  timestamp: Date;
  eventType: string;
  data: string;
  org_id: string; // Tenant identifier for row-level security
}

export const DataEventPipeline = new IngestPipeline<DataEvent>("DataEvent", {
  table: true,
  stream: true,
  ingestApi: true,
});
```

When ingesting data, always include the `org_id` so that Tier 3 query scoping can filter by it.

### 3.3 Update the Chat API Route for Tier 3

**Replace the entire contents** of `src/app/api/chat/route.ts` (the Tier 2 version from step 2.12) with this Tier 3 version. It adds org ID extraction and uses the custom JWT template:

```typescript
import { NextRequest } from "next/server";
import { UIMessage } from "ai";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getAgentResponse } from "@/features/chat/get-agent-response";

interface ChatBody {
  messages: UIMessage[];
}

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId, getToken } = await auth();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    // Tier 3: require an active organization
    if (!orgId) {
      return new Response(
        JSON.stringify({
          error: "No organization selected",
          details: "Please select an organization to continue.",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    // Use the custom JWT template that includes org_id in claims
    const [token, user, body] = await Promise.all([
      getToken({ template: "moose-mcp" }),
      currentUser(),
      request.json() as Promise<ChatBody>,
    ]);

    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({
          error: "Invalid request body",
          details: "messages must be an array",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    return await getAgentResponse(messages, {
      token: token ?? undefined,
      userContext: {
        userId,
        email: user?.primaryEmailAddress?.emailAddress ?? undefined,
        name: user?.fullName ?? undefined,
        orgId: orgId ?? undefined,
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
```

**Key differences from Tier 2:**
- Destructure `orgId` from `auth()`
- Return 403 if no organization is selected
- Use `getToken({ template: "moose-mcp" })` instead of `getToken()` — this JWT includes `org_id` in its claims
- Pass `orgId` in `userContext`

### 3.4 Backend: Add Org-Scoped Query Wrapping

In the backend MCP file (e.g., `app/apis/mcp.ts`), find the `query_clickhouse` tool handler inside `serverFactory`. Locate these lines (from step 2.13):

```typescript
        const finalQuery = query.trim();

        const result = await clickhouseReadonlyQuery(client, finalQuery, limit);
```

**Replace them** with the following, which wraps SELECT/WITH queries in an org-scoped subquery when `userContext.orgId` is present:

```typescript
        let finalQuery = query.trim();

        // Tier 3: wrap query in subquery with org_id filter for data isolation
        let scopeParams: Record<string, string> | undefined;
        if (userContext?.orgId) {
          const upperQuery = finalQuery.toUpperCase();
          if (upperQuery.startsWith("SELECT") || upperQuery.startsWith("WITH")) {
            finalQuery = `SELECT * FROM (${finalQuery}) AS _scoped WHERE org_id = {_scope_org_id:String}`;
            scopeParams = { _scope_org_id: userContext.orgId };
          }
        }

        const result = await clickhouseReadonlyQuery(client, finalQuery, limit, scopeParams);
```

**How it works:**
- The original query becomes a subquery: `SELECT * FROM (<original>) AS _scoped WHERE org_id = '<org_id>'`
- The `org_id` value comes **exclusively from the signed JWT claims** — never from request headers or user input
- Uses **ClickHouse parameterized queries** (`{_scope_org_id:String}`) to prevent SQL injection
- Only SELECT and WITH (CTE) queries are wrapped — SHOW, DESCRIBE, and EXPLAIN pass through unscoped (they return metadata, not tenant data)

**Example transformation:**

User's AI asks to run:
```sql
SELECT eventType, count() as cnt FROM DataEvent GROUP BY eventType
```

Backend wraps it to:
```sql
SELECT * FROM (
  SELECT eventType, count() as cnt FROM DataEvent GROUP BY eventType
) AS _scoped WHERE org_id = {_scope_org_id:String}
```

With `query_params: { _scope_org_id: "org_abc123" }`.

### 3.5 Optional: Organization Switcher UI

Add the Clerk `<OrganizationSwitcher />` component to your layout so users can switch between organizations:

```typescript
import { OrganizationSwitcher } from "@clerk/nextjs";

// In your layout or header component:
<OrganizationSwitcher />
```

### 3.6 Verify Tier 3

1. Create two organizations in Clerk (e.g., "Acme Corp" and "Globex Inc")
2. Seed data with different `org_id` values matching each organization's Clerk org ID
3. Sign in, select "Acme Corp" as your active organization
4. Ask the AI to query data — you should only see Acme Corp's data
5. Switch to "Globex Inc" and repeat — you should only see Globex data
6. Try asking the AI to query without an org filter — the subquery wrapping ensures isolation automatically

---

## Security Checklist

- [ ] **ClickHouse readonly mode:** All queries execute with `readonly: "2"` — no data modification possible
- [ ] **Row limits:** Default 100, max 1000 rows per query
- [ ] **JWT signature validation:** JWTs are validated against Clerk's JWKS endpoint (public key cryptography, no shared secrets)
- [ ] **org_id from signed claims only:** The org_id used for query scoping comes from the JWT payload, not from request headers or user input
- [ ] **Parameterized queries:** Org-scoped queries use ClickHouse parameterized values (`{_scope_org_id:String}`) to prevent SQL injection
- [ ] **Rate limiting:** 300 requests per minute per IP to prevent abuse
- [ ] **Audit logging:** All tool invocations with user context are logged with userId, email, orgId, query, and timestamp
- [ ] **No token = rejected:** If auth is configured (API key or JWKS), requests without a token are rejected with 401

---

## Troubleshooting

### Clerk Issues

| Problem | Fix |
|---------|-----|
| Redirect loop on sign-in | Verify `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` is set and the catch-all route exists at `src/app/sign-in/[[...sign-in]]/page.tsx` |
| `auth()` returns null userId | Ensure `clerkMiddleware` is in `src/middleware.ts` and the route matcher includes your API paths |
| Sign-in page not styled | ClerkProvider must wrap your root layout; check that `@clerk/nextjs` is installed |

### JWT Issues

| Problem | Fix |
|---------|-----|
| 401 "Invalid JWT" from backend | Check that `JWKS_URL` is correct and accessible. Verify with: `curl <your-jwks-url>` |
| JWT missing org_id claim | Ensure the Clerk JWT template named `moose-mcp` includes `"org_id": "{{org.id}}"` and you're calling `getToken({ template: "moose-mcp" })` |
| Token is undefined | `getToken()` returns null if the user isn't authenticated. Check that `auth.protect()` runs before your API route |
| "JWKS not configured" 500 error | Set the `JWKS_URL` environment variable in the backend `.env.local` |

### Data Isolation Issues

| Problem | Fix |
|---------|-----|
| 403 "No organization selected" | User must select an active organization. Add `<OrganizationSwitcher />` to your UI |
| Query returns empty results | Verify that data exists with a matching `org_id`. The org_id is the Clerk organization ID (e.g., `org_xxx`), not the slug |
| Cross-tenant data visible | Ensure the JWT contains `org_id` and the backend's subquery wrapping is active. Check audit logs for the orgId value |
| SHOW/DESCRIBE queries fail with org filter | These query types are intentionally not wrapped — they return metadata, not tenant data |

---

## Complete File Reference

### Files Modified for Tier 2

| File | Change |
|------|--------|
| `src/features/chat/types.ts` | **New** — `UserContext` and `AgentOptions` interfaces |
| `src/env-vars.ts` | **New** (or verify existing) — `getMcpServerUrl`, `getAnthropicApiKey`, `getMcpApiToken` helpers |
| `src/app/layout.tsx` | Wrap with `<ClerkProvider>` |
| `src/middleware.ts` | **New** — Clerk route protection |
| `src/app/sign-in/[[...sign-in]]/page.tsx` | **New** — Clerk sign-in page |
| `src/app/sign-up/[[...sign-up]]/page.tsx` | **New** — Clerk sign-up page |
| `src/features/chat/agent-config.ts` | Add `options?` param, use JWT over static key |
| `src/features/chat/get-agent-response.ts` | Forward `options` parameter |
| `src/features/chat/system-prompt.ts` | Append user identity when `userContext` provided |
| `src/app/api/chat/route.ts` | Call `auth()`, `getToken()`, `currentUser()`, pass to `getAgentResponse` |
| Backend `app/apis/mcp.ts` | Add JWT validation via JWKS, dual auth middleware, audit logging, rate limiting |
| Frontend `.env.local` | Add Clerk keys |
| Backend `.env.local` | Add `JWKS_URL`, optionally `JWT_ISSUER` |

### Additional Files Modified for Tier 3

| File | Change |
|------|--------|
| Backend `app/apis/mcp.ts` | Add org-scoped subquery wrapping with `org_id` filter to `query_clickhouse` tool handler |
| `src/app/api/chat/route.ts` | Extract `orgId` from `auth()`, use `getToken({ template: "moose-mcp" })`, return 403 if no org |
| Data model (e.g., `app/ingest/models.ts`) | Add `org_id: string` field |
| Clerk Dashboard | Enable Organizations, create `moose-mcp` JWT template |

---

## Optional: Multi-Tier Demo Setup

If you want to run all three tiers simultaneously (useful for demos and comparison), create separate routes and a `TierProvider` context.

### TierProvider Context

Create `src/features/tier/tier-provider.tsx`:

```typescript
"use client";

import { createContext, useContext } from "react";

interface TierConfig {
  tier: 1 | 2 | 3;
  apiPath: string;
  tierLabel: string;
}

const tierConfigs: Record<1 | 2 | 3, TierConfig> = {
  1: { tier: 1, apiPath: "/api/tier1/chat", tierLabel: "Tier 1: API Key" },
  2: { tier: 2, apiPath: "/api/tier2/chat", tierLabel: "Tier 2: JWT Passthrough" },
  3: { tier: 3, apiPath: "/api/tier3/chat", tierLabel: "Tier 3: Org-Scoped Data Isolation" },
};

const TierContext = createContext<TierConfig | null>(null);


export function TierProvider({
  tier,
  children,
}: {
  tier: 1 | 2 | 3;
  children: React.ReactNode;
}) {
  return (
    <TierContext.Provider value={tierConfigs[tier]}>
      {children}
    </TierContext.Provider>
  );
}

export function useTier(): TierConfig {
  const context = useContext(TierContext);
  if (!context) {
    throw new Error("useTier must be used within a TierProvider");
  }
  return context;
}
```

### Separate Routes

Create tier-specific routes (e.g., `/tier1`, `/tier2`, `/tier3`), each wrapping the chat UI in a `TierProvider`:

```typescript
// src/app/tier1/page.tsx
import { TierProvider } from "@/features/tier/tier-provider";
import { ChatUI } from "@/features/chat/chat-ui";

export default function Tier1Page() {
  return (
    <TierProvider tier={1}>
      <ChatUI />
    </TierProvider>
  );
}
```

Then create separate API routes (`/api/tier1/chat`, `/api/tier2/chat`, `/api/tier3/chat`) that each implement their tier's auth logic, and have the `ChatUI` component read the API path from the `useTier()` hook.

---

## Notes on Auth Provider Alternatives

This guide uses **Clerk** as the auth provider, but the backend's JWKS-based validation works with any provider that issues **asymmetric JWTs** (signed with RS256 or ES256) and exposes a JWKS endpoint. The key requirements are:

1. **Issues signed JWTs (JWS, not JWE)** — The backend uses `jose` `jwtVerify` + `createRemoteJWKSet`, which validates **signatures** on standard JWTs. Providers that issue encrypted tokens (JWE) are not compatible without significant rework.
2. **Provides a JWKS endpoint** — Set `JWKS_URL` to the provider's public key endpoint (the path varies by provider — see table below).
3. **Supports custom JWT claims** — For Tier 3, the JWT must include `org_id` (or equivalent). Some providers require namespacing custom claims.

### Provider Compatibility

| Provider | Compatible? | JWKS URL | Custom Claims Notes |
|----------|------------|----------|-------------------|
| **Clerk** | Yes (this guide) | `https://<domain>/.well-known/jwks.json` | Custom JWT templates with arbitrary claims |
| **Auth0** | Yes | `https://<tenant>.auth0.com/.well-known/jwks.json` | Custom claims **must be namespaced** (e.g. `https://yourco.com/org_id`, not bare `org_id`). Unnamespaced claims are silently dropped from access tokens. The backend would need to extract from the namespaced key. |
| **Firebase Auth** | Yes (with URL change) | `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com` | Custom claims added server-side via Firebase Admin SDK. Limited to 1000 bytes total. Note: Firebase uses `uid` as the primary user identifier, not `sub`. |
| **Supabase Auth** | Yes (with URL change) | `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` | Custom claims via Auth Hooks. Uses asymmetric signing (RS256/ES256) by default. Note the `/auth/v1` prefix in the JWKS path. |
| **NextAuth / Auth.js** | **No** (not without major rework) | No built-in JWKS endpoint | NextAuth uses **JWE (encrypted tokens)** by default, not signed JWTs. It does not expose a JWKS endpoint. Making it compatible requires overriding encode/decode to use asymmetric JWS, generating RSA keys, and building a custom JWKS route. This is not a drop-in replacement. |

### To adapt for a compatible provider:
- Replace `@clerk/nextjs` imports with your provider's SDK
- Replace `auth()`, `getToken()`, `currentUser()` with your provider's equivalents
- Set `JWKS_URL` to your provider's endpoint (see table above)
- Ensure the JWT includes the claims expected by the backend (`sub`, `email`, `name`, and optionally `org_id`)
- For Auth0: update the backend to read namespaced claims (e.g. `payload["https://yourco.com/org_id"]` instead of `payload.org_id`)
