import { sql } from "@514labs/moose-lib";
import typia, { tags } from "typia";
import { executeQuery } from "./client";
import { EventModel, Events } from "./models";
import { createQueryHandler, joinSql } from "./utils";

interface GetEventsParams {
  minAmount?: number & tags.Type<"uint32"> & tags.Minimum<0>;
  maxAmount?: number & tags.Type<"uint32">;
  status?: "completed" | "active" | "inactive";
  limit?: number & tags.Type<"uint32"> & tags.Minimum<1> & tags.Maximum<100>;
  offset?: number & tags.Type<"uint32"> & tags.Minimum<0>;
}

async function getEvents(params: GetEventsParams): Promise<EventModel[]> {
  const conditions: ReturnType<typeof sql>[] = [];

  if (params.minAmount) {
    conditions.push(sql`${Events.columns.amount} >= ${params.minAmount}`);
  }
  if (params.maxAmount) {
    conditions.push(sql`${Events.columns.amount} <= ${params.maxAmount}`);
  }
  if (params.status) {
    conditions.push(sql`${Events.columns.status} = ${params.status}`);
  }

  const where =
    conditions.length ? sql`WHERE ${joinSql(conditions, "AND")}` : sql``;

  const query = sql`
  SELECT * 
  FROM ${Events} 
  ${where} 
  ORDER BY ${Events.columns.event_time} DESC 
  LIMIT ${params.limit ?? 100} 
  OFFSET ${params.offset ?? 0}`;

  return await executeQuery<EventModel>(query);
}

export const getEventsQuery = createQueryHandler<GetEventsParams, EventModel[]>(
  {
    fromUrl: typia.http.createValidateQuery<GetEventsParams>(),
    fromObject: typia.createValidate<GetEventsParams>(),
    queryFn: getEvents,
  },
);
