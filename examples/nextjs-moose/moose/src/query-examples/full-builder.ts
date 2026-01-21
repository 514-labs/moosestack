import { eventsModel } from "./model";
import { executeQuery } from "../client";

export async function runEventsQuery(params: typeof eventsModel.$inferRequest) {
  const query = eventsModel.toSql(params);
  const results = await executeQuery(query);
  return results;
}
