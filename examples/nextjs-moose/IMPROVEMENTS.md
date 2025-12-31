# Code Improvement Suggestions


## 3. **Centralize Query Keys**
**Issue**: Query keys are duplicated across components (`["metrics", startDate, endDate]` appears in both `dashboard-stats.tsx` and `dashboard-charts.tsx`).

**Fix**: Create `lib/query-keys.ts`:
```typescript
export const queryKeys = {
  metrics: (startDate?: string, endDate?: string) => ["metrics", startDate, endDate],
  eventsOverTime: (startDate?: string, endDate?: string, bucket?: string) => 
    ["eventsOverTime", startDate, endDate, bucket],
} as const;
```

## 4. **Centralize Type Definitions**
**Issue**: Types are scattered (`PieData` in `donut-chart.tsx`, `TimeSeriesData` in `actions/events.ts`, `DataPoint` in context).

**Fix**: Create `types/dashboard.ts`:
```typescript
export interface TimeSeriesDataPoint {
  time: string;
  count: number;
}

export interface PieDataPoint {
  status: string;
  count: number;
}

export interface Metrics {
  totalEvents: number;
  activeEvents: number;
  completedEvents: number;
  revenue: number;
  eventsByStatus: PieDataPoint[];
}
```

## 5. **Extract Utility Functions**
**Issue**: `formatNumber` and `calculateBucket` are defined inline in components.

**Fix**: Create `lib/utils.ts` (or extend existing):
```typescript
export function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

export function calculateDateRangeDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.ceil(Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function calculateBucket(startDate: string, endDate: string): "hour" | "day" {
  const diffDays = calculateDateRangeDays(startDate, endDate);
  return diffDays <= 2 ? "hour" : "day";
}
```

## 6. **Extract Stat Card Component**
**Issue**: `DashboardStats` has repetitive card structure (4 nearly identical cards).

**Fix**: Create `components/stat-card.tsx`:
```typescript
interface StatCardProps {
  title: string;
  value: number;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function StatCard({ title, value, description, icon: Icon }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="text-muted-foreground h-4 w-4" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatNumber(value)}</div>
        <p className="text-muted-foreground text-xs">{description}</p>
      </CardContent>
    </Card>
  );
}
```

Then use it in `DashboardStats`:
```typescript
const stats = [
  { title: "Total Events", value: metrics.totalEvents, description: "Events in selected period", icon: ActivityIcon },
  { title: "Active Events", value: metrics.activeEvents, description: 'Count where status = "active"', icon: TrendingUpIcon },
  // ... etc
];

return (
  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
    {stats.map((stat) => <StatCard key={stat.title} {...stat} />)}
  </div>
);
```

## 7. **Make Refresh Button Functional**
**Issue**: Refresh button in `page.tsx` doesn't do anything.

**Fix**: Use `useQueryClient` to invalidate queries:
```typescript
"use client";
import { useQueryClient } from "@tanstack/react-query";

function RefreshButton() {
  const queryClient = useQueryClient();
  const { startDate, endDate } = useDateFilter();
  
  return (
    <Button 
      variant="outline" 
      onClick={() => {
        queryClient.invalidateQueries({ queryKey: ["metrics", startDate, endDate] });
        queryClient.invalidateQueries({ queryKey: ["eventsOverTime"] });
      }}
    >
      <RefreshCwIcon />
      Refresh
    </Button>
  );
}
```

## 8. **Fix Export Functionality**
**Issue**: `DashboardDateFilter` exports `chartData` from context which is unused. Should export actual query data.

**Fix**: Pass query data to export function or use `useQueryClient` to get cached data:
```typescript
const queryClient = useQueryClient();
const handleExportData = () => {
  const data = queryClient.getQueryData<TimeSeriesDataPoint[]>([
    "eventsOverTime", 
    startDate, 
    endDate
  ]);
  // ... export logic
};
```

## 9. **Extract Date Preset Logic**
**Issue**: Date preset calculation logic is duplicated in `date-filter-bar.tsx` and `dashboard-date-context.tsx`.

**Fix**: Create `lib/date-presets.ts`:
```typescript
export function getDateRangeForPreset(preset: "24h" | "7d" | "30d" | "90d"): { start: string; end: string } {
  const today = new Date();
  const end = today.toISOString().split("T")[0];
  
  const start = new Date(today);
  const days = preset === "24h" ? 1 : preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  start.setDate(start.getDate() - days);
  
  return { start: start.toISOString().split("T")[0], end };
}
```

## 10. **Create Reusable Loading Skeleton**
**Issue**: Loading state in `DashboardStats` uses hardcoded skeleton cards.

**Fix**: Create `components/stat-card-skeleton.tsx`:
```typescript
export function StatCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-4" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-16 mb-2" />
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  );
}
```

## 11. **Remove SeedButton Component**
**Issue**: `SeedButton` component just returns `null` and is not needed.

**Fix**: Remove `SeedButton` import and usage from `page.tsx`.

## 12. **Add Error Handling**
**Issue**: No error states displayed to users when queries fail.

**Fix**: Add error handling to queries:
```typescript
const { data, isLoading, error } = useQuery({
  // ... query config
});

if (error) {
  return <ErrorState message="Failed to load data" />;
}
```

## 13. **Consolidate Date Filter Logic**
**Issue**: Date initialization happens in both `dashboard-date-context.tsx` and `date-filter-bar.tsx`.

**Fix**: Remove date initialization from `date-filter-bar.tsx` since context already handles it.

## 14. **Improve Type Safety**
**Issue**: Some components use `any` or loose types.

**Fix**: 
- Add proper types for all props
- Use `satisfies` for const objects where appropriate
- Export types from a central location

## 15. **Extract Constants**
**Issue**: Magic numbers and strings scattered throughout code.

**Fix**: Create `lib/constants.ts`:
```typescript
export const DEFAULT_DATE_RANGE_DAYS = 30;
export const CHART_HEIGHT = 300;
export const BUCKET_THRESHOLDS = {
  HOUR: 2,
  DAY: 60,
} as const;
```

## Priority Order:
1. **High Priority**: Fix TimeSeriesChart (#1), Remove unused state (#2), Make Refresh functional (#7)
2. **Medium Priority**: Centralize query keys (#3), Extract utilities (#5), Extract StatCard (#6)
3. **Low Priority**: Type centralization (#4), Error handling (#12), Constants (#15)

