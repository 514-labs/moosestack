import { eventsModel } from "./model";
import { executeQuery } from "../client";

export async function getEventsMetrics(startDate?: Date, endDate?: Date) {
  const query = await eventsModel.toSql({
    dimensions: [],
    metrics: [
      "totalEvents",
      "totalAmount",
      "avgAmount",
      "minAmount",
      "maxAmount",
      "highValueRatio",
    ],
    filters: {
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  return await executeQuery<{
    totalEvents: number;
    totalAmount: number;
    avgAmount: number;
    minAmount: number;
    maxAmount: number;
    highValueRatio: number;
  }>(query);
}
