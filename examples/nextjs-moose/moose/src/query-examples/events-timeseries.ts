import { eventsModel } from "./model";
import { executeQuery } from "../client";

type BucketSize = Exclude<typeof eventsModel.$inferDimensions, "status">;

export async function getEventsTimeseries(
  startDate?: Date,
  endDate?: Date,
  bucketSize: BucketSize = "day",
) {
  const query = await eventsModel.toSql({
    dimensions: [bucketSize],
    metrics: ["totalEvents"],
    filters: {
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  return await executeQuery<{ time: Date; totalEvents: number }>(query);
}
