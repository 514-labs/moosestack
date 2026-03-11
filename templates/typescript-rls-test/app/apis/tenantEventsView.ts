import { Api } from "@514labs/moose-lib";
import { TenantEventView } from "../views/tenantEventView";

interface QueryParams {
  limit?: number;
}

interface TenantEventRow {
  eventId: string;
  timestamp: string;
  org_id: string;
  data: string;
}

export const TenantEventsViewApi = new Api<QueryParams, TenantEventRow[]>(
  "tenantEventsView",
  async ({ limit = 100 }, { client, sql }) => {
    const result = await client.query.execute<TenantEventRow>(
      sql`SELECT * FROM ${TenantEventView} LIMIT ${limit}`,
    );
    return result.json();
  },
);
