"use client";

import * as React from "react";
import { DateFilterBar } from "@/components/date-filter-bar";
import { TimeSeriesChart } from "@/components/time-series-chart";

interface DataPoint {
  time: string;
  value: number;
}

// Generate data based on date range
function generateDataForDateRange(
  startDate: string,
  endDate: string,
): DataPoint[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // Generate hourly data points
  const data: DataPoint[] = [];
  const hoursDiff = Math.max(1, diffDays * 24);
  const numPoints = Math.min(hoursDiff, 48); // Max 48 points

  for (let i = numPoints - 1; i >= 0; i--) {
    const time = new Date(start);
    const hoursToAdd = (i / numPoints) * hoursDiff;
    time.setHours(time.getHours() + hoursToAdd);

    const hours = time.getHours();
    const minutes = time.getMinutes();
    const day = time.getDate();
    const month = time.getMonth() + 1;

    // Generate realistic sample data
    const baseValue = 50;
    const variation = Math.sin((i / numPoints) * Math.PI * 2) * 30;
    const randomNoise = (Math.random() - 0.5) * 10;
    const value = Math.max(0, Math.round(baseValue + variation + randomNoise));

    // Format time label based on date range
    let timeLabel: string;
    if (diffDays <= 1) {
      timeLabel = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
    } else if (diffDays <= 7) {
      timeLabel = `${month}/${day} ${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
    } else {
      timeLabel = `${month}/${day}`;
    }

    data.push({
      time: timeLabel,
      value,
    });
  }

  return data;
}

export function DashboardChartSection() {
  const [startDate, setStartDate] = React.useState<string>("");
  const [endDate, setEndDate] = React.useState<string>("");
  const [chartData, setChartData] = React.useState<DataPoint[]>([]);

  // Initialize with default dates (last 24 hours)
  React.useEffect(() => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const start = yesterday.toISOString().split("T")[0];
    const end = today.toISOString().split("T")[0];

    setStartDate(start);
    setEndDate(end);
    setChartData(generateDataForDateRange(start, end));
  }, []);

  const handleStartDateChange = (date: string) => {
    setStartDate(date);
    if (date && endDate) {
      setChartData(generateDataForDateRange(date, endDate));
    }
  };

  const handleEndDateChange = (date: string) => {
    setEndDate(date);
    if (date && startDate) {
      setChartData(generateDataForDateRange(startDate, date));
    }
  };

  const handlePresetSelect = (preset: string) => {
    // Data will be updated by the date change handlers
  };

  return (
    <div className="space-y-4">
      <DateFilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={handleStartDateChange}
        onEndDateChange={handleEndDateChange}
        onPresetSelect={handlePresetSelect}
      />
      <TimeSeriesChart
        data={chartData}
        title="Activity Over Time"
        description={
          startDate && endDate ?
            `Event activity from ${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`
          : "Event activity in the selected date range"
        }
      />
    </div>
  );
}
