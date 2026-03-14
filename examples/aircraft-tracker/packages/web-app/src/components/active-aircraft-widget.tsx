"use client";

import { useEffect, useState } from "react";

interface AircraftMetrics {
  totalAircraft: number;
  planesInAir: number;
  planesOnGround: number;
  avgGroundSpeed: number;
  avgAltitude: number;
  emergencyCount: number;
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number | null;
  unit?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {value === null ?
        <span className="text-2xl font-bold tabular-nums text-muted-foreground animate-pulse">
          --
        </span>
      : <span className="text-2xl font-bold tabular-nums">{value}</span>}
      {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
    </div>
  );
}

export function ActiveAircraftWidget() {
  const [metrics, setMetrics] = useState<AircraftMetrics | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchMetrics() {
      try {
        const res = await fetch("/api/aircraft/active-count");
        if (!res.ok) throw new Error();
        const json = await res.json();
        const row = json.data?.[0];
        if (row) {
          setMetrics({
            totalAircraft: Number(row.totalAircraft) || 0,
            planesInAir: Number(row.planesInAir) || 0,
            planesOnGround: Number(row.planesOnGround) || 0,
            avgGroundSpeed: Math.round(Number(row.avgGroundSpeed) || 0),
            avgAltitude: Math.round(Number(row.avgAltitude) || 0),
            emergencyCount: Number(row.emergencyCount) || 0,
          });
        }
        setAsOf(json.as_of);
        setError(false);
      } catch {
        setError(true);
      }
    }

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <span className="text-sm text-destructive">Metrics unavailable</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
      <div className="grid grid-cols-3 gap-6">
        <Stat label="Total Tracked" value={metrics?.totalAircraft ?? null} />
        <Stat label="In the Air" value={metrics?.planesInAir ?? null} />
        <Stat label="On Ground" value={metrics?.planesOnGround ?? null} />
      </div>
      <div className="grid grid-cols-3 gap-6">
        <Stat
          label="Avg Speed"
          value={metrics?.avgGroundSpeed ?? null}
          unit="kts"
        />
        <Stat
          label="Avg Altitude"
          value={metrics ? metrics.avgAltitude.toLocaleString() : null}
          unit="ft"
        />
        <Stat label="Emergencies" value={metrics?.emergencyCount ?? null} />
      </div>
      {asOf && (
        <p className="text-xs text-muted-foreground text-center">
          Updated {new Date(asOf).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
