import { sql, Sql } from "@514labs/moose-lib";
import typia, { tags } from "typia";
import { executeQuery } from "./client";
import { EventModel, Events } from "./models";
import { createQueryHandler } from "./utils";

interface GetEventsParams {
  minAmount?: number & tags.Type<"uint32"> & tags.Minimum<0>;
  maxAmount?: number & tags.Type<"uint32">;
  status?: "completed" | "active" | "inactive";
  limit?: number & tags.Type<"uint32"> & tags.Minimum<1> & tags.Maximum<100>;
  offset?: number & tags.Type<"uint32"> & tags.Minimum<0>;
}

async function getEvents(params: GetEventsParams): Promise<EventModel[]> {
  const conditions: Sql[] = [];

  if (params.minAmount !== undefined) {
    conditions.push(
      sql.fragment`${Events.columns.amount} >= ${params.minAmount}`,
    );
  }
  if (params.maxAmount !== undefined) {
    conditions.push(
      sql.fragment`${Events.columns.amount} <= ${params.maxAmount}`,
    );
  }
  if (params.status) {
    conditions.push(sql.fragment`${Events.columns.status} = ${params.status}`);
  }

  // Use sql.join() to combine WHERE conditions with AND
  const whereClause =
    conditions.length > 0 ?
      sql.fragment` WHERE ${sql.join(conditions, "AND")}`
    : sql.fragment``;

  // Use sql.raw() for static SQL keywords (ORDER BY direction)
  const orderDirection = sql.raw("DESC");

  // Use Sql.append() to build query incrementally
  const query = sql.statement`SELECT * FROM ${Events}`
    .append(whereClause)
    .append(
      sql.fragment` ORDER BY ${Events.columns.event_time} ${orderDirection}`,
    )
    .append(sql.fragment` LIMIT ${params.limit ?? 100}`)
    .append(sql.fragment` OFFSET ${params.offset ?? 0}`);

  return await executeQuery<EventModel>(query);
}

export const getEventsQuery = createQueryHandler<GetEventsParams, EventModel[]>(
  {
    fromUrl: typia.http.createValidateQuery<GetEventsParams>(),
    fromObject: typia.createValidate<GetEventsParams>(),
    queryFn: getEvents,
  },
);
