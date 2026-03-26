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

import { getDashboardSnapshot } from "../src/lib/moose-service";

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
});
