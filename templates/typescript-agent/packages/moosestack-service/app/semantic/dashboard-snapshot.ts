import {
  type MooseUtils,
  type RowPolicyOptions,
  sql,
} from "@514labs/moose-lib";
import type { DashboardSnapshot } from "agent-contracts";
import { executeReadonlySql } from "../data/clickhouse/readonly-query";
import { TenantKnowledgeTable } from "../ingest/models";
import { tenantKnowledgeMetricsModel } from "./knowledge";

export type DashboardSnapshotAccess =
  | {
      kind: "tenant";
      tenantId: string;
      rowPolicyOptions: RowPolicyOptions;
    }
  | {
      kind: "admin";
      rowPolicyOptions?: undefined;
    };

export async function getDashboardSnapshot(
  queryClient: MooseUtils["client"]["query"],
  access: DashboardSnapshotAccess,
): Promise<DashboardSnapshot> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const knowledgeMetricsQuery = tenantKnowledgeMetricsModel.toSql({
    metrics: ["totalRecords", "highPriorityRecords"],
    filters: {
      timestamp: { gte: weekAgo, lte: now },
    },
  });

  const recentKnowledgeQuery = sql.statement`
    SELECT
      ${TenantKnowledgeTable.columns.tenant_id} AS tenantId,
      ${TenantKnowledgeTable.columns.headline},
      ${TenantKnowledgeTable.columns.category},
      ${TenantKnowledgeTable.columns.priority},
      ${TenantKnowledgeTable.columns.source},
      ${TenantKnowledgeTable.columns.timestamp}
    FROM ${TenantKnowledgeTable}
    ORDER BY ${TenantKnowledgeTable.columns.timestamp} DESC
    LIMIT 5
  `;

  const [[knowledgeMetrics], recentKnowledge] = await Promise.all([
    executeReadonlySql<{
      totalRecords: number;
      highPriorityRecords: number;
    }>(queryClient, knowledgeMetricsQuery, {
      rowPolicyOptions: access.rowPolicyOptions,
    }),
    executeReadonlySql<{
      tenantId: string;
      headline: string;
      category: string;
      priority: string;
      source: string;
      timestamp: string;
    }>(queryClient, recentKnowledgeQuery, {
      rowPolicyOptions: access.rowPolicyOptions,
    }),
  ]);

  return {
    knowledgeMetrics: knowledgeMetrics ?? {
      totalRecords: 0,
      highPriorityRecords: 0,
    },
    recentKnowledge,
  };
}
