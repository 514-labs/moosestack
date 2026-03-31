import { defineQueryModel, sql } from "@514labs/moose-lib";
import { TenantKnowledgeTable } from "../ingest/models";

export const knowledgeMetricsModel = defineQueryModel({
  table: TenantKnowledgeTable,
  dimensions: {
    category: {
      column: "category",
      description: "Knowledge entry category",
    },
    priority: {
      column: "priority",
      description: "Priority label for the knowledge entry",
    },
  },
  metrics: {
    totalRecords: {
      agg: sql.fragment`count(*)`,
      description: "Total tenant knowledge records",
    },
    highPriorityRecords: {
      agg: sql.fragment`countIf(${TenantKnowledgeTable.columns.priority} = 'high')`,
      description: "High-priority records for the tenant",
    },
  },
  filters: {
    timestamp: {
      column: "timestamp",
      operators: ["gte", "lte"] as const,
      description: "Time range filter",
    },
    category: {
      column: "category",
      operators: ["eq", "in"] as const,
      description: "Category filter",
    },
    tenantId: {
      column: "tenant_id",
      operators: ["eq"] as const,
      description: "Tenant scope",
    },
  },
  sortable: ["totalRecords", "highPriorityRecords"] as const,
  defaults: {},
});
