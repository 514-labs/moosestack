# Dashboard Components

Components specific to the dashboard page, including date filter context and stats display.

## Components

### DateFilterProvider

Context provider for managing date filter state across the dashboard.

```tsx
import { DateFilterProvider } from "@/components/dashboard";

export default function DashboardLayout({ children }) {
  return (
    <DateFilterProvider>
      {children}
    </DateFilterProvider>
  );
}
```

### useDateFilter

Hook to access the date filter context.

```tsx
import { useDateFilter } from "@/components/dashboard";

function MyComponent() {
  const { startDate, endDate, setStartDate, setEndDate } = useDateFilter();

  return (
    <div>
      <p>Start: {startDate}</p>
      <p>End: {endDate}</p>
    </div>
  );
}
```

**Returns:**
- `startDate: string` - Current start date (YYYY-MM-DD)
- `endDate: string` - Current end date (YYYY-MM-DD)
- `setStartDate: (date: string) => void` - Update start date
- `setEndDate: (date: string) => void` - Update end date

### FilterBar

Date range filter bar with preset selector.

```tsx
import { FilterBar } from "@/components/dashboard";

<FilterBar showPresets={true} />
```

**Props:**
- `className?: string` - Additional CSS classes
- `showPresets?: boolean` - Show preset dropdown (default: true)

### StatsCards

Grid of stat cards for displaying key metrics.

```tsx
import { StatsCards, type StatItem } from "@/components/dashboard";
import { ActivityIcon, TrendingUpIcon } from "lucide-react";

const stats: StatItem[] = [
  {
    title: "Total Events",
    value: 1234,
    icon: ActivityIcon,
    change: "+12%",
    isPositive: true,
    description: "vs last month",
  },
  {
    title: "Active Users",
    value: 567,
    icon: TrendingUpIcon,
    change: "-5%",
    isPositive: false,
  },
];

<StatsCards stats={stats} isLoading={false} />
```

**Props:**
- `stats: StatItem[]` - Array of stat items
- `isLoading?: boolean` - Show loading skeleton
- `columns?: { sm?: number; md?: number; lg?: number }` - Grid columns
- `className?: string` - Additional CSS classes

**StatItem:**
```ts
interface StatItem {
  title: string;
  value: number | string;
  description?: string;
  icon?: LucideIcon;
  change?: string;
  isPositive?: boolean;
}
```

## Usage

### Complete Dashboard Page

```tsx
import {
  DateFilterProvider,
  FilterBar,
  StatsCards,
  useDateFilter,
} from "@/components/dashboard";
import { LineChart, DonutChart } from "@/components/charts";

export default function DashboardPage() {
  return (
    <DateFilterProvider>
      <div className="space-y-6">
        <FilterBar />
        <DashboardContent />
      </div>
    </DateFilterProvider>
  );
}

function DashboardContent() {
  const { startDate, endDate } = useDateFilter();
  const { data: metrics, isLoading } = useMetrics(startDate, endDate);

  const stats = metrics ? [
    { title: "Total", value: metrics.total, icon: ActivityIcon },
    // ...more stats
  ] : [];

  return (
    <>
      <StatsCards stats={stats} isLoading={isLoading} />
      <div className="grid gap-4 md:grid-cols-2">
        <LineChart data={metrics?.timeSeries ?? []} title="Trend" />
        <DonutChart data={metrics?.byStatus ?? []} title="Status" />
      </div>
    </>
  );
}
```

### Custom Filter Bar

```tsx
import { DateRangeInput } from "@/components/inputs";
import { useDateFilter } from "@/components/dashboard";

function CustomFilterBar() {
  const { startDate, endDate, setStartDate, setEndDate } = useDateFilter();

  return (
    <div className="flex gap-4 p-4 border rounded-lg">
      <DateRangeInput
        startDate={startDate}
        endDate={endDate}
        onChange={({ start, end }) => {
          setStartDate(start);
          setEndDate(end);
        }}
        showPresets={true}
      />
      {/* Add more filters */}
    </div>
  );
}
```

## Integration with React Query

The dashboard components work seamlessly with React Query hooks:

```tsx
// lib/hooks.ts
import { useDateFilter } from "@/components/dashboard";

export function useMetrics(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ["metrics", startDate, endDate],
    queryFn: () => fetchMetrics(startDate, endDate),
    enabled: !!startDate && !!endDate,
  });
}

// In component
function MetricsDisplay() {
  const { startDate, endDate } = useDateFilter();
  const { data, isLoading } = useMetrics(startDate, endDate);

  // Data automatically refetches when dates change
  return <StatsCards stats={data} isLoading={isLoading} />;
}
```
