import { WebApp } from "@514labs/moose-lib";
import express from "express";
import {
  createDefaultApiRateLimit,
  createRouteRateLimit,
  type RouteRateLimitOverride,
} from "../../../http/rate-limit";
import {
  assertAuthenticatedAccessContext,
  requireAuthenticatedMoose,
} from "../../auth/access-context";
import { getDashboardSnapshot } from "../../semantic/dashboard-snapshot";

const app = express();
const routeRateLimitOverrides = [
  {
    method: "GET",
    path: "/dashboard/snapshot",
  },
] satisfies RouteRateLimitOverride[];

const dashboardSnapshotRateLimit = createRouteRateLimit({
  limit: 30,
});

app.use(createDefaultApiRateLimit(routeRateLimitOverrides));

app.use(requireAuthenticatedMoose);

app.get("/dashboard/snapshot", dashboardSnapshotRateLimit, async (req, res, next) => {
  try {
    const context = assertAuthenticatedAccessContext(req);

    // Moose injects a request-scoped QueryClient here; organization-scoped
    // requests already carry their row-policy settings on this client.
    const snapshot = await getDashboardSnapshot(context.moose.client.query);

    res.json(snapshot);
  } catch (error) {
    next(error);
  }
});

app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[App API] Failed to handle request:", error);

    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export const dashboardApi = new WebApp("dashboardApi", app, {
  mountPath: "/app",
  metadata: {
    description: "Authenticated app APIs for dashboard and frontend reads",
  },
});
