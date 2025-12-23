"use client";

import { DatePickerInput } from "@/components/date-picker-input";

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
}

export function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: DateRangePickerProps) {
  return (
    <>
      <DatePickerInput
        id="start-date"
        label="From:"
        value={startDate}
        onChange={onStartDateChange}
        placeholder="Select start date"
        className="w-[140px]"
      />
      <DatePickerInput
        id="end-date"
        label="To:"
        value={endDate}
        onChange={onEndDateChange}
        placeholder="Select end date"
        className="w-[140px]"
      />
    </>
  );
}
