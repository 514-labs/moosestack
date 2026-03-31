import type { DashboardSnapshot } from "agent-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getMooseServiceUrlMock } = vi.hoisted(() => {
  return {
    getMooseServiceUrlMock: vi.fn(() => "http://moose.local"),
  };
});

vi.mock("@/env-vars", () => {
  return {
    getMooseServiceUrl: getMooseServiceUrlMock,
  };
});

import {
  DashboardSnapshotUnauthorizedError,
  getDashboardSnapshot,
} from "../src/lib/moose-service";

describe("getDashboardSnapshot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("passes the bearer token to the Moose dashboard API", async () => {
    const snapshot = {
      knowledgeMetrics: {
        totalRecords: 4,
        highPriorityRecords: 2,
      },
      recentKnowledge: [],
    } satisfies DashboardSnapshot;

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify(snapshot), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(getDashboardSnapshot("tenant-token")).resolves.toEqual(
      snapshot,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://moose.local/app/dashboard/snapshot",
      {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer tenant-token",
        },
      },
    );
  });

  it("throws a descriptive error when the dashboard API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("nope", {
          status: 503,
          statusText: "Service Unavailable",
        });
      }),
    );

    await expect(getDashboardSnapshot("tenant-token")).rejects.toThrow(
      "Failed to load dashboard snapshot: 503 Service Unavailable",
    );
  });

  it("throws a specific error when the dashboard API rejects the session token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("unauthorized", {
          status: 401,
          statusText: "Unauthorized",
        });
      }),
    );

    await expect(getDashboardSnapshot("tenant-token")).rejects.toBeInstanceOf(
      DashboardSnapshotUnauthorizedError,
    );
  });

  it("parses tenant ids on dashboard rows for admin debug views", async () => {
    const snapshot = {
      knowledgeMetrics: {
        totalRecords: 4,
        highPriorityRecords: 2,
      },
      recentKnowledge: [
        {
          tenantId: "tenant_a",
          headline: "Brake alerts increased by 14% this week",
          category: "fleet_health",
          priority: "high",
          source: "seed",
          timestamp: "2026-03-31T10:00:00.000Z",
        },
      ],
    } satisfies DashboardSnapshot;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify(snapshot), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await expect(getDashboardSnapshot("admin-token")).resolves.toEqual(
      snapshot,
    );
  });
});
