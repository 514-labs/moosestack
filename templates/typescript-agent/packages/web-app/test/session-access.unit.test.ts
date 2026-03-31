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
      orgId: "org_a",
      orgName: "Org A",
      ...overrides,
    },
  };
}

describe("getSessionAccess", () => {
  it("returns an org access summary for organization-scoped sessions", () => {
    const access = getSessionAccess(
      createSession({
        name: "Org A",
      }),
    );

    expect(access).toEqual(
      expect.objectContaining({
        kind: "org",
        orgId: "org_a",
        orgName: "Org A",
        accessScopeId: "org_a",
        scopeBadge: "Org A only",
      }),
    );
  });

  it("returns an admin debug summary for unrestricted local sessions", () => {
    const access = getSessionAccess(
      createSession({
        name: "Admin Debug",
        accessRole: ACCESS_ROLE_ADMIN_DEBUG,
        orgId: undefined,
        orgName: undefined,
      }),
    );

    expect(access).toEqual(
      expect.objectContaining({
        kind: "admin",
        accessRole: ACCESS_ROLE_ADMIN_DEBUG,
        accessScopeId: ACCESS_ROLE_ADMIN_DEBUG,
        scopeBadge: "Admin debug access",
      }),
    );
  });

  it("returns undefined when an organization-scoped session omits org_id", () => {
    expect(
      getSessionAccess(
        createSession({
          orgId: undefined,
          orgName: undefined,
        }),
      ),
    ).toBeUndefined();
  });
});
