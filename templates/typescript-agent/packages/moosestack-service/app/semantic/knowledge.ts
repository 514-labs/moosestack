import { defineQueryModel, sql } from "@514labs/moose-lib";
import { TenantKnowledgeTable } from "../ingest/models";

/**
 * EXAMPLE_APP_ONLY:
 * These semantic models are coupled to the seeded TenantKnowledge demo model.
 * Replace or remove them when you swap out the example data model, then search
 * the repo for EXAMPLE_APP_ONLY to find the downstream demo wiring.
 */
export const tenantKnowledgeMetricsModel = defineQueryModel({
  name: "query_tenant_knowledge_metrics",
  description:
    "Summarize knowledge metrics and grouped rollups within the current access scope. Use for counts, priorities, categories, and source-level trends.",
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
    source: {
      column: "source",
      description: "Origin of the knowledge entry",
    },
  },
  metrics: {
    totalRecords: {
      agg: sql.fragment`count(*)`,
      description: "Total knowledge records in scope",
    },
    highPriorityRecords: {
      agg: sql.fragment`countIf(${TenantKnowledgeTable.columns.priority} = 'high')`,
      description: "High-priority records in scope",
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
    priority: {
      column: "priority",
      operators: ["eq", "in"] as const,
      description: "Priority filter",
    },
    source: {
      column: "source",
      operators: ["eq", "in"] as const,
      description: "Source filter",
    },
  },
  sortable: ["totalRecords", "highPriorityRecords"] as const,
  defaults: {
    metrics: ["totalRecords"],
    limit: 50,
    maxLimit: 500,
  },
});

export const tenantKnowledgeRecordsModel = defineQueryModel({
  name: "list_tenant_knowledge_records",
  description:
    "List knowledge records visible in the current access scope. Use for latest headlines, category filters, and priority-specific records.",
  table: TenantKnowledgeTable,
  columns: {
    recordId: {
      column: "record_id",
      as: "recordId",
    },
    category: {
      column: "category",
    },
    priority: {
      column: "priority",
    },
    headline: {
      column: "headline",
    },
    details: {
      column: "details",
    },
    source: {
      column: "source",
    },
    timestamp: {
      column: "timestamp",
    },
  },
  filters: {
    timestamp: {
      column: "timestamp",
      operators: ["gte", "lte"] as const,
      description: "Inclusive time range filter",
    },
    category: {
      column: "category",
      operators: ["eq", "in"] as const,
      description: "Category filter",
    },
    priority: {
      column: "priority",
      operators: ["eq", "in"] as const,
      description: "Priority filter",
    },
    source: {
      column: "source",
      operators: ["eq", "in"] as const,
      description: "Source filter",
    },
    headline: {
      column: "headline",
      operators: ["like", "ilike"] as const,
      description: "Headline search filter",
    },
  },
  sortable: ["timestamp", "category", "priority", "source"] as const,
  defaults: {
    columns: ["headline", "category", "priority", "source", "timestamp"],
    orderBy: [["timestamp", "DESC"]],
    limit: 5,
    maxLimit: 100,
  },
});
