import { ACCESS_ROLE_ADMIN_DEBUG, ACCESS_ROLE_TENANT } from "agent-contracts";
import { describe, expect, it, vi } from "vitest";

import {
  assertAuthenticatedAccessContext,
  getAuthenticatedAccessContext,
  isOrgAccessContext,
  requireAuthenticatedMoose,
} from "../app/auth/access-context";

describe("access-context", () => {
  it("trims org identifiers before returning them", () => {
    const context = getAuthenticatedAccessContext({
      moose: {
        jwt: {
          access_role: ACCESS_ROLE_TENANT,
          org_id: "  org_a  ",
        },
      },
    } as never);

    expect(context && isOrgAccessContext(context)).toBe(true);
    expect(context).toEqual(
      expect.objectContaining({
        kind: "org",
        orgId: "org_a",
      }),
    );
  });

  it("requires an explicit tenant role for organization-scoped access", () => {
    expect(
      getAuthenticatedAccessContext({
        moose: {
          jwt: {
            org_id: "org_a",
          },
        },
      } as never),
    ).toBeUndefined();
  });

  it("returns admin debug access when the debug role is present", () => {
    expect(
      getAuthenticatedAccessContext({
        moose: {
          jwt: {
            access_role: ACCESS_ROLE_ADMIN_DEBUG,
          },
        },
      } as never),
    ).toEqual(
      expect.objectContaining({
        kind: "admin",
        accessRole: ACCESS_ROLE_ADMIN_DEBUG,
      }),
    );
  });

  it("returns undefined for blank org identifiers", () => {
    expect(
      getAuthenticatedAccessContext({
        moose: {
          jwt: {
            access_role: ACCESS_ROLE_TENANT,
            org_id: "   ",
          },
        },
      } as never),
    ).toBeUndefined();
  });

  it("returns undefined for non-string org identifiers", () => {
    expect(
      getAuthenticatedAccessContext({
        moose: {
          jwt: {
            access_role: ACCESS_ROLE_TENANT,
            org_id: 123,
          },
        },
      } as never),
    ).toBeUndefined();
  });

  it("responds with 401 when an org context is missing", () => {
    const next = vi.fn();
    let response: {
      status: ReturnType<typeof vi.fn>;
      json: ReturnType<typeof vi.fn>;
    };
    response = {
      status: vi.fn(() => response),
      json: vi.fn(() => response),
    };

    const result = requireAuthenticatedMoose(
      {} as never,
      response as never,
      next,
    );

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Unauthorized",
        details: expect.stringContaining("org_id"),
      }),
    );
    expect(next).not.toHaveBeenCalled();
    expect(result).toBe(response);
  });

  it("calls next when an org context is present", () => {
    const next = vi.fn();
    let response: {
      status: ReturnType<typeof vi.fn>;
      json: ReturnType<typeof vi.fn>;
    };
    response = {
      status: vi.fn(() => response),
      json: vi.fn(() => response),
    };

    const result = requireAuthenticatedMoose(
      {
        moose: {
          jwt: {
            access_role: ACCESS_ROLE_TENANT,
            org_id: "org_a",
          },
        },
      } as never,
      response as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("calls next when an admin debug context is present", () => {
    const next = vi.fn();
    let response: {
      status: ReturnType<typeof vi.fn>;
      json: ReturnType<typeof vi.fn>;
    };
    response = {
      status: vi.fn(() => response),
      json: vi.fn(() => response),
    };

    const result = requireAuthenticatedMoose(
      {
        moose: {
          jwt: {
            access_role: ACCESS_ROLE_ADMIN_DEBUG,
          },
        },
      } as never,
      response as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("asserts the authenticated access context after middleware invariants", () => {
    expect(
      assertAuthenticatedAccessContext({
        moose: {
          jwt: {
            access_role: ACCESS_ROLE_TENANT,
            org_id: "org_a",
          },
        },
      } as never),
    ).toEqual(
      expect.objectContaining({
        kind: "org",
        orgId: "org_a",
      }),
    );
  });
});
