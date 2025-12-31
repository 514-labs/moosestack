"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DownloadIcon } from "lucide-react";
import type { TimeSeriesData } from "@/app/actions/events";
import { queryKeys } from "@/lib/hooks";

interface ExportButtonProps {
  startDate: string;
  endDate: string;
}

export function ExportButton({ startDate, endDate }: ExportButtonProps) {
  const queryClient = useQueryClient();

  const handleExport = () => {
    // Get time series data from query cache
    // Note: bucket is optional for export, so we don't include it
    const timeSeriesData = queryClient.getQueryData<TimeSeriesData>(
      queryKeys.eventsOverTime(startDate, endDate),
    );

    if (!timeSeriesData || timeSeriesData.length === 0) {
      console.warn("No data available to export");
      return;
    }

    // Convert chart data to CSV format
    const headers = ["Time", "Count"];
    const csvRows = [
      headers.join(","),
      ...timeSeriesData.map((point) => `"${point.time}","${point.count}"`),
    ];
    const csvContent = csvRows.join("\n");

    // Create blob and download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `dashboard-data-${startDate}-to-${endDate}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up the object URL
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="outline" onClick={handleExport}>
      <DownloadIcon />
      Export Data
    </Button>
  );
}
