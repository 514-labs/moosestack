import express from "express";
import cors from "cors";
import { WebApp, getMooseUtils, buildQuery } from "@514labs/moose-lib";
import { transactionMetrics } from "../query-models/transaction-metrics";

const app = express();
app.use(express.json());
app.use(cors());

// Dashboard handler — powered by the query layer
app.get("/by-region", async (_req, res) => {
  const { client } = await getMooseUtils();

  try {
    const data = await buildQuery(transactionMetrics)
      .metrics(["revenue"])
      .dimensions(["region"])
      .orderBy(["revenue", "DESC"])
      .execute(client.query);

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export const revenueApi = new WebApp("revenue", app, {
  mountPath: "/revenue",
});
