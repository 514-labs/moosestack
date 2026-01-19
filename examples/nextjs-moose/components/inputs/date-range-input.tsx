"use client";

import * as React from "react";
import { Calendar } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "./date-picker";
import {
  type DatePreset,
  type DateRange,
  type PresetOption,
  DEFAULT_DATE_PRESETS,
  getDateRangeForPreset,
} from "./types";

export interface DateRangeInputProps {
  /** Current start date (YYYY-MM-DD format) */
  startDate: string;
  /** Current end date (YYYY-MM-DD format) */
  endDate: string;
  /** Called when date range changes */
  onChange: (range: DateRange) => void;
  /** Show preset selector (default: true) */
  showPresets?: boolean;
  /** Custom presets (defaults to standard presets) */
  presets?: PresetOption<DatePreset>[];
  /** Label for preset selector */
  presetLabel?: string;
  /** Label for start date */
  startLabel?: React.ReactNode;
  /** Label for end date */
  endLabel?: React.ReactNode;
  /** Show icons in labels (default: true) */
  showIcons?: boolean;
  /** Disable inputs */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Width for date inputs */
  inputWidth?: string;
}

export function DateRangeInput({
  startDate,
  endDate,
  onChange,
  showPresets = true,
  presets = DEFAULT_DATE_PRESETS,
  presetLabel = "Range",
  startLabel = "From",
  endLabel = "To",
  showIcons = true,
  disabled = false,
  className,
  inputWidth = "w-[160px]",
}: DateRangeInputProps) {
  const [selectedPreset, setSelectedPreset] =
    React.useState<DatePreset>("custom");

  // Detect if current range matches a preset
  React.useEffect(() => {
    for (const preset of presets) {
      if (preset.value === "custom") continue;
      const range = getDateRangeForPreset(preset.value);
      if (range.start === startDate && range.end === endDate) {
        setSelectedPreset(preset.value);
        return;
      }
    }
    setSelectedPreset("custom");
  }, [startDate, endDate, presets]);

  const handlePresetChange = (preset: DatePreset) => {
    setSelectedPreset(preset);

    if (preset === "custom") {
      // Stay in custom mode, don't change dates
      return;
    }

    const range = getDateRangeForPreset(preset);
    onChange(range);
  };

  const handleStartChange = (date: string) => {
    setSelectedPreset("custom");
    onChange({ start: date, end: endDate });
  };

  const handleEndChange = (date: string) => {
    setSelectedPreset("custom");
    onChange({ start: startDate, end: date });
  };

  const startLabelWithIcon =
    showIcons ?
      <span className="flex items-center gap-1.5">
        <Calendar className="size-3" />
        {startLabel}
      </span>
    : startLabel;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-end gap-2">
        {showPresets && (
          <div>
            <label className="text-muted-foreground text-xs font-medium mb-1 block">
              {presetLabel}
            </label>
            <Select
              value={selectedPreset}
              onValueChange={handlePresetChange}
              disabled={disabled}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {presets.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}

        <DatePicker
          id="date-range-start"
          label={startLabelWithIcon}
          value={startDate}
          onChange={handleStartChange}
          placeholder="Start date"
          className={inputWidth}
          disabled={disabled}
        />

        <DatePicker
          id="date-range-end"
          label={endLabel}
          value={endDate}
          onChange={handleEndChange}
          placeholder="End date"
          className={inputWidth}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
