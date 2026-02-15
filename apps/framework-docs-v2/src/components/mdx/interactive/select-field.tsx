"use client";

import { Suspense } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { usePersistedState, type PersistOptions } from "./use-persisted-state";

interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly chipLabel?: string;
}

interface SelectFieldProps {
  /** Unique ID for persistence. If provided with persist=true, value persists to localStorage */
  id?: string;
  /** Label displayed above the select */
  label: string;
  /** Available options to choose from */
  options: readonly SelectOption[];
  /** Default selected value */
  defaultValue?: string;
  /** Controlled value (overrides persisted state) */
  value?: string;
  /** Callback when selection changes */
  onChange?: (value: string) => void;
  /** Whether to persist selection to localStorage (can be boolean or PersistOptions) */
  persist?: boolean | PersistOptions;
  /** @deprecated Use persist={{ namespace: "global" }} instead */
  globalSetting?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Placeholder text when no selection */
  placeholder?: string;
}

function SelectFieldInner({
  id,
  label,
  options,
  defaultValue,
  value: controlledValue,
  onChange,
  persist = false,
  globalSetting = false,
  className,
  placeholder = "Select an option",
}: SelectFieldProps) {
  // Normalize persist options (handle legacy globalSetting prop)
  const persistOptions: boolean | PersistOptions =
    globalSetting ? { namespace: "global", syncToUrl: false } : persist;

  // Warn in development when deprecated prop is used
  if (process.env.NODE_ENV !== "production" && globalSetting) {
    console.warn(
      `SelectField: The 'globalSetting' prop is deprecated. Use persist={{ namespace: "global", syncToUrl: false }} instead.`,
    );
  }

  // Use unified persistence hook
  const [internalValue, setInternalValue] = usePersistedState<string>(
    id,
    defaultValue ?? options[0]?.value ?? "",
    persistOptions,
  );

  // Validate that the internal value exists in options (in case options changed)
  const validOptionValues = options.map((o) => o.value);
  const isValidInternalValue = validOptionValues.includes(internalValue);
  const validatedInternalValue =
    isValidInternalValue ? internalValue : (
      (defaultValue ?? options[0]?.value ?? "")
    );

  // Use controlled value if provided, otherwise use validated internal state
  const currentValue = controlledValue ?? validatedInternalValue;

  const handleChange = (newValue: string) => {
    if (controlledValue === undefined) {
      setInternalValue(newValue);
    }
    onChange?.(newValue);
  };

  const fieldId = id || `select-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={fieldId} className="text-sm font-medium text-foreground">
        {label}
      </Label>
      <Select value={currentValue} onValueChange={handleChange}>
        <SelectTrigger id={fieldId} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * SelectField - A labeled dropdown select component for interactive guides.
 *
 * Features:
 * - Optional localStorage persistence
 * - Controlled or uncontrolled modes
 * - Built on shadcn/ui Select
 *
 * @example
 * ```tsx
 * <SelectField
 *   id="language"
 *   label="Language"
 *   options={[
 *     { value: "typescript", label: "TypeScript" },
 *     { value: "python", label: "Python" }
 *   ]}
 *   defaultValue="typescript"
 *   persist
 * />
 * ```
 */
export function SelectField(props: SelectFieldProps) {
  // Wrap in Suspense to handle hydration safely
  return (
    <Suspense
      fallback={
        <div className={cn("flex flex-col gap-2", props.className)}>
          <Label className="text-sm font-medium text-foreground">
            {props.label}
          </Label>
          <div className="h-9 w-full rounded-md border border-input bg-card" />
        </div>
      }
    >
      <SelectFieldInner {...props} />
    </Suspense>
  );
}
