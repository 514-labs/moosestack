"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";
import { analyticsApi, fetchApi, type SegmentData } from "@/lib/api";

export function CustomerSegments() {
  const [campaignData, setCampaignData] = useState<SegmentData[]>([]);
  const [deviceData, setDeviceData] = useState<SegmentData[]>([]);
  const [campaignLoading, setCampaignLoading] = useState(true);
  const [deviceLoading, setDeviceLoading] = useState(true);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  useEffect(() => {
    fetchApi<SegmentData[]>(analyticsApi.campaignSegments)
      .then(setCampaignData)
      .catch((err) => setCampaignError(err.message || "Failed to load"))
      .finally(() => setCampaignLoading(false));

    fetchApi<SegmentData[]>(analyticsApi.deviceSegments)
      .then(setDeviceData)
      .catch((err) => setDeviceError(err.message || "Failed to load"))
      .finally(() => setDeviceLoading(false));
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Signups by Channel</CardTitle>
          <CardDescription>Acquisition channel breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          {campaignLoading ?
            <div className="flex items-center justify-center h-[220px] text-muted-foreground">
              Loading...
            </div>
          : campaignError ?
            <div className="flex items-center justify-center h-[220px] text-destructive">
              {campaignError}
            </div>
          : campaignData.length === 0 ?
            <div className="flex items-center justify-center h-[220px] text-muted-foreground">
              No data available
            </div>
          : <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={campaignData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {campaignData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-lg border bg-background p-2 shadow-sm">
                          <div className="font-medium">{d.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {d.value} signups
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          }
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Device Breakdown</CardTitle>
          <CardDescription>Where users click through</CardDescription>
        </CardHeader>
        <CardContent>
          {deviceLoading ?
            <div className="flex items-center justify-center h-[220px] text-muted-foreground">
              Loading...
            </div>
          : deviceError ?
            <div className="flex items-center justify-center h-[220px] text-destructive">
              {deviceError}
            </div>
          : deviceData.length === 0 ?
            <div className="flex items-center justify-center h-[220px] text-muted-foreground">
              No data available
            </div>
          : <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={deviceData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {deviceData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-lg border bg-background p-2 shadow-sm">
                          <div className="font-medium">{d.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {d.value} clicks
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          }
        </CardContent>
      </Card>
    </div>
  );
}
