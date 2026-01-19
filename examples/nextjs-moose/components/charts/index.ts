/**
 * Shared Chart Components
 *
 * Reusable chart components for reports and dashboards.
 *
 * ## Components
 *
 * - `ChartWidget` - Generic chart wrapper with fullscreen and options
 * - `LineChart` - Time series / line chart
 * - `DonutChart` - Donut/pie chart with labels
 * - `ChartDisplayOptionsPopover` - Display options popover
 *
 * ## Usage
 *
 * ```tsx
 * import { LineChart, DonutChart } from "@/components/charts";
 *
 * // Line chart
 * <LineChart
 *   data={timeSeriesData}
 *   title="Events Over Time"
 *   xKey="time"
 *   yKey="count"
 * />
 *
 * // Donut chart
 * <DonutChart
 *   data={pieData}
 *   chartConfig={myChartConfig}
 *   title="Events by Status"
 *   centerValue={totalEvents}
 *   centerLabel="Total"
 * />
 * ```
 *
 * @module charts
 */

// Components
export { ChartWidget, type ChartWidgetProps } from "./chart-widget";
export { LineChart, type LineChartProps } from "./line-chart";
export { DonutChart, type DonutChartProps } from "./donut-chart";
export {
  ChartDisplayOptionsPopover,
  useChartDisplayOptions,
  type ChartDisplayOptionsProps,
  type UseChartDisplayOptionsProps,
} from "./chart-display-options";

// Configs
export { chartConfigs } from "./chart-configs";

// Types
export {
  type ChartType,
  type ChartDisplayOptions,
  type ChartTypeConfig,
  type GridSpan,
  type ExportFormat,
  type ExportData,
  type ShareableState,
  type DataPoint,
  type TimeSeriesDataPoint,
  type PieDataPoint,
  DEFAULT_OPTION_LABELS,
} from "./types";
