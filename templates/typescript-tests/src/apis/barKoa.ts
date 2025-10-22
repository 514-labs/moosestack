/**
 * Example BYOF (Bring Your Own Framework) Koa app
 *
 * This file demonstrates how to use Koa with MooseStack for consumption
 * APIs using the WebApp class.
 */

import Koa from "koa";
import Router from "@koa/router";
import bodyParser from "koa-bodyparser";
import { WebApp, getMooseUtils } from "@514labs/moose-lib";
import { BarAggregatedMV } from "../views/barAggregated";

const app = new Koa();
const router = new Router();

app.use(bodyParser());

// Logging middleware
app.use(async (ctx, next) => {
  console.log(`[barKoa.ts] ${ctx.method} ${ctx.url}`);
  await next();
});

// Health check endpoint
router.get("/health", async (ctx) => {
  ctx.body = {
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "bar-koa-api",
  };
});

// Query endpoint
router.get("/query", async (ctx) => {
  const moose = getMooseUtils(ctx.req);
  if (!moose) {
    ctx.status = 500;
    ctx.body = { error: "MooseStack utilities not available" };
    return;
  }

  const { client, sql } = moose;
  const limit = parseInt((ctx.query.limit as string) || "10");

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

    ctx.body = {
      success: true,
      count: data.length,
      data,
    };
  } catch (error) {
    console.error("Query error:", error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// Data endpoint with POST
router.post("/data", async (ctx) => {
  const moose = getMooseUtils(ctx.req);
  if (!moose) {
    ctx.status = 500;
    ctx.body = { error: "MooseStack utilities not available" };
    return;
  }

  const { client, sql } = moose;
  const {
    orderBy = "totalRows",
    limit = 5,
    startDay = 1,
    endDay = 31,
  } = ctx.request.body as any;

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

    ctx.body = {
      success: true,
      params: { orderBy, limit, startDay, endDay },
      count: data.length,
      data,
    };
  } catch (error) {
    console.error("Query error:", error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

// Error handling middleware
app.on("error", (err, ctx) => {
  console.error("Koa error:", err);
});

export const barKoaApi = new WebApp("barKoa", app, {
  mountPath: "/koa",
  metadata: {
    description: "Koa API demonstrating WebApp integration",
  },
});
