/**
 * Dashboard Components
 *
 * Components and hooks for building dashboard pages with shared global filters.
 */

// Provider & Filters
export {
  DashboardProvider,
  useDashboardFilters,
  type DashboardFilters,
  type DashboardActions,
  type DashboardContextValue,
} from "./dashboard-provider";

// Query Hooks
export {
  useMetrics,
  useEventsByStatus,
  useTimeseries,
  dashboardQueryKeys,
} from "./dashboard-hooks";

// UI Components
export { FilterBar, type FilterBarProps } from "./filter-bar";
export { EventsOverTimeChart } from "./events-over-time-chart";
export {
  DashboardMetricCards,
  MetricCards,
  type DashboardMetricCardsProps,
} from "./metric-cards";

// Types (re-export from actions for convenience)
export type { BucketSize } from "@/app/actions";
