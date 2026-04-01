import { type MooseUtils, sql } from "@514labs/moose-lib";
import type { DashboardSnapshot } from "agent-contracts";
import {
  executeScopedSql,
  formatClickHouseDateTime,
} from "../../data/clickhouse/readonly-query";
import { TenantKnowledgeTable } from "../ingest/models";

export async function getDashboardSnapshot(
  queryClient: MooseUtils["client"]["query"],
): Promise<DashboardSnapshot> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const knowledgeMetricsQuery = sql.statement`
    SELECT
      count(*) AS totalRecords,
      countIf(
        ${TenantKnowledgeTable.columns.priority} = 'high'
        AND ${TenantKnowledgeTable.columns.timestamp} >= toDateTime(${formatClickHouseDateTime(weekAgo)})
        AND ${TenantKnowledgeTable.columns.timestamp} <= toDateTime(${formatClickHouseDateTime(now)})
      ) AS highPriorityRecords
    FROM ${TenantKnowledgeTable}
  `;

  const recentKnowledgeQuery = sql.statement`
    SELECT
      ${TenantKnowledgeTable.columns.org_id} AS orgId,
      ${TenantKnowledgeTable.columns.headline},
      ${TenantKnowledgeTable.columns.category},
      ${TenantKnowledgeTable.columns.priority},
      ${TenantKnowledgeTable.columns.source},
      ${TenantKnowledgeTable.columns.timestamp}
    FROM ${TenantKnowledgeTable}
    ORDER BY ${TenantKnowledgeTable.columns.timestamp} DESC
    LIMIT 5
  `;

  const [knowledgeMetrics, recentKnowledge] = await Promise.all([
    executeScopedSql<{
      totalRecords: number;
      highPriorityRecords: number;
    }>(queryClient, knowledgeMetricsQuery),
    executeScopedSql<{
      orgId: string;
      headline: string;
      category: string;
      priority: string;
      source: string;
      timestamp: string;
    }>(queryClient, recentKnowledgeQuery),
  ]);

  return {
    knowledgeMetrics: knowledgeMetrics[0] ?? {
      totalRecords: 0,
      highPriorityRecords: 0,
    },
    recentKnowledge,
  };
}
