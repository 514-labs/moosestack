"use client";

import { DateFilterBar } from "@/components/date-filter-bar";
import { useDateFilter } from "@/components/dashboard-date-context";

export function DashboardDateFilter() {
  const { startDate, endDate, chartData, setStartDate, setEndDate } =
    useDateFilter();

  const handlePresetSelect = () => {
    // Data will be updated by the date change handlers
  };

  const handleExportData = () => {
    // Convert chart data to CSV format
    const headers = ["Time", "Value"];
    const csvRows = [
      headers.join(","),
      ...chartData.map((point) => `"${point.time}","${point.value}"`),
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
  };

  return (
    <DateFilterBar
      startDate={startDate}
      endDate={endDate}
      onStartDateChange={setStartDate}
      onEndDateChange={setEndDate}
      onPresetSelect={handlePresetSelect}
      onExportData={handleExportData}
    />
  );
}
