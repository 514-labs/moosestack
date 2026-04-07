import { Api } from "@514labs/moose-lib";
import { AnalyticsTenantEventPipeline } from "../ingest/models";

interface QueryParams {
  limit?: number;
}

interface TenantEventRow {
  eventId: string;
  timestamp: string;
  org_id: string;
  data: string;
}

export const AnalyticsTenantEventsApi = new Api<QueryParams, TenantEventRow[]>(
  "analyticsTenantEvents",
  async ({ limit = 100 }, { client, sql }) => {
    const result = await client.query.execute<TenantEventRow>(
      sql`SELECT * FROM ${AnalyticsTenantEventPipeline.table!} LIMIT ${limit}`,
    );
    return result.json();
  },
);
