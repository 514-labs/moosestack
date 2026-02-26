import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the dual-mode auth middleware logic.
 *
 * The middleware in mcp.ts:
 * 1. Extracts Bearer token from Authorization header
 * 2. No token + any auth configured (MCP_API_KEY or JWKS_URL) → 401
 * 3. No token + no auth configured → dev mode (allow, no userContext)
 * 4. JWT token (3 dots) + JWKS_URL → validate via jose, extract claims
 * 5. JWT token + invalid → 401
 * 6. Non-JWT token → PBKDF2 middleware
 * 7. Token present + auth configured but no matching path → 401
 *
 * Since the middleware is defined inline in mcp.ts at module scope and depends
 * on env vars read at import time, we test the logic patterns rather than
 * importing the middleware directly.
 */

// Mock the auth resolution logic extracted from the middleware
function resolveAuthPath(
  token: string | undefined,
  mcpApiKey: string | undefined,
  jwksUrl: string | undefined,
):
  | "dev_mode"
  | "reject_no_token"
  | "jwt"
  | "pbkdf2"
  | "reject_invalid_token"
  | "dev_with_token" {
  if (!token) {
    return mcpApiKey || jwksUrl ? "reject_no_token" : "dev_mode";
  }

  const isJwtToken = token.split(".").length === 3;

  if (isJwtToken && jwksUrl) {
    return "jwt";
  } else if (mcpApiKey) {
    return "pbkdf2";
  } else if (jwksUrl) {
    // Token present but not JWT format, and only JWKS auth configured — reject
    return "reject_invalid_token";
  } else {
    return "dev_with_token";
  }
}

describe("auth middleware - routing logic", () => {
  it("routes to dev mode when no token and no MCP_API_KEY", () => {
    expect(resolveAuthPath(undefined, undefined, undefined)).toBe("dev_mode");
  });

  it("rejects with 401 when no token but MCP_API_KEY is configured", () => {
    expect(resolveAuthPath(undefined, "hashed_key_here", undefined)).toBe(
      "reject_no_token",
    );
  });

  it("routes to JWT path when token is JWT format and JWKS_URL is set", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.sig";
    expect(
      resolveAuthPath(
        jwt,
        "hashed_key",
        "https://clerk.dev/.well-known/jwks.json",
      ),
    ).toBe("jwt");
  });

  it("routes to PBKDF2 when token is not JWT format", () => {
    expect(
      resolveAuthPath(
        "sk_test_abc123",
        "hashed_key",
        "https://clerk.dev/.well-known/jwks.json",
      ),
    ).toBe("pbkdf2");
  });

  it("routes to PBKDF2 when token is JWT format but no JWKS_URL", () => {
    const jwt = "a.b.c";
    expect(resolveAuthPath(jwt, "hashed_key", undefined)).toBe("pbkdf2");
  });

  it("allows dev mode when token present but no auth configured", () => {
    expect(resolveAuthPath("some_token", undefined, undefined)).toBe(
      "dev_with_token",
    );
  });

  it("rejects with 401 when no token but only JWKS_URL is configured", () => {
    expect(
      resolveAuthPath(
        undefined,
        undefined,
        "https://clerk.dev/.well-known/jwks.json",
      ),
    ).toBe("reject_no_token");
  });

  it("rejects with 401 when no token and both auth methods configured", () => {
    expect(
      resolveAuthPath(
        undefined,
        "hashed_key",
        "https://clerk.dev/.well-known/jwks.json",
      ),
    ).toBe("reject_no_token");
  });

  it("rejects non-JWT token when only JWKS_URL is configured (no PBKDF2 fallback)", () => {
    expect(
      resolveAuthPath(
        "sk_test_abc123",
        undefined,
        "https://clerk.dev/.well-known/jwks.json",
      ),
    ).toBe("reject_invalid_token");
  });
});

describe("auth middleware - token extraction", () => {
  function extractToken(authHeader: string | undefined): string | undefined {
    return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  }

  it("extracts token from valid Bearer header", () => {
    expect(extractToken("Bearer my_token_123")).toBe("my_token_123");
  });

  it("returns undefined for missing header", () => {
    expect(extractToken(undefined)).toBeUndefined();
  });

  it("returns undefined for non-Bearer auth", () => {
    expect(extractToken("Basic dXNlcjpwYXNz")).toBeUndefined();
  });

  it("returns undefined for malformed Bearer header", () => {
    expect(extractToken("Bearertoken")).toBeUndefined();
  });

  it("handles empty Bearer value", () => {
    expect(extractToken("Bearer ")).toBe("");
  });
});

describe("auth middleware - JWT claim extraction", () => {
  // Simulates what the middleware does after jwtVerify succeeds
  function extractUserContext(payload: Record<string, unknown>) {
    return {
      userId: (payload.sub as string) ?? "unknown",
      email: (payload.email as string) ?? undefined,
      name: (payload.name as string) ?? undefined,
      orgId: (payload.org_id as string) ?? undefined,
    };
  }

  it("extracts full user context from JWT claims", () => {
    const payload = {
      sub: "user_abc123",
      email: "alice@acme.com",
      name: "Alice Smith",
      org_id: "org_acme",
    };

    const ctx = extractUserContext(payload);
    expect(ctx).toEqual({
      userId: "user_abc123",
      email: "alice@acme.com",
      name: "Alice Smith",
      orgId: "org_acme",
    });
  });

  it("defaults userId to 'unknown' when sub is missing", () => {
    const ctx = extractUserContext({});
    expect(ctx.userId).toBe("unknown");
  });

  it("sets optional fields to undefined when missing", () => {
    const ctx = extractUserContext({ sub: "user_123" });
    expect(ctx.email).toBeUndefined();
    expect(ctx.name).toBeUndefined();
    expect(ctx.orgId).toBeUndefined();
  });

  it("extracts Tier 2 context (no org_id)", () => {
    const payload = {
      sub: "user_456",
      email: "bob@example.com",
      name: "Bob Jones",
    };

    const ctx = extractUserContext(payload);
    expect(ctx.orgId).toBeUndefined();
    expect(ctx.userId).toBe("user_456");
    expect(ctx.email).toBe("bob@example.com");
  });
});
