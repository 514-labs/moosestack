/**
 * Report Builder Components
 *
 * A generic, modular report builder that works with any QueryModel instance.
 *
 * Components:
 * - ToggleChip: Selectable dimension/metric chips
 * - ResultsTable: Display query results in a table
 * - ReportBuilder: Main component for building custom reports
 *
 * @example
 * import { ReportBuilder, createReportConfig } from "@/components/report-builder";
 *
 * // Define configuration for your QueryModel
 * const config = createReportConfig({
 *   dimensions: [
 *     { id: "status", label: "Status", description: "Event status" },
 *     { id: "day", label: "Day", description: "Day (date)" },
 *   ],
 *   metrics: [
 *     { id: "totalEvents", label: "Total Events" },
 *     { id: "totalAmount", label: "Total Amount" },
 *   ],
 *   execute: async (params) => {
 *     "use server";
 *     return getOverallStats(params);
 *   },
 * });
 *
 * // Use in your component
 * <ReportBuilder {...config} />
 */

// Components
export { ToggleChip, type ToggleChipProps } from "./toggle-chip";
export { ResultsTable, type ResultsTableProps } from "./results-table";
export { ReportBuilder, type ReportBuilderProps } from "./report-builder";

// Types and utilities
export {
  createReportConfig,
  type FieldMeta,
  type ReportQueryParams,
  type ReportBuilderConfig,
  type ResultsTableConfig,
} from "./types";
