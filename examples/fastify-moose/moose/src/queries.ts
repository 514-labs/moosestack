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

  if (params.minAmount) {
    conditions.push(sql`${Events.columns.amount} >= ${params.minAmount}`);
  }
  if (params.maxAmount) {
    conditions.push(sql`${Events.columns.amount} <= ${params.maxAmount}`);
  }
  if (params.status) {
    conditions.push(sql`${Events.columns.status} = ${params.status}`);
  }

  // Use sql.join() to combine WHERE conditions with AND
  const whereClause =
    conditions.length > 0 ? sql` WHERE ${sql.join(conditions, "AND")}` : sql``;

  // Use sql.raw() for static SQL keywords (ORDER BY direction)
  const orderDirection = sql.raw("DESC");

  // Use Sql.append() to build query incrementally
  const query = sql`SELECT * FROM ${Events}`
    .append(whereClause)
    .append(sql` ORDER BY ${Events.columns.event_time} ${orderDirection}`)
    .append(sql` LIMIT ${params.limit ?? 100}`)
    .append(sql` OFFSET ${params.offset ?? 0}`);

  return await executeQuery<EventModel>(query);
}

export const getEventsQuery = createQueryHandler<GetEventsParams, EventModel[]>(
  {
    fromUrl: typia.http.createValidateQuery<GetEventsParams>(),
    fromObject: typia.createValidate<GetEventsParams>(),
    queryFn: getEvents,
  },
);
