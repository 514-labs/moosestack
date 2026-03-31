export const ACCESS_ROLE_TENANT = "tenant";
export const ACCESS_ROLE_ADMIN_DEBUG = "admin_debug";

export type AccessRole =
  | typeof ACCESS_ROLE_TENANT
  | typeof ACCESS_ROLE_ADMIN_DEBUG;

export interface KnowledgeMetrics {
  totalRecords: number;
  highPriorityRecords: number;
}

export interface RecentKnowledgeRecord {
  orgId: string;
  headline: string;
  category: string;
  priority: string;
  source: string;
  timestamp: string;
}

export interface DashboardSnapshot {
  knowledgeMetrics: KnowledgeMetrics;
  recentKnowledge: RecentKnowledgeRecord[];
}

export const DASHBOARD_SNAPSHOT_PATH = "/app/dashboard/snapshot";
