import { eventsModel } from "./model";
import { executeQuery } from "../client";

type BucketSize = Exclude<typeof eventsModel.$inferDimensions, "status">;

export async function getEventsTimeseries(
  startDate?: Date,
  endDate?: Date,
  bucketSize: BucketSize = "day",
): Promise<Array<{ time: string; totalEvents: number }>> {
  const query = eventsModel.toSql({
    dimensions: [bucketSize],
    metrics: ["totalEvents"],
    filters: {
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  // Column name matches the dimension key (hour/day/month), normalize to "time"
  const rows = await executeQuery<Record<string, unknown>>(query);
  return rows.map((row) => ({
    time: String(row[bucketSize] ?? ""),
    totalEvents: Number(row.totalEvents ?? 0),
  }));
}
