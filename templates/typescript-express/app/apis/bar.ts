/**
 * Example BYOF (Bring Your Own Framework) Express app
 *
 * This file demonstrates how to use Express with MooseStack for consumption
 * APIs using the ByofApi class.
 */

import express, { Request, Response, NextFunction } from "express";
import {
  sql,
  getMooseClients,
  ByofApi,
  type MooseClient,
} from "@514labs/moose-lib";
import { BarPipeline } from "../ingest/models";
import { Api, MooseCache } from "@514labs/moose-lib";
import { BarAggregatedMV } from "../views/barAggregated";
import { tags } from "typia";

interface QueryParams {
  maxResults: number;
}

// Extend Express Request to include our client
interface RequestWithClient extends Request<{}, {}, {}, QueryParams> {
  client?: MooseClient;
}

interface ResultItem {
  primaryKey: string;
  textLength: number;
}

/**
 * Creates and configures the Express app.
 * This function is called by the ByofApi class when the app is initialized.
 */
async function createExpressApp() {
  const app = express();
  const { client } = await getMooseClients();

  // Middleware to attach Moose client to requests
  app.use((req: RequestWithClient, _res: Response, next: NextFunction) => {
    req.client = client;
    next();
  });

  // Example: Custom endpoint that queries ClickHouse
  app.get("/moose", async (req: RequestWithClient, res: Response) => {
    const { client } = req;
    const SourceTable = BarPipeline.table!;
    const cols = SourceTable.columns;

    const query = sql` SELECT ${cols.primaryKey}, ${cols.textLength} FROM ${SourceTable} LIMIT ${req.query.maxResults || 10}`;

    // Set the result type to the type of the each row in the result set
    const resultSet = await client?.query.execute<ResultItem>(query);

    // Return the result set as an array of the result item type
    const data = await resultSet?.json();
    res.send(data);
  });

  return app;
}

/**
 * Register the Express app with Moose using the ByofApi class.
 * This follows the same pattern as Api and IngestApi classes.
 */
export const barByofApi = new ByofApi("bar-express-api", createExpressApp, {
  version: "1.0",
  metadata: { description: "Example Express app integrated with Moose" },
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
