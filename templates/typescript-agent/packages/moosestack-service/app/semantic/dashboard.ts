import { defineQueryModel, sql } from "@514labs/moose-lib";
import { TenantKnowledgeTable } from "../ingest/models";

export const dashboardKnowledgeMetricsModel = defineQueryModel({
  name: "query_dashboard_knowledge_metrics",
  description:
    "Return the fixed dashboard metric cards within the current access scope.",
  table: TenantKnowledgeTable,
  metrics: {
    totalRecords: {
      agg: sql.fragment`count(*)`,
      description:
        "Total knowledge records visible to the current access scope.",
    },
    highPriorityRecords: {
      agg: sql.fragment`countIf(
        ${TenantKnowledgeTable.columns.priority} = 'high'
        AND ${TenantKnowledgeTable.columns.timestamp} >= subtractDays(now(), 7)
        AND ${TenantKnowledgeTable.columns.timestamp} <= now()
      )`,
      description:
        "High-priority knowledge records from the last 7 days within the current access scope.",
    },
  },
  filters: {},
  sortable: ["totalRecords", "highPriorityRecords"] as const,
  defaults: {
    metrics: ["totalRecords", "highPriorityRecords"],
    limit: 1,
    maxLimit: 1,
  },
});

export const dashboardRecentKnowledgeModel = defineQueryModel({
  name: "list_dashboard_recent_knowledge",
  description:
    "Return the recent knowledge entries needed for the dashboard feed within the current access scope.",
  table: TenantKnowledgeTable,
  columns: {
    orgId: {
      column: "org_id",
      as: "orgId",
    },
    headline: {
      column: "headline",
    },
    category: {
      column: "category",
    },
    priority: {
      column: "priority",
    },
    source: {
      column: "source",
    },
    timestamp: {
      column: "timestamp",
    },
  },
  filters: {},
  sortable: ["timestamp", "category", "priority", "source"] as const,
  defaults: {
    columns: [
      "orgId",
      "headline",
      "category",
      "priority",
      "source",
      "timestamp",
    ],
    orderBy: [["timestamp", "DESC"]],
    limit: 5,
    maxLimit: 5,
  },
});
