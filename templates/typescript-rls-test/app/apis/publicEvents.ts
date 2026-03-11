import { Api } from "@514labs/moose-lib";
import { PublicEventPipeline } from "../ingest/models";

interface QueryParams {
  limit?: number;
}

interface PublicEventRow {
  eventId: string;
  timestamp: string;
  message: string;
}

export const PublicEventsApi = new Api<QueryParams, PublicEventRow[]>(
  "publicEvents",
  async ({ limit = 100 }, { client, sql }) => {
    const result = await client.query.execute<PublicEventRow>(
      sql`SELECT * FROM ${PublicEventPipeline.table!} LIMIT ${limit}`,
    );
    return result.json();
  },
);
