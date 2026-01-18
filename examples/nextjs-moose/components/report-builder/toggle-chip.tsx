"use client";

import { cn } from "@/lib/utils";

export interface ToggleChipProps {
  label: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
  variant?: "dimension" | "metric";
}

export function ToggleChip({
  label,
  description,
  selected,
  onClick,
  variant = "dimension",
}: ToggleChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={description}
      className={cn(
        "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200",
        "border focus:outline-none focus:ring-2 focus:ring-offset-1",
        selected ?
          variant === "dimension" ?
            "bg-chart-3 text-white border-chart-3 shadow-md shadow-chart-3/25"
          : "bg-chart-1 text-white border-chart-1 shadow-md shadow-chart-1/25"
        : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground hover:border-muted-foreground/30",
      )}
    >
      {label}
    </button>
  );
}
