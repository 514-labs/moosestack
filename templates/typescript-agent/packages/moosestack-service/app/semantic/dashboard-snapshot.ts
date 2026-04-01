import type { MooseUtils } from "@514labs/moose-lib";
import type { DashboardSnapshot } from "agent-contracts";
import { executeScopedSql } from "../../data/clickhouse/readonly-query";
import {
  dashboardKnowledgeMetricsModel,
  dashboardRecentKnowledgeModel,
} from "./dashboard";

export async function getDashboardSnapshot(
  queryClient: MooseUtils["client"]["query"],
): Promise<DashboardSnapshot> {
  const [knowledgeMetrics, recentKnowledge] = await Promise.all([
    executeScopedSql<{
      totalRecords: number;
      highPriorityRecords: number;
    }>(
      queryClient,
      dashboardKnowledgeMetricsModel.toSql({
        metrics: ["totalRecords", "highPriorityRecords"],
        limit: 1,
      }),
    ),
    executeScopedSql<{
      orgId: string;
      headline: string;
      category: string;
      priority: string;
      source: string;
      timestamp: string;
    }>(
      queryClient,
      dashboardRecentKnowledgeModel.toSql({
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
      }),
    ),
  ]);

  return {
    knowledgeMetrics: knowledgeMetrics[0] ?? {
      totalRecords: 0,
      highPriorityRecords: 0,
    },
    recentKnowledge,
  };
}
