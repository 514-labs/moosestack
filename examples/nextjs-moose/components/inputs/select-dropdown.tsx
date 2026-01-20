"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { FieldOption } from "./types";

export interface SelectDropdownProps<TId extends string> {
  /** Available options */
  options: readonly FieldOption<TId>[];
  /** Currently selected value */
  value: TId | undefined;
  /** Called when selection changes */
  onChange: (value: TId) => void;
  /** Label displayed above the select */
  label?: React.ReactNode;
  /** Placeholder text when no value selected */
  placeholder?: string;
  /** Disable the select */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Width of the select trigger */
  width?: string;
}

/**
 * Single-select dropdown for choosing from a list of options.
 * Great for "group by" or single-choice selections.
 */
export function SelectDropdown<TId extends string>({
  options,
  value,
  onChange,
  label,
  placeholder = "Select...",
  disabled = false,
  className,
  width = "w-[180px]",
}: SelectDropdownProps<TId>) {
  const selectId = React.useId();

  // Find the selected option to display its label
  const selectedOption = options.find((opt) => opt.id === value);

  return (
    <div className={className}>
      {label && (
        <Label
          htmlFor={selectId}
          className="text-muted-foreground text-xs font-medium mb-1 block"
        >
          {label}
        </Label>
      )}
      <Select
        value={value}
        onValueChange={(newValue) => {
          if (newValue !== null) {
            onChange(newValue as TId);
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger id={selectId} className={width}>
          <SelectValue>
            {selectedOption ? selectedOption.label : placeholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
