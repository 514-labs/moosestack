import Fastify from "fastify";
import { getMooseClients, sql, MooseCache } from "@514labs/moose-lib";
import { BarAggregatedMV } from "../views/barAggregated";

interface QueryParams {
  orderBy?: "totalRows" | "rowsWithText" | "maxTextLength" | "totalTextLength";
  limit?: string;
  startDay?: string;
  endDay?: string;
}

interface ResponseData {
  dayOfMonth: number;
  totalRows?: number;
  rowsWithText?: number;
  maxTextLength?: number;
  totalTextLength?: number;
}

const fastify = Fastify({
  logger: true,
});

fastify.get<{ Querystring: QueryParams }>(
  "/bar-byof",
  async (request, reply) => {
    const {
      orderBy = "totalRows",
      limit = "5",
      startDay = "1",
      endDay = "31",
    } = request.query;

    const limitNum = parseInt(limit, 10);
    const startDayNum = parseInt(startDay, 10);
    const endDayNum = parseInt(endDay, 10);

    const { client } = await getMooseClients();
    const cache = await MooseCache.get();
    const cacheKey = `bar-byof:${orderBy}:${limitNum}:${startDayNum}:${endDayNum}`;

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
      dayOfMonth >= ${startDayNum} 
      AND dayOfMonth <= ${endDayNum}
    ORDER BY ${BarAggregatedMV.targetTable.columns[orderBy]} DESC
    LIMIT ${limitNum}
  `;

    const data = await client.query.execute<ResponseData>(query);
    const result: ResponseData[] = await data.json();

    await cache.set(cacheKey, result, 3600);

    return result;
  },
);

fastify.listen({ port: 3001, host: "0.0.0.0" });
