import {
  IngestPipeline,
  DateTime,
  SelectRowPolicy,
  ClickHouseEngines,
} from "@514labs/moose-lib";

export interface TenantEvent {
  eventId: string;
  timestamp: DateTime;
  org_id: string;
  data: string;
}

export const TenantEventPipeline = new IngestPipeline<TenantEvent>(
  "TenantEvent",
  {
    table: {
      engine: ClickHouseEngines.ReplacingMergeTree,
      orderByFields: ["eventId", "org_id"],
    },
    stream: true,
    ingestApi: true,
  },
);

export const AnalyticsTenantEventPipeline = new IngestPipeline<TenantEvent>(
  "AnalyticsTenantEvent",
  {
    table: {
      engine: ClickHouseEngines.ReplacingMergeTree,
      orderByFields: ["eventId", "org_id"],
      database: "analytics",
    },
    stream: true,
    ingestApi: true,
  },
);

export const tenantIsolation = new SelectRowPolicy("tenant_isolation", {
  tables: [TenantEventPipeline.table!, AnalyticsTenantEventPipeline.table!],
  column: "org_id",
  claim: "org_id",
});

export const dataFilter = new SelectRowPolicy("data_filter", {
  tables: [TenantEventPipeline.table!],
  column: "data",
  claim: "data",
});

export interface PublicEvent {
  eventId: string;
  timestamp: DateTime;
  message: string;
}

export const PublicEventPipeline = new IngestPipeline<PublicEvent>(
  "PublicEvent",
  {
    table: {
      engine: ClickHouseEngines.ReplacingMergeTree,
      orderByFields: ["eventId"],
    },
    stream: true,
    ingestApi: true,
  },
);
