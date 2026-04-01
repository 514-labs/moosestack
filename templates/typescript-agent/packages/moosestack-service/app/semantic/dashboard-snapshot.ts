import {
  type MooseUtils,
  type RowPolicyOptions,
  sql,
} from "@514labs/moose-lib";
import type { DashboardSnapshot } from "agent-contracts";
import { TenantKnowledgeTable } from "../ingest/models";
import { executeReadonlySql } from "../data/clickhouse/readonly-query";

function formatClickHouseDateTime(value: Date): string {
  return value.toISOString().slice(0, 19).replace("T", " ");
}

export async function getDashboardSnapshot(
  queryClient: MooseUtils["client"]["query"],
  rowPolicyOptions?: RowPolicyOptions,
): Promise<DashboardSnapshot> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const knowledgeMetricsQuery = sql.statement`
    SELECT
      count(*) AS totalRecords,
      countIf(${TenantKnowledgeTable.columns.priority} = 'high') AS highPriorityRecords
    FROM ${TenantKnowledgeTable}
    WHERE ${TenantKnowledgeTable.columns.timestamp} >= toDateTime(${formatClickHouseDateTime(weekAgo)})
      AND ${TenantKnowledgeTable.columns.timestamp} <= toDateTime(${formatClickHouseDateTime(now)})
    LIMIT 50
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
    executeReadonlySql<{
      totalRecords: number;
      highPriorityRecords: number;
    }>(queryClient, knowledgeMetricsQuery, { rowPolicyOptions }),
    executeReadonlySql<{
      orgId: string;
      headline: string;
      category: string;
      priority: string;
      source: string;
      timestamp: string;
    }>(queryClient, recentKnowledgeQuery, { rowPolicyOptions }),
  ]);

  return {
    knowledgeMetrics: knowledgeMetrics[0] ?? {
      totalRecords: 0,
      highPriorityRecords: 0,
    },
    recentKnowledge,
  };
}
