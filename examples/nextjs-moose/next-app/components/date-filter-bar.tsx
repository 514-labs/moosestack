"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarIcon, DownloadIcon } from "lucide-react";

interface DateFilterBarProps {
  startDate?: string;
  endDate?: string;
  onStartDateChange?: (date: string) => void;
  onEndDateChange?: (date: string) => void;
  onPresetSelect?: (preset: string) => void;
  onExportData?: () => void;
}

const datePresets = [
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Last 90 days", value: "90d" },
  { label: "Custom", value: "custom" },
];

export function DateFilterBar({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onPresetSelect,
  onExportData,
}: DateFilterBarProps) {
  const [selectedPreset, setSelectedPreset] = React.useState<string>("30d");
  const [customStartDate, setCustomStartDate] = React.useState<string>("");
  const [customEndDate, setCustomEndDate] = React.useState<string>("");

  // Set default dates to last 30 days
  React.useEffect(() => {
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const todayStr = today.toISOString().split("T")[0];
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

    if (!startDate) {
      onStartDateChange?.(thirtyDaysAgoStr);
    }
    if (!endDate) {
      onEndDateChange?.(todayStr);
    }
  }, []);

  const handlePresetChange = (preset: string) => {
    setSelectedPreset(preset);

    if (preset === "custom") {
      // Initialize custom dates with current values
      if (startDate) setCustomStartDate(startDate);
      if (endDate) setCustomEndDate(endDate);
      return;
    }

    const today = new Date();
    const endDateStr = today.toISOString().split("T")[0];
    let startDateStr = "";

    switch (preset) {
      case "24h":
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        startDateStr = yesterday.toISOString().split("T")[0];
        break;
      case "7d":
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        startDateStr = sevenDaysAgo.toISOString().split("T")[0];
        break;
      case "30d":
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        startDateStr = thirtyDaysAgo.toISOString().split("T")[0];
        break;
      case "90d":
        const ninetyDaysAgo = new Date(today);
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        startDateStr = ninetyDaysAgo.toISOString().split("T")[0];
        break;
    }

    if (startDateStr) {
      onStartDateChange?.(startDateStr);
      onEndDateChange?.(endDateStr);
      onPresetSelect?.(preset);
    }
  };

  const handleCustomStartDateChange = (date: string) => {
    setCustomStartDate(date);
    if (date) {
      onStartDateChange?.(date);
      const end =
        customEndDate || endDate || new Date().toISOString().split("T")[0];
      onEndDateChange?.(end);
      onPresetSelect?.("custom");
    }
  };

  const handleCustomEndDateChange = (date: string) => {
    setCustomEndDate(date);
    if (date) {
      onEndDateChange?.(date);
      const start =
        customStartDate || startDate || new Date().toISOString().split("T")[0];
      onStartDateChange?.(start);
      onPresetSelect?.("custom");
    }
  };

  const handleExport = () => {
    if (onExportData) {
      onExportData();
    } else {
      // Default export behavior - could download CSV or trigger API call
      console.log("Exporting data for range:", startDate, "to", endDate);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <CalendarIcon className="text-muted-foreground h-4 w-4" />
          <span className="text-sm font-medium">Date Range</span>
        </div>

        <Select value={selectedPreset} onValueChange={handlePresetChange}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {datePresets.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        {selectedPreset === "custom" && (
          <>
            <div className="flex items-center gap-2">
              <label
                htmlFor="start-date"
                className="text-muted-foreground text-sm"
              >
                From:
              </label>
              <Input
                id="start-date"
                type="date"
                value={customStartDate || startDate || ""}
                onChange={(e) => handleCustomStartDateChange(e.target.value)}
                className="w-[140px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <label
                htmlFor="end-date"
                className="text-muted-foreground text-sm"
              >
                To:
              </label>
              <Input
                id="end-date"
                type="date"
                value={customEndDate || endDate || ""}
                onChange={(e) => handleCustomEndDateChange(e.target.value)}
                className="w-[140px]"
              />
            </div>
          </>
        )}

        {selectedPreset !== "custom" && (
          <div className="text-muted-foreground text-sm">
            {startDate && endDate && (
              <>
                {new Date(startDate).toLocaleDateString()} -{" "}
                {new Date(endDate).toLocaleDateString()}
              </>
            )}
          </div>
        )}
      </div>

      <Button variant="outline" onClick={handleExport}>
        <DownloadIcon />
        Export Data
      </Button>
    </div>
  );
}
