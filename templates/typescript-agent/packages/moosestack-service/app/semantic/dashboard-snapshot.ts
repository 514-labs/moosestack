import { type MooseUtils, sql } from "@514labs/moose-lib";
import type { DashboardSnapshot } from "agent-contracts";
import { executeReadonlySql } from "../data/clickhouse/readonly-query";
import { TenantKnowledgeTable } from "../ingest/models";
import { knowledgeMetricsModel } from "./knowledge";

export async function getDashboardSnapshot(
  queryClient: MooseUtils["client"]["query"],
  tenantId: string,
): Promise<DashboardSnapshot> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const knowledgeMetricsQuery = knowledgeMetricsModel.toSql({
    dimensions: [],
    metrics: ["totalRecords", "highPriorityRecords"],
    filters: {
      timestamp: { gte: weekAgo, lte: now },
      tenantId: { eq: tenantId },
    },
  });

  const recentKnowledgeQuery = sql.statement`
    SELECT
      ${TenantKnowledgeTable.columns.headline},
      ${TenantKnowledgeTable.columns.category},
      ${TenantKnowledgeTable.columns.priority},
      ${TenantKnowledgeTable.columns.source},
      ${TenantKnowledgeTable.columns.timestamp}
    FROM ${TenantKnowledgeTable}
    WHERE ${TenantKnowledgeTable.columns.tenant_id} = ${tenantId}
    ORDER BY ${TenantKnowledgeTable.columns.timestamp} DESC
    LIMIT 5
  `;

  const [[knowledgeMetrics], recentKnowledge] = await Promise.all([
    executeReadonlySql<{
      totalRecords: number;
      highPriorityRecords: number;
    }>(queryClient, knowledgeMetricsQuery),
    executeReadonlySql<{
      headline: string;
      category: string;
      priority: string;
      source: string;
      timestamp: string;
    }>(queryClient, recentKnowledgeQuery),
  ]);

  return {
    knowledgeMetrics: knowledgeMetrics ?? {
      totalRecords: 0,
      highPriorityRecords: 0,
    },
    recentKnowledge,
  };
}
