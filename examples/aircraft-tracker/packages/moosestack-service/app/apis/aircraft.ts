import express from "express";
import { WebApp, getMooseUtils, buildQuery } from "@514labs/moose-lib";
import cors from "cors";
import { aircraftMetrics } from "../query-models/aircraft-metrics";

const app = express();
app.use(express.json());
app.use(cors());

/**
 * GET /aircraft/metrics
 *
 * Query aircraft metrics using the shared semantic query model.
 *
 * Query params:
 *   metrics    — comma-separated metric names (default: totalAircraft, planesInAir, planesOnGround)
 *   dimensions — comma-separated dimension names (default: none → summary row)
 *   limit      — max rows (default: 100)
 */
app.get("/metrics", async (req, res) => {
  const { client } = await getMooseUtils();

  try {
    const rawMetrics = req.query.metrics as string | undefined;
    const rawDimensions = req.query.dimensions as string | undefined;
    const limit = parseInt(req.query.limit as string) || undefined;

    let query = buildQuery(aircraftMetrics)
      .metrics(
        rawMetrics ?
          (rawMetrics.split(",").map((s) => s.trim()) as any)
        : (["totalAircraft", "planesInAir", "planesOnGround"] as any),
      )
      .dimensions(
        rawDimensions ?
          (rawDimensions.split(",").map((s) => s.trim()) as any)
        : ([] as any),
      );
    if (limit) {
      query = query.limit(limit);
    }

    // Parse filters from query params: filter.{name}.{op}=value
    // e.g. filter.category.eq=A5 or filter.category.in=A5,A7
    for (const [key, value] of Object.entries(req.query)) {
      if (!key.startsWith("filter.") || typeof value !== "string") continue;
      const parts = key.split(".");
      if (parts.length !== 3) continue;
      const [, filterName, operator] = parts;
      const filterValue =
        operator === "in" ? value.split(",").map((s) => s.trim()) : value;
      query = query.filter(
        filterName as any,
        operator as any,
        filterValue as any,
      );
    }

    const data = await query.execute(client.query);

    res.json({ data, as_of: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export const aircraftApi = new WebApp("aircraftApi", app, {
  mountPath: "/aircraft",
});
