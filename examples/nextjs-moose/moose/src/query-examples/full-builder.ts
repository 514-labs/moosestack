import { eventsModel } from "./model";
import { executeQuery } from "../client";

export type EventsQueryResult = typeof eventsModel.$inferResult;
export type EventsQueryRequest = typeof eventsModel.$inferRequest;

export async function runEventsQuery(
  params: EventsQueryRequest,
): Promise<EventsQueryResult[]> {
  const query = eventsModel.toSql(params);
  return await executeQuery<EventsQueryResult>(query);
}
