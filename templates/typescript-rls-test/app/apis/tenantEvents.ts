import { Api } from "@514labs/moose-lib";
import { TenantEventPipeline } from "../ingest/models";

interface QueryParams {
  limit?: number;
}

interface TenantEventRow {
  eventId: string;
  timestamp: string;
  org_id: string;
  data: string;
}

export const TenantEventsApi = new Api<QueryParams, TenantEventRow[]>(
  "tenantEvents",
  async ({ limit = 100 }, { client, sql }) => {
    const result = await client.query.execute<TenantEventRow>(
      sql`SELECT * FROM ${TenantEventPipeline.table!} LIMIT ${limit}`,
    );
    return result.json();
  },
);
