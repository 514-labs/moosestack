"use client";

import * as React from "react";
import {
  Plane,
  Radio,
  Gauge,
  Mountain,
  AlertTriangle,
  Navigation,
  Database,
  Clock,
} from "lucide-react";
import {
  MetricCard,
  MetricRow,
  MetricCardsContainer,
  LineChart,
  DonutChart,
} from "@/components/widgets";
import type { ChartConfig } from "@/components/ui/chart";
import {
  getMetrics,
  getAircraftOverTime,
  getAircraftByCategory,
  getDatasetMetadata,
  type MetricsResult,
  type TimeSeriesPoint,
  type CategoryBreakdown,
  type DatasetMetadata,
} from "@/app/actions";

const POLL_INTERVAL = 30_000;

const categoryChartConfig: ChartConfig = {
  unknown: { label: "Unknown", color: "var(--chart-1)" },
  light: { label: "Light", color: "var(--chart-2)" },
  rotorcraft: { label: "Rotorcraft", color: "var(--chart-3)" },
  heavy: { label: "Heavy", color: "var(--chart-4)" },
  other: { label: "Other", color: "var(--chart-5)" },
};

function usePolledData<T>(
  fetcher: () => Promise<T>,
  interval = POLL_INTERVAL,
): { data: T | null; error: boolean } {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const result = await fetcher();
        if (active) {
          setData(result);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    }
    poll();
    const id = setInterval(poll, interval);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [fetcher, interval]);

  return { data, error };
}

function formatTimestamp(ts: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DatasetMetadataRow({ data }: { data: DatasetMetadata | null }) {
  const loading = data === null;
  return (
    <MetricCardsContainer>
      <MetricRow>
        <MetricCard
          title="Datapoints"
          value={loading ? "—" : data.totalDatapoints}
          icon={Database}
          description="Rows ingested"
        />
        <MetricCard
          title="First Seen"
          value={loading ? "—" : formatTimestamp(data.firstSeen)}
          icon={Clock}
          description="Earliest record"
        />
        <MetricCard
          title="Last Seen"
          value={loading ? "—" : formatTimestamp(data.lastSeen)}
          icon={Clock}
          description="Latest record"
        />
        <MetricCard
          title="Categories"
          value={loading ? "—" : data.distinctCategories}
          icon={Database}
          description="Distinct emitter types"
        />
        <MetricCard
          title="Aircraft Types"
          value={loading ? "—" : data.distinctAircraftTypes}
          icon={Database}
          description="Distinct ICAO codes"
        />
      </MetricRow>
    </MetricCardsContainer>
  );
}

function DashboardMetrics({ data }: { data: MetricsResult | null }) {
  const loading = data === null;

  return (
    <MetricCardsContainer>
      <MetricRow>
        <MetricCard
          title="Total Tracked"
          value={loading ? "—" : data.totalAircraft}
          icon={Radio}
          description="Distinct aircraft"
        />
        <MetricCard
          title="Ever Airborne"
          value={loading ? "—" : data.planesInAir}
          icon={Plane}
          description="Reported airborne at least once"
        />
        <MetricCard
          title="Ever on Ground"
          value={loading ? "—" : data.planesOnGround}
          icon={Navigation}
          description="Reported on ground at least once"
        />
        <MetricCard
          title="Avg Speed"
          value={loading ? "—" : `${Math.round(data.avgGroundSpeed)} kts`}
          icon={Gauge}
        />
        <MetricCard
          title="Avg Altitude"
          value={
            loading ? "—" : (
              `${Math.round(data.avgAltitude).toLocaleString()} ft`
            )
          }
          icon={Mountain}
        />
        <MetricCard
          title="Emergencies"
          value={loading ? "—" : data.emergencyCount}
          icon={AlertTriangle}
        />
      </MetricRow>
    </MetricCardsContainer>
  );
}

export function Dashboard() {
  const { data: metrics, error: metricsError } = usePolledData(
    React.useCallback(() => getMetrics(), []),
  );
  const { data: metadata } = usePolledData(
    React.useCallback(() => getDatasetMetadata(), []),
  );
  const { data: timeseries } = usePolledData(
    React.useCallback(() => getAircraftOverTime(), []),
  );
  const { data: categories } = usePolledData(
    React.useCallback(() => getAircraftByCategory(), []),
  );

  if (metricsError) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <span className="text-sm text-destructive">
          Dashboard unavailable — is the backend running?
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DatasetMetadataRow data={metadata} />
      <DashboardMetrics data={metrics} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <LineChart
          title="Activity Over Time"
          description="Distinct aircraft tracked per minute and datapoints ingested per minute. Connector polls adsb.lol every 30s, so each minute bucket contains 1–2 polls."
          data={timeseries ?? []}
          lines={[
            {
              dataKey: "aircraft",
              label: "Aircraft Tracked",
              color: "var(--chart-1)",
            },
            {
              dataKey: "datapoints",
              label: "Datapoints",
              color: "var(--chart-3)",
            },
          ]}
          dualAxis
          className="lg:col-span-2"
          height={300}
        />
        <DonutChart
          title="By Category"
          data={categories ?? []}
          chartConfig={categoryChartConfig}
          centerValue={metrics?.totalAircraft ?? "—"}
          centerLabel="total"
        />
      </div>
    </div>
  );
}
