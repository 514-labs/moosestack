import { ACCESS_ROLE_ADMIN_DEBUG, ACCESS_ROLE_TENANT } from "agent-contracts";
import type { Session } from "next-auth";
import { describe, expect, it } from "vitest";
import { getSessionAccess } from "../src/authz/session-access";

function createSession(
  overrides: Partial<Session["user"]>,
  idToken = "signed-token",
): Session {
  return {
    idToken,
    expires: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-1",
      name: "Default User",
      email: "user@example.com",
      image: null,
      provider: "local",
      accessRole: ACCESS_ROLE_TENANT,
      tenantId: "tenant_a",
      tenantName: "Tenant A",
      ...overrides,
    },
  };
}

describe("getSessionAccess", () => {
  it("returns a tenant access summary for tenant-scoped sessions", () => {
    const access = getSessionAccess(
      createSession({
        name: "Tenant A",
      }),
    );

    expect(access).toEqual(
      expect.objectContaining({
        kind: "tenant",
        tenantId: "tenant_a",
        tenantName: "Tenant A",
        traceScopeId: "tenant_a",
        scopeBadge: "Tenant A only",
      }),
    );
  });

  it("returns an admin debug summary for unrestricted local sessions", () => {
    const access = getSessionAccess(
      createSession({
        name: "Admin Debug",
        accessRole: ACCESS_ROLE_ADMIN_DEBUG,
        tenantId: undefined,
        tenantName: undefined,
      }),
    );

    expect(access).toEqual(
      expect.objectContaining({
        kind: "admin",
        accessRole: ACCESS_ROLE_ADMIN_DEBUG,
        traceScopeId: ACCESS_ROLE_ADMIN_DEBUG,
        scopeBadge: "Admin debug access",
      }),
    );
  });

  it("returns undefined when a tenant-scoped session omits tenant_id", () => {
    expect(
      getSessionAccess(
        createSession({
          tenantId: undefined,
          tenantName: undefined,
        }),
      ),
    ).toBeUndefined();
  });
});
