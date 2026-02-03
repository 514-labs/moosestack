/**
 * Report Builder
 *
 * A hook-based report builder for QueryModel instances.
 *
 * ## Quick Start
 *
 * ```tsx
 * // page.tsx (Server Component)
 * import { prepareModel } from "@/components/report-builder";
 * import { statsModel } from "moose";
 *
 * const model = prepareModel(statsModel, {
 *   filters: {
 *     status: { inputType: "select", options: [...] },
 *   },
 * });
 *
 * export default function Page() {
 *   return <ReportPage model={model} />;
 * }
 * ```
 *
 * ```tsx
 * // report-page.tsx (Client Component)
 * "use client";
 * import { useReport, DimensionChips, MetricChips } from "@/components/report-builder";
 *
 * export function ReportPage({ model, executeQuery }) {
 *   const report = useReport({
 *     model,
 *     execute: executeQuery,
 *     defaults: { dimensions: ["status"], metrics: ["totalEvents"] },
 *   });
 *
 *   return (
 *     <div>
 *       <DimensionChips
 *         options={report.model.dimensions}
 *         selected={report.state.dimensions}
 *         onToggle={report.actions.toggleDimension}
 *       />
 *       <MetricChips
 *         options={report.model.metrics}
 *         selected={report.state.metrics}
 *         onToggle={report.actions.toggleMetric}
 *       />
 *       // ... filters, results, etc.
 *     </div>
 *   );
 * }
 * ```
 *
 * @module report-builder
 */

// =============================================================================
// Primary API - Hook & Server Helper
// =============================================================================

export {
  useReport,
  type UseReportOptions,
  type UseReportReturn,
  type ReportModel,
  type ReportState,
  type ReportActions,
  type ReportQuery,
} from "./use-report";

export {
  prepareModel,
  type PrepareModelOptions,
  type FilterOverride,
  type FieldOverride,
} from "./prepare-model";

// =============================================================================
// UI Components (use with useReport)
// =============================================================================

export {
  DimensionChips,
  MetricChips,
  FilterRow,
  ExecuteButton,
  SimpleResultsTable,
  type DimensionChipsProps,
  type MetricChipsProps,
  type FilterRowProps,
  type ExecuteButtonProps,
  type SimpleResultsTableProps,
} from "./components";

// =============================================================================
// Core Types
// =============================================================================

export type {
  FieldOption,
  FieldMeta,
  FilterOperator,
  FilterInputType,
  FilterSelectOption,
  FilterMeta,
  FilterValue,
  QueryRequest,
  FilterParams,
} from "./types";

// =============================================================================
// Re-exported Input Components
// =============================================================================

export {
  MultiSelectChips,
  DatePicker,
  DateRangeInput,
  SelectDropdown,
} from "@/components/inputs";
