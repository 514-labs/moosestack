# Shared Chart Components

Reusable chart components for reports and dashboards.

## Components

### LineChart

Time series / line chart for displaying data over time.

```tsx
import { LineChart } from "@/components/charts";

<LineChart
  data={[
    { time: "2024-01-01", count: 100 },
    { time: "2024-01-02", count: 150 },
  ]}
  title="Events Over Time"
  description="Daily event count"
  xKey="time"
  yKey="count"
/>
```

**Props:**
- `data: TimeSeriesDataPoint[]` - Chart data
- `title: string` - Chart title
- `description?: string` - Chart description
- `xKey?: string` - X-axis data key (default: "time")
- `yKey?: string` - Y-axis data key (default: "count")
- `chartId?: string` - Unique chart ID
- `gridSpan?: GridSpan` - Grid layout span
- `chartConfig?: ChartConfig` - Custom chart config
- `icon?: ReactNode` - Custom icon
- `formatXAxis?: (value: string) => string` - X-axis formatter

### DonutChart

Donut/pie chart with interactive labels.

```tsx
import { DonutChart } from "@/components/charts";

const chartConfig = {
  completed: { label: "Completed", color: "var(--chart-1)" },
  active: { label: "Active", color: "var(--chart-2)" },
};

<DonutChart
  data={[
    { name: "completed", value: 300 },
    { name: "active", value: 150 },
  ]}
  chartConfig={chartConfig}
  title="Events by Status"
  centerValue={450}
  centerLabel="Total"
/>
```

**Props:**
- `data: PieDataPoint[]` - Chart data
- `chartConfig: ChartConfig` - Color/label config
- `title: string` - Chart title
- `centerValue: number | string` - Center display value
- `centerLabel?: string` - Center label
- `icon?: ReactNode` - Custom icon
- `chartId?: string` - Unique chart ID
- `gridSpan?: GridSpan` - Grid layout span

### ChartWidget

Generic wrapper for charts with fullscreen and display options.

```tsx
import { ChartWidget, chartConfigs } from "@/components/charts";

<ChartWidget
  chartId="my-chart"
  chartType="timeSeries"
  title="My Chart"
  chartConfig={chartConfigs.timeSeries}
>
  {({ options }) => (
    <MyCustomChart showGrid={options.showGrid} />
  )}
</ChartWidget>
```

**Props:**
- `chartId: string` - Unique chart ID
- `chartType: string` - Chart type identifier
- `title: string` - Chart title
- `description?: string` - Chart description
- `icon?: ReactNode` - Header icon
- `gridSpan?: GridSpan` - Grid layout span
- `children` - Chart content (can be render function)
- `chartConfig: ChartTypeConfig` - Chart configuration

### ChartDisplayOptionsPopover

Popover for toggling chart display options.

```tsx
import { useChartDisplayOptions } from "@/components/charts";

const { options, ChartDisplayOptions } = useChartDisplayOptions({
  initialOptions: { showGrid: true, showTooltip: true },
});

// In your component
<ChartDisplayOptions />
<MyChart showGrid={options.showGrid} />
```

## Types

```ts
// Time series data point
interface TimeSeriesDataPoint {
  time: string;
  count: number;
  [key: string]: string | number;
}

// Pie/donut data point
interface PieDataPoint {
  name: string;
  value: number;
}

// Grid span for responsive layout
interface GridSpan {
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
}

// Display options
interface ChartDisplayOptions {
  showLabels?: boolean;
  showLegend?: boolean;
  showGrid?: boolean;
  showTooltip?: boolean;
}
```

## Chart Configs

Pre-configured chart type configurations:

```ts
import { chartConfigs } from "@/components/charts";

// Available configs:
chartConfigs.timeSeries  // { showGrid: true, showTooltip: true }
chartConfigs.donut       // { showLabels: true }
chartConfigs.bar         // { showGrid: true, showTooltip: true, showLabels: true }
chartConfigs.area        // { showGrid: true, showTooltip: true }
```

## Usage with Dashboard

```tsx
import { LineChart, DonutChart } from "@/components/charts";
import { useDateFilter, useMetrics, useEventsOverTime } from "@/lib/hooks";

export function DashboardCharts() {
  const { startDate, endDate } = useDateFilter();
  const { data: timeSeriesData } = useEventsOverTime(startDate, endDate);
  const { data: metrics } = useMetrics(startDate, endDate);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <LineChart
        data={timeSeriesData}
        title="Events Over Time"
        gridSpan={{ lg: 2 }}
      />
      <DonutChart
        data={metrics.eventsByStatus}
        chartConfig={statusChartConfig}
        title="Events by Status"
        centerValue={metrics.totalEvents}
      />
    </div>
  );
}
```

## Usage with Report Builder

Charts can be used in the Report Builder results section:

```tsx
import { LineChart } from "@/components/charts";
import type { TimeSeriesDataPoint } from "@/components/charts";

// Transform report results to chart data
const chartData: TimeSeriesDataPoint[] = results.map(row => ({
  time: row.day as string,
  count: row.totalEvents as number,
}));

<LineChart
  data={chartData}
  title="Results Visualization"
  xKey="time"
  yKey="count"
/>
```

## Customization

### Custom Colors

Use CSS variables for consistent theming:

```tsx
const chartConfig = {
  success: { label: "Success", color: "var(--chart-1)" },
  warning: { label: "Warning", color: "var(--chart-2)" },
  error: { label: "Error", color: "var(--chart-3)" },
};
```

### Custom Formatters

```tsx
<LineChart
  data={data}
  title="Revenue"
  formatXAxis={(value) => new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}
/>
```

### Grid Layout

Use `gridSpan` for responsive layouts:

```tsx
<LineChart
  gridSpan={{ sm: 1, md: 2, lg: 2 }}
  // Takes full width on sm, 2 cols on md+
/>
```
