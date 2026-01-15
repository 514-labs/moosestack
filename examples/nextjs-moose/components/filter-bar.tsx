"use client";

import * as React from "react";
import { type DatePreset, getDateRangeForPreset } from "@/lib/date-utils";
import { useDateFilter } from "@/lib/hooks";
import { DatePickerInput } from "@/components/date-picker-input";
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

  const handleStartDateChange = (date: string) => {
    setStartDate(date);
    setSelectedPreset("custom");
  };

  const handleEndDateChange = (date: string) => {
    setEndDate(date);
    setSelectedPreset("custom");
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
      <DatePresetSelector
        value={selectedPreset}
        onValueChange={handlePresetChange}
        label="Filter Date:"
      />
      <div className="flex items-end gap-2">
        <DatePickerInput
          id="start-date"
          label="From:"
          value={startDate}
          onChange={handleStartDateChange}
          placeholder="Select start date"
          className="w-[180px]"
        />
        <DatePickerInput
          id="end-date"
          label="To:"
          value={endDate}
          onChange={handleEndDateChange}
          placeholder="Select end date"
          className="w-[180px]"
        />
      </div>
    </div>
  );
}
