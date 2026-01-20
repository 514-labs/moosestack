import { eventsModel } from "./model";
import { executeQuery } from "../client";
import { cliLog, sql } from "@514labs/moose-lib";

export async function getEventsByStatus(startDate?: Date, endDate?: Date) {
  const parts = await eventsModel.toParts({
    dimensions: ["status"],
    metrics: ["totalEvents"],
    filters: {
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  const query = sql`
    SELECT ${parts.dimensions}, ${parts.metrics}
    ${parts.from}
    ${parts.where}
    ${parts.groupBy}
    ${parts.orderBy}
    ${parts.pagination}
  `;

  // Result uses key names as aliases: status, totalEvents
  const results = await executeQuery<{ status: string; totalEvents: number }>(
    query,
  );

  cliLog({ action: "getEventsByStatus", message: JSON.stringify(results) });
  return results.map((row) => ({
    name: row.status,
    value: row.totalEvents,
  }));
}

// =============================================================================
// Old implementation
// =============================================================================

import { Events } from "../models";
import { where, filter } from "../query-layer/sql-utils";

export async function getEventsByStatusOld(
  startDate?: Date,
  endDate?: Date,
): Promise<{ name: string; value: number }[]> {
  const whereClause = where(
    filter(Events.columns.event_time, "gte", startDate),
    filter(Events.columns.event_time, "lte", endDate),
  );

  const results = await executeQuery<{ status: string; amount: number }>(
    sql`SELECT lower(${Events.columns.status}) as status, COUNT(*) as count FROM ${Events} ${whereClause} GROUP BY status`,
  );

  return results.map((row) => ({
    name: row.status,
    value: row.amount,
  }));
}
