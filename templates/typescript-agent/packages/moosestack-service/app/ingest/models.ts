import {
  type ClickHouseDefault,
  ClickHouseEngines,
  IngestPipeline,
  type LowCardinality,
  SelectRowPolicy,
} from "@514labs/moose-lib";
import type { tags } from "typia";

export interface TenantKnowledge {
  record_id: string & tags.Format<"uuid">;
  tenant_id: string & LowCardinality;
  category: string & LowCardinality;
  priority: string & LowCardinality & ClickHouseDefault<"'normal'">;
  headline: string;
  details: string & ClickHouseDefault<"''">;
  source: string & LowCardinality & ClickHouseDefault<"'seed'">;
  timestamp: Date;
}

export const TenantKnowledgePipeline = new IngestPipeline<TenantKnowledge>(
  "tenant_knowledge",
  {
    table: {
      engine: ClickHouseEngines.ReplacingMergeTree,
      orderByFields: ["tenant_id", "category", "timestamp", "record_id"],
    },
    stream: true,
    ingestApi: true,
  },
);

const tenantKnowledgeTable = TenantKnowledgePipeline.table;

if (!tenantKnowledgeTable) {
  throw new Error(
    "TenantKnowledgePipeline must define an OLAP table for tenant isolation.",
  );
}

export const TenantKnowledgeTable = tenantKnowledgeTable;

export const tenantIsolation = new SelectRowPolicy("tenant_isolation", {
  tables: [TenantKnowledgeTable],
  column: "tenant_id",
  claim: "tenant_id",
});
