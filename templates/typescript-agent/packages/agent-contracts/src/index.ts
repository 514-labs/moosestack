export interface KnowledgeMetrics {
  totalRecords: number;
  highPriorityRecords: number;
}

export interface RecentKnowledgeRecord {
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
