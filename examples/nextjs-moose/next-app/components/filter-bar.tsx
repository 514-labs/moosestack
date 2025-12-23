"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { type DatePreset, getDateRangeForPreset } from "@/lib/date-utils";
import { useDateFilter } from "@/lib/hooks";
import { ExportButton } from "@/components/export-button";
import { DateRangePicker } from "@/components/date-range-picker";
import { DatePresetSelector } from "@/components/date-preset-selector";

export function FilterBar() {
  const { startDate, endDate, setStartDate, setEndDate } = useDateFilter();
  const [selectedPreset, setSelectedPreset] = React.useState<DatePreset>("30d");

  const handlePresetChange = (preset: DatePreset) => {
    setSelectedPreset(preset);

    if (preset === "custom") {
      // Stay in custom mode, don't change dates
      return;
    }

    const { start, end } = getDateRangeForPreset(preset);
    setStartDate(start);
    setEndDate(end);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <CalendarIcon className="text-muted-foreground h-4 w-4" />
          <span className="text-sm font-medium">Date Range</span>
        </div>

        <DatePresetSelector
          value={selectedPreset}
          onValueChange={handlePresetChange}
        />

        {selectedPreset === "custom" ?
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
        : <div className="text-muted-foreground text-sm">
            {new Date(startDate).toLocaleDateString()} -{" "}
            {new Date(endDate).toLocaleDateString()}
          </div>
        }
      </div>

      <ExportButton startDate={startDate} endDate={endDate} />
    </div>
  );
}
