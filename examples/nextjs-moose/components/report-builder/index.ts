/**
 * Report Builder Components
 *
 * A generic, reusable report builder for QueryModel instances.
 * See README.md for full documentation and usage patterns.
 *
 * ## Quick Start
 *
 * 1. Create a Server Action for your QueryModel:
 *    ```ts
 *    // app/actions/my-report.ts
 *    "use server";
 *    import { getMyData } from "moose";
 *    export async function executeMyQuery(params) {
 *      return getMyData(params);
 *    }
 *    ```
 *
 * 2. Create a wrapper Client Component:
 *    ```tsx
 *    // components/my-report-builder.tsx
 *    "use client";
 *    import { ReportBuilder, FieldMeta } from "@/components/report-builder";
 *    import { executeMyQuery } from "@/app/actions/my-report";
 *
 *    const DIMENSIONS: FieldMeta<MyDimension>[] = [...];
 *    const METRICS: FieldMeta<MyMetric>[] = [...];
 *
 *    export function MyReportBuilder() {
 *      return (
 *        <ReportBuilder
 *          dimensions={DIMENSIONS}
 *          metrics={METRICS}
 *          execute={executeMyQuery}
 *        />
 *      );
 *    }
 *    ```
 *
 * 3. Use in your page:
 *    ```tsx
 *    import { MyReportBuilder } from "@/components/my-report-builder";
 *    export default function Page() {
 *      return <MyReportBuilder />;
 *    }
 *    ```
 *
 * @module report-builder
 */

// Components
export { ResultsTable, type ResultsTableProps } from "./results-table";
export { ReportBuilder, type ReportBuilderProps } from "./report-builder";

// Types
export {
  type FieldMeta,
  type ReportQueryParams,
  type ReportBuilderConfig,
  type ResultsTableConfig,
} from "./types";

// Re-export shared input components for convenience
export {
  MultiSelectChips,
  DatePicker,
  DateRangeInput,
  SelectDropdown,
} from "@/components/inputs";
