import { describe, expect, it, vi } from "vitest";

import {
  getTenantMooseContext,
  requireTenantMoose,
} from "../app/http/context/tenant-context";

describe("tenant-context", () => {
  it("trims tenant identifiers before returning them", () => {
    const context = getTenantMooseContext({
      moose: {
        jwt: {
          tenant_id: "  acme  ",
        },
      },
    } as never);

    expect(context).toEqual(
      expect.objectContaining({
        tenantId: "acme",
      }),
    );
  });

  it("returns undefined for blank tenant identifiers", () => {
    expect(
      getTenantMooseContext({
        moose: {
          jwt: {
            tenant_id: "   ",
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

    const result = requireTenantMoose({} as never, response as never, next);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Unauthorized",
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

    const result = requireTenantMoose(
      {
        moose: {
          jwt: {
            tenant_id: "acme",
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
});
