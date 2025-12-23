"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getDateRangeForPreset, type DatePreset } from "@/lib/date-utils";

const datePresets: Array<{ label: string; value: DatePreset }> = [
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Last 90 days", value: "90d" },
  { label: "Custom", value: "custom" },
];

interface DatePresetSelectorProps {
  value: DatePreset;
  onValueChange: (preset: DatePreset) => void;
}

export function DatePresetSelector({
  value,
  onValueChange,
}: DatePresetSelectorProps) {
  const handleChange = (preset: DatePreset | null) => {
    if (!preset) return;
    onValueChange(preset);
  };

  return (
    <Select value={value} onValueChange={handleChange}>
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
  );
}

// Export helper function for use in parent components
export { getDateRangeForPreset };
