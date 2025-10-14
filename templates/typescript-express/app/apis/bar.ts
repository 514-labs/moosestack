/**
 * Example BYOF (Bring Your Own Framework) Express app
 *
 * This file demonstrates how to use Express with MooseStack for consumption
 * APIs using the WebApp class.
 */

import express from "express";
import { WebApp, expressMiddleware, getMooseUtils } from "@514labs/moose-lib";
import { BarAggregatedMV } from "../views/barAggregated";
import { Api, MooseCache } from "@514labs/moose-lib";
import { tags } from "typia";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(expressMiddleware());

app.use((req, res, next) => {
  console.log(`[bar-express.ts] ${req.method} ${req.url}`);
  next();
});

const requireAuth = (req: any, res: any, next: any) => {
  const moose = getMooseUtils(req);
  if (!moose?.jwt) {
    return res.status(401).json({ error: "Unauthorized - JWT token required" });
  }
  next();
};

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "bar-express-api",
  });
});

app.get("/query", async (req, res) => {
  const moose = getMooseUtils(req);
  if (!moose) {
    return res
      .status(500)
      .json({ error: "MooseStack utilities not available" });
  }

  const { client, sql } = moose;
  const limit = parseInt(req.query.limit as string) || 10;

  try {
    const query = sql`
      SELECT 
        ${BarAggregatedMV.targetTable.columns.dayOfMonth},
        ${BarAggregatedMV.targetTable.columns.totalRows}
      FROM ${BarAggregatedMV.targetTable}
      ORDER BY ${BarAggregatedMV.targetTable.columns.totalRows} DESC
      LIMIT ${limit}
    `;

    const result = await client.query.execute(query);
    const data = await result.json();

    res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("Query error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get("/protected", requireAuth, async (req, res) => {
  const moose = getMooseUtils(req);

  res.json({
    message: "You are authenticated",
    user: moose?.jwt?.sub,
    claims: moose?.jwt,
  });
});

app.post("/data", async (req, res) => {
  const moose = getMooseUtils(req);
  if (!moose) {
    return res
      .status(500)
      .json({ error: "MooseStack utilities not available" });
  }

  const { client, sql } = moose;
  const {
    orderBy = "totalRows",
    limit = 5,
    startDay = 1,
    endDay = 31,
  } = req.body;

  try {
    const query = sql`
      SELECT 
        ${BarAggregatedMV.targetTable.columns.dayOfMonth},
        ${BarAggregatedMV.targetTable.columns[orderBy]}
      FROM ${BarAggregatedMV.targetTable}
      WHERE 
        dayOfMonth >= ${startDay} 
        AND dayOfMonth <= ${endDay}
      ORDER BY ${BarAggregatedMV.targetTable.columns[orderBy]} DESC
      LIMIT ${limit}
    `;

    const result = await client.query.execute(query);
    const data = await result.json();

    res.json({
      success: true,
      params: { orderBy, limit, startDay, endDay },
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("Query error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.use((err: any, req: any, res: any, next: any) => {
  console.error("Express error:", err);
  if (!res.headersSent) {
    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
    });
  }
});

export const barExpressApi = new WebApp("barExpress", app, {
  mountPath: "/express",
  metadata: {
    description: "Express API with middleware demonstrating WebApp integration",
  },
});

interface ApiQueryParams {
  orderBy?: "totalRows" | "rowsWithText" | "maxTextLength" | "totalTextLength";
  limit?: number;
  startDay?: number & tags.Type<"int32">;
  endDay?: number & tags.Type<"int32">;
}

interface ResponseData {
  dayOfMonth: number;
  totalRows?: number;
  rowsWithText?: number;
  maxTextLength?: number;
  totalTextLength?: number;
}

export const BarApi = new Api<ApiQueryParams, ResponseData[]>(
  "bar",
  async (
    { orderBy = "totalRows", limit = 5, startDay = 1, endDay = 31 },
    { client, sql },
  ) => {
    const cache = await MooseCache.get();
    const cacheKey = `bar:${orderBy}:${limit}:${startDay}:${endDay}`;

    // Try to get from cache first
    const cachedData = await cache.get<ResponseData[]>(cacheKey);
    if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
      return cachedData;
    }

    const query = sql`
        SELECT 
          ${BarAggregatedMV.targetTable.columns.dayOfMonth},
          ${BarAggregatedMV.targetTable.columns[orderBy]}
        FROM ${BarAggregatedMV.targetTable}
        WHERE 
          dayOfMonth >= ${startDay} 
          AND dayOfMonth <= ${endDay}
        ORDER BY ${BarAggregatedMV.targetTable.columns[orderBy]} DESC
        LIMIT ${limit}
      `;

    const data = await client.query.execute<ResponseData>(query);
    const result: ResponseData[] = await data.json();

    await cache.set(cacheKey, result, 3600); // Cache for 1 hour

    return result;
  },
);
