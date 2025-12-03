/**
 * Example BYOF (Bring Your Own Framework) Fastify app
 *
 * This file demonstrates how to use Fastify with MooseStack for consumption
 * APIs using the WebApp class.
 */

import Fastify from "fastify";
import {
  WebApp,
  getMooseClients,
  Api,
  MooseCache,
  sql,
} from "@514labs/moose-lib";
import { BarAggregatedMV } from "../views/barAggregated";
import { tags } from "typia";

const app = Fastify({
  logger: true,
});

app.addHook("onRequest", async (request, _reply) => {
  console.log(`[bar-fastify.ts] ${request.method} ${request.url}`);
});

app.get("/health", async (_request, _reply) => {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "bar-fastify-api",
  };
});

app.get("/query", async (request, reply) => {
  const { client } = await getMooseClients();
  const limit = parseInt((request.query as any).limit as string) || 10;

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

    return {
      success: true,
      count: data.length,
      data,
    };
  } catch (error) {
    console.error("Query error:", error);
    reply.status(500);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

interface PostDataBody {
  orderBy?: "totalRows" | "rowsWithText" | "maxTextLength" | "totalTextLength";
  limit?: number;
  startDay?: number;
  endDay?: number;
}

app.post<{ Body: PostDataBody }>("/data", async (request, reply) => {
  const { client } = await getMooseClients();
  const {
    orderBy = "totalRows",
    limit = 5,
    startDay = 1,
    endDay = 31,
  } = request.body || {};

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

    return {
      success: true,
      params: { orderBy, limit, startDay, endDay },
      count: data.length,
      data,
    };
  } catch (error) {
    console.error("Query error:", error);
    reply.status(500);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

app.setErrorHandler((error, _request, reply) => {
  console.error("Fastify error:", error);
  reply.status(500).send({
    error: "Internal Server Error",
    message: error instanceof Error ? error.message : String(error),
  });
});

export const barFastifyApi = new WebApp("barFastify", app, {
  mountPath: "/fastify",
  metadata: {
    description: "Fastify API demonstrating WebApp integration",
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
