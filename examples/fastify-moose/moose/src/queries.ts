import { sql } from "@514labs/moose-lib";
import { Events, type EventModel } from "./models";
import { executeQuery } from "./client";
import typia from "typia";
import {
  assertValidOrThrow,
  createParamMap,
  createValidator,
  toQuerySql,
  type OrderByColumn,
  type PaginationParams,
} from "./query-helpers";

interface EventFilters {
  status?: "completed" | "active" | "inactive";
}

interface GetEventsParams {
  filters?: EventFilters;
  pagination?: PaginationParams;
  orderBy?: OrderByColumn<EventModel>[];
}

const validateParams = createValidator<GetEventsParams>();

const paramMap = createParamMap<EventFilters, EventModel>(Events, {
  filters: {
    status: { column: "status", operator: "eq" },
  },
  defaultOrderBy: [{ column: "event_time", direction: "DESC" }],
});

export async function getEvents(
  params: GetEventsParams,
): Promise<EventModel[]> {
  const typedParams = assertValidOrThrow(validateParams(params));
  const intent = paramMap.toIntent(typedParams);

  const query = toQuerySql(Events, intent);
  return await executeQuery<EventModel>(query);
}
