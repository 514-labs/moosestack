/**
 * Dashboard Components
 *
 * Components specific to the dashboard page.
 *
 * ## Components
 *
 * - `DateFilterProvider` - Context provider for date filter state
 * - `useDateFilter` - Hook to access date filter context
 * - `FilterBar` - Date range filter bar
 * - `StatsCards` - Stats cards grid
 *
 * ## Usage
 *
 * ```tsx
 * import {
 *   DateFilterProvider,
 *   FilterBar,
 *   StatsCards,
 * } from "@/components/dashboard";
 *
 * export default function DashboardPage() {
 *   return (
 *     <DateFilterProvider>
 *       <FilterBar />
 *       <StatsCards stats={[...]} />
 *     </DateFilterProvider>
 *   );
 * }
 * ```
 *
 * @module dashboard
 */

// Context
export {
  DateFilterProvider,
  DateFilterContext,
  useDateFilter,
  type DateFilterContextType,
} from "./date-context";

// Components
export { FilterBar, type FilterBarProps } from "./filter-bar";
export { StatsCards, type StatsCardsProps, type StatItem } from "./stats-cards";
