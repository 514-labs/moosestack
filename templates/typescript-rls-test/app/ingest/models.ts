import {
  IngestPipeline,
  Key,
  DateTime,
  SelectRowPolicy,
} from "@514labs/moose-lib";

export interface TenantEvent {
  eventId: Key<string>;
  timestamp: DateTime;
  org_id: string;
  data: string;
}

export const TenantEventPipeline = new IngestPipeline<TenantEvent>(
  "TenantEvent",
  {
    table: {
      orderByFields: ["eventId", "org_id"],
    },
    stream: true,
    ingestApi: true,
  },
);

export const tenantIsolation = new SelectRowPolicy("tenant_isolation", {
  tables: [TenantEventPipeline.table!],
  column: "org_id",
  claim: "org_id",
});

export const dataFilter = new SelectRowPolicy("data_filter", {
  tables: [TenantEventPipeline.table!],
  column: "data",
  claim: "data",
});
