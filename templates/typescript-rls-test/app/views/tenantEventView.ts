import { View, sql } from "@514labs/moose-lib";
import { TenantEventPipeline } from "../ingest/models";

const tenantEventTable = TenantEventPipeline.table!;

export const TenantEventView = new View(
  "TenantEventView",
  sql`SELECT * FROM ${tenantEventTable}`,
  [tenantEventTable],
);
