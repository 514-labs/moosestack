import express from "express";
import { WebApp, getMooseUtils, buildQuery } from "@514labs/moose-lib";
import { reviewMetrics } from "../query-models/review-metrics";

const app = express();
app.use(express.json());

/**
 * GET /reviews/metrics
 *
 * Query review metrics using the shared semantic query model.
 *
 * Query params:
 *   metrics    — comma-separated metric names (default: totalReviews, avgRating, uniqueProducts)
 *   dimensions — comma-separated dimension names (default: none → summary row)
 *   limit      — max rows (default: 100)
 *   filter.{name}.{op} — filter values (e.g. filter.marketplace.eq=US or filter.product_category.in=Books,Music)
 */
app.get("/metrics", async (req, res) => {
  const { client } = await getMooseUtils();

  try {
    const rawMetrics = req.query.metrics as string | undefined;
    const rawDimensions = req.query.dimensions as string | undefined;
    const limit = parseInt(req.query.limit as string) || undefined;

    let query = buildQuery(reviewMetrics)
      .metrics(
        rawMetrics ?
          (rawMetrics.split(",").map((s) => s.trim()) as any)
        : (["totalReviews", "avgRating", "uniqueProducts"] as any),
      )
      .dimensions(
        rawDimensions ?
          (rawDimensions.split(",").map((s) => s.trim()) as any)
        : ([] as any),
      );

    if (limit) {
      query = query.limit(limit);
    }

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

/**
 * GET /reviews/schema
 *
 * Returns the query model schema — metrics, dimensions, filters, and defaults.
 * The frontend uses this to dynamically build the query builder UI.
 *
 * For categorical filters (operators include "eq" or "in"), distinct values
 * are fetched from ClickHouse so the UI can render toggle chips.
 */
app.get("/schema", async (_req, res) => {
  const { client } = await getMooseUtils();
  const model = reviewMetrics as any;

  const metrics = Object.entries(model.metrics ?? {}).map(
    ([id, m]: [string, any]) => ({
      id,
      label: id,
      description: m.description,
    }),
  );

  const dimensions = Object.entries(model.dimensions ?? {}).map(
    ([id, d]: [string, any]) => ({
      id,
      label: id,
      description: d.description,
    }),
  );

  const filterEntries = Object.entries(model.filters ?? {}) as [string, any][];
  const filters = await Promise.all(
    filterEntries.map(async ([id, f]) => {
      const operators: string[] = f.operators ?? [];
      const isCategorical =
        (operators.includes("eq") || operators.includes("in")) &&
        !operators.includes("gte");

      const hasDimension = id in (model.dimensions ?? {});
      let values: { value: string; label: string }[] | undefined;

      if (isCategorical && hasDimension) {
        try {
          const rows = await buildQuery(reviewMetrics)
            .metrics([] as any)
            .dimensions([id] as any)
            .execute(client.query);
          values = rows
            .map((row) => {
              const val = String(row[id as keyof typeof row] ?? "");
              return { value: val, label: val };
            })
            .filter((v) => v.value !== "")
            .sort((a, b) => a.label.localeCompare(b.label));
        } catch {
          // Fall back to no values — UI renders text input
        }
      }

      return {
        id,
        label: id,
        operators,
        description: f.description,
        ...(values && { values }),
      };
    }),
  );

  res.json({
    name: model.name,
    description: model.description,
    metrics,
    dimensions,
    filters,
    sortable: model.sortable ?? [],
    defaults: model.defaults ?? {},
  });
});

export const reviewsApi = new WebApp("reviewsApi", app, {
  mountPath: "/reviews",
});
