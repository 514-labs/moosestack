import type { MooseUtils, RowPolicyOptions } from "@514labs/moose-lib";
import type { DashboardSnapshot } from "agent-contracts";
import { executeReadonlySql } from "../data/clickhouse/readonly-query";
import {
  tenantKnowledgeMetricsModel,
  tenantKnowledgeRecordsModel,
} from "./knowledge";

export async function getDashboardSnapshot(
  queryClient: MooseUtils["client"]["query"],
  rowPolicyOptions?: RowPolicyOptions,
): Promise<DashboardSnapshot> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const knowledgeMetricsQuery = tenantKnowledgeMetricsModel.toSql({
    metrics: ["totalRecords", "highPriorityRecords"],
    filters: {
      timestamp: { gte: weekAgo, lte: now },
    },
  });

  const recentKnowledgeQuery = tenantKnowledgeRecordsModel.toSql({
    columns: ["headline", "category", "priority", "source", "timestamp"],
    orderBy: [["timestamp", "DESC"]],
    limit: 5,
  });

  const [[knowledgeMetrics], recentKnowledge] = await Promise.all([
    executeReadonlySql<{
      totalRecords: number;
      highPriorityRecords: number;
    }>(queryClient, knowledgeMetricsQuery, { rowPolicyOptions }),
    executeReadonlySql<{
      headline: string;
      category: string;
      priority: string;
      source: string;
      timestamp: string;
    }>(queryClient, recentKnowledgeQuery, { rowPolicyOptions }),
  ]);

  return {
    knowledgeMetrics: knowledgeMetrics ?? {
      totalRecords: 0,
      highPriorityRecords: 0,
    },
    recentKnowledge,
  };
}
