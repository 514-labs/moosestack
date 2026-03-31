import { ACCESS_ROLE_ADMIN_DEBUG } from "agent-contracts";
import { describe, expect, it, vi } from "vitest";

import {
  assertAuthenticatedAccessContext,
  getAuthenticatedAccessContext,
  isTenantAccessContext,
  requireAuthenticatedMoose,
} from "../app/auth/access-context";

describe("access-context", () => {
  it("trims tenant identifiers before returning them", () => {
    const context = getAuthenticatedAccessContext({
      moose: {
        jwt: {
          tenant_id: "  tenant_a  ",
        },
      },
    } as never);

    expect(context && isTenantAccessContext(context)).toBe(true);
    expect(context).toEqual(
      expect.objectContaining({
        kind: "tenant",
        tenantId: "tenant_a",
        rowPolicyOptions: {
          role: "moose_rls_role",
          clickhouse_settings: {
            SQL_moose_rls_tenant_id: "  tenant_a  ",
          },
        },
      }),
    );
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

  it("returns undefined for blank tenant identifiers", () => {
    expect(
      getAuthenticatedAccessContext({
        moose: {
          jwt: {
            tenant_id: "   ",
          },
        },
      } as never),
    ).toBeUndefined();
  });

  it("returns undefined for non-string tenant identifiers", () => {
    expect(
      getAuthenticatedAccessContext({
        moose: {
          jwt: {
            tenant_id: 123,
          },
        },
      } as never),
    ).toBeUndefined();
  });

  it("responds with 401 when a tenant context is missing", () => {
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
        details: expect.stringContaining("tenant_id"),
      }),
    );
    expect(next).not.toHaveBeenCalled();
    expect(result).toBe(response);
  });

  it("calls next when a tenant context is present", () => {
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
            tenant_id: "tenant_a",
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
            tenant_id: "tenant_a",
          },
        },
      } as never),
    ).toEqual(
      expect.objectContaining({
        kind: "tenant",
        tenantId: "tenant_a",
      }),
    );
  });
});
