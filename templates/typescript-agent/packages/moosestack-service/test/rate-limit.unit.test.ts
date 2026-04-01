import { describe, expect, it } from "vitest";

import {
  matchesRouteRateLimitOverride,
  shouldSkipDefaultRateLimit,
} from "../http/rate-limit";

describe("rate-limit helpers", () => {
  it("matches method-specific overrides", () => {
    expect(
      matchesRouteRateLimitOverride(
        {
          method: "GET",
          path: "/dashboard/snapshot",
        },
        {
          method: "GET",
          path: "/dashboard/snapshot",
        },
      ),
    ).toBe(true);

    expect(
      matchesRouteRateLimitOverride(
        {
          method: "POST",
          path: "/dashboard/snapshot",
        },
        {
          method: "GET",
          path: "/dashboard/snapshot",
        },
      ),
    ).toBe(false);
  });

  it("matches regex path overrides", () => {
    expect(
      matchesRouteRateLimitOverride(
        {
          method: "GET",
          path: "/dashboard/snapshot",
        },
        {
          path: /^\/dashboard\//,
        },
      ),
    ).toBe(true);
  });

  it("skips the default limiter when a route override matches", () => {
    expect(
      shouldSkipDefaultRateLimit(
        {
          method: "GET",
          path: "/dashboard/snapshot",
        },
        [
          {
            method: "GET",
            path: "/dashboard/snapshot",
          },
        ],
      ),
    ).toBe(true);

    expect(
      shouldSkipDefaultRateLimit(
        {
          method: "GET",
          path: "/dashboard/other",
        },
        [
          {
            method: "GET",
            path: "/dashboard/snapshot",
          },
        ],
      ),
    ).toBe(false);
  });
});
