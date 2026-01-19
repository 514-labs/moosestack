/**
 * Shared types for input components.
 */

/** Date preset options for quick date range selection */
export type DatePreset = "24h" | "7d" | "30d" | "90d" | "custom";

/** Date range with start and end dates (YYYY-MM-DD format) */
export interface DateRange {
  start: string;
  end: string;
}

/** Preset configuration with label and value */
export interface PresetOption<T extends string = string> {
  label: string;
  value: T;
}

/** Field option for multi-select components */
export interface FieldOption<TId extends string = string> {
  id: TId;
  label: string;
  description?: string;
  /** Optional data key if different from id (e.g., snake_case vs camelCase) */
  dataKey?: string;
}

/**
 * Get date range for a preset.
 */
export function getDateRangeForPreset(preset: DatePreset): DateRange {
  const today = new Date();
  const end = today.toISOString().split("T")[0];

  const start = new Date(today);
  const days =
    preset === "24h" ? 1
    : preset === "7d" ? 7
    : preset === "30d" ? 30
    : 90;
  start.setDate(start.getDate() - days);

  return {
    start: start.toISOString().split("T")[0],
    end,
  };
}

/**
 * Get default date range (last 30 days).
 */
export function getDefaultDateRange(): DateRange {
  return getDateRangeForPreset("30d");
}

/** Default date presets */
export const DEFAULT_DATE_PRESETS: PresetOption<DatePreset>[] = [
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Last 90 days", value: "90d" },
  { label: "Custom", value: "custom" },
];
