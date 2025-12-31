export type DatePreset = "24h" | "7d" | "30d" | "90d" | "custom";

export interface DateRange {
  start: string;
  end: string;
}

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

export function getDefaultDateRange(): DateRange {
  return getDateRangeForPreset("30d");
}
