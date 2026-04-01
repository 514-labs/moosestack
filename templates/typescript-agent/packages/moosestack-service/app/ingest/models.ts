import {
  type ClickHouseDefault,
  ClickHouseEngines,
  IngestApi,
  type LowCardinality,
  OlapTable,
  SelectRowPolicy,
  Stream,
} from "@514labs/moose-lib";
import type { tags } from "typia";
import { ORG_ID_CLAIM, ORG_ID_COLUMN } from "../security/tenant-isolation";

/**
 * EXAMPLE_APP_ONLY:
 * This file defines the seeded TenantKnowledge demo model and its Moose
 * components. Replace or remove it when you swap out the example data model,
 * then search the repo for EXAMPLE_APP_ONLY to find the downstream demo wiring.
 */
export interface TenantKnowledge {
  record_id: string & tags.Format<"uuid">;
  org_id: string & LowCardinality;
  category: string & LowCardinality;
  priority: string & LowCardinality & ClickHouseDefault<"'normal'">;
  headline: string;
  details: string & ClickHouseDefault<"''">;
  source: string & LowCardinality & ClickHouseDefault<"'seed'">;
  timestamp: Date;
}

export const TenantKnowledgeTable = new OlapTable<TenantKnowledge>(
  "tenant_knowledge",
  {
    engine: ClickHouseEngines.ReplacingMergeTree,
    orderByFields: ["org_id", "timestamp", "category", "record_id"],
  },
);

export const TenantKnowledgeStream = new Stream<TenantKnowledge>(
  "tenant_knowledge",
  {
    destination: TenantKnowledgeTable,
  },
);

export const TenantKnowledgeIngestApi = new IngestApi<TenantKnowledge>(
  "tenant_knowledge",
  {
    destination: TenantKnowledgeStream,
  },
);

export const tenantIsolation = new SelectRowPolicy("tenant_isolation", {
  tables: [TenantKnowledgeTable],
  column: ORG_ID_COLUMN,
  claim: ORG_ID_CLAIM,
});
