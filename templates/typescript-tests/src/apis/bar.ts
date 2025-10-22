import { Api, MooseCache } from "@514labs/moose-lib";
import { BarAggregatedMV } from "../views/barAggregated";
import { tags } from "typia";

// This file is where you can define your APIs to consume your data
interface QueryParams {
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

interface ResponseDataV1 {
  dayOfMonth: number;
  totalRows?: number;
  rowsWithText?: number;
  maxTextLength?: number;
  totalTextLength?: number;
  // V1 specific fields
  metadata?: {
    version: string;
    queryParams: QueryParams;
  };
}

export const BarApi = new Api<QueryParams, ResponseData[]>(
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

export const BarApiV1 = new Api<QueryParams, ResponseDataV1[]>(
  "bar",
  async (
    { orderBy = "totalRows", limit = 5, startDay = 1, endDay = 31 },
    { client, sql },
  ) => {
    const cache = await MooseCache.get();
    const cacheKey = `bar:v1:${orderBy}:${limit}:${startDay}:${endDay}`;

    // Try to get from cache first
    const cachedData = await cache.get<ResponseDataV1[]>(cacheKey);
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

    const data = await client.query.execute<ResponseDataV1>(query);
    const result: ResponseDataV1[] = await data.json();

    // V1 specific: Add metadata
    result.forEach((item) => {
      item.metadata = {
        version: "1.0",
        queryParams: { orderBy, limit, startDay, endDay },
      };
    });

    await cache.set(cacheKey, result, 3600); // Cache for 1 hour

    return result;
  },
  { version: "1" }, // API can be accessed at /bar/1
);
