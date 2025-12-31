import { Sql, sql } from "@514labs/moose-lib";
import { Events, EventModel } from "./models";
import { executeQuery, buildWhereClause } from "./client";

/**
 * Builds a WHERE clause with date filters and optional additional conditions.
 * Convenience wrapper around the generic buildWhereClause function.
 */
function buildDateFilteredWhereClause(
  startDate?: Date,
  endDate?: Date,
  ...additionalConditions: Sql[]
): Sql {
  const conditions: Sql[] = [];

  // Add date filters
  if (startDate) {
    conditions.push(sql`${Events.columns.event_time} >= toDate(${startDate})`);
  }
  if (endDate) {
    conditions.push(sql`${Events.columns.event_time} <= toDate(${endDate})`);
  }

  // Add additional conditions
  conditions.push(...additionalConditions);

  return buildWhereClause(conditions);
}

export async function getEvents(limit: number = 10): Promise<EventModel[]> {
  return await executeQuery<EventModel>(
    sql`SELECT * FROM ${Events} ORDER BY ${Events.columns.event_time} DESC LIMIT ${limit}`,
  );
}

interface TimeSeriesRow {
  time: string;
  count: number;
}

export async function getEventsOverTime(
  startDate?: Date,
  endDate?: Date,
  bucketSize: "minute" | "hour" | "day" = "day",
): Promise<TimeSeriesRow[]> {
  const bucketFunction =
    bucketSize === "minute" ? sql`toStartOfMinute(${Events.columns.event_time})`
    : bucketSize === "hour" ? sql`toStartOfHour(${Events.columns.event_time})`
    : sql`toStartOfDay(${Events.columns.event_time})`;

  const whereClause = buildDateFilteredWhereClause(startDate, endDate);

  return await executeQuery<TimeSeriesRow>(
    sql`SELECT ${bucketFunction} as time, COUNT(*) as count FROM ${Events} ${whereClause} GROUP BY ${bucketFunction} ORDER BY ${bucketFunction} DESC`,
  );
}

interface CountResult {
  count: number;
}

interface SumResult {
  sum: number;
}

interface StatusCountResult {
  status: EventModel["status"];
  count: number;
}

export interface EventsByStatusResult {
  name: string;
  value: number;
}

const ALL_STATUSES = [
  "completed",
  "active",
  "inactive",
] satisfies EventModel["status"][];

export async function getTotalEventsCount(
  startDate?: Date,
  endDate?: Date,
): Promise<number> {
  const whereClause = buildDateFilteredWhereClause(startDate, endDate);
  const result = await executeQuery<CountResult>(
    sql`SELECT COUNT(*) as count FROM ${Events} ${whereClause}`,
  );
  return result[0]?.count ?? 0;
}

export async function getActiveEventsCount(
  startDate?: Date,
  endDate?: Date,
): Promise<number> {
  const whereClause = buildDateFilteredWhereClause(
    startDate,
    endDate,
    sql`${Events.columns.status} = 'active'`,
  );
  const result = await executeQuery<CountResult>(
    sql`SELECT COUNT(*) as count FROM ${Events} ${whereClause}`,
  );
  return result[0]?.count ?? 0;
}

export async function getCompletedEventsCount(
  startDate?: Date,
  endDate?: Date,
): Promise<number> {
  const whereClause = buildDateFilteredWhereClause(
    startDate,
    endDate,
    sql`${Events.columns.status} = 'completed'`,
  );
  const result = await executeQuery<CountResult>(
    sql`SELECT COUNT(*) as count FROM ${Events} ${whereClause}`,
  );
  return result[0]?.count ?? 0;
}

export async function getTotalAmount(
  startDate?: Date,
  endDate?: Date,
): Promise<number> {
  const whereClause = buildDateFilteredWhereClause(startDate, endDate);
  const result = await executeQuery<SumResult>(
    sql`SELECT SUM(${Events.columns.amount}) as sum FROM ${Events} ${whereClause}`,
  );
  return result[0]?.sum ?? 0;
}

export async function getEventsByStatus(
  startDate?: Date,
  endDate?: Date,
): Promise<EventsByStatusResult[]> {
  const whereClause = buildDateFilteredWhereClause(startDate, endDate);
  const rawResults = await executeQuery<StatusCountResult>(
    sql`SELECT lower(${Events.columns.status}) as status, COUNT(*) as count FROM ${Events} ${whereClause} GROUP BY status`,
  );

  const statusMap = new Map(rawResults.map((row) => [row.status, row.count]));

  return ALL_STATUSES.map((status) => ({
    name: status,
    value: statusMap.get(status) ?? 0,
  }));
}
