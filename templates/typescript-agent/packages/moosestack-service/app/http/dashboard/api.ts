import { WebApp } from "@514labs/moose-lib";
import express from "express";
import { getDashboardSnapshot } from "../../semantic/dashboard-snapshot";
import {
  assertTenantMooseContext,
  requireTenantMoose,
} from "../context/tenant-context";

const app = express();

app.use(requireTenantMoose);

app.get("/dashboard/snapshot", async (req, res, next) => {
  try {
    const context = assertTenantMooseContext(req);

    const snapshot = await getDashboardSnapshot(
      context.moose.client.query,
      context.tenantId,
      context.rowPolicyOptions,
    );

    res.json(snapshot);
  } catch (error) {
    next(error);
  }
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[App API] Failed to handle request:", error);

    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export const dashboardApi = new WebApp("dashboardApi", app, {
  mountPath: "/app",
  metadata: {
    description: "Tenant-scoped app APIs for dashboard and frontend reads",
  },
});
