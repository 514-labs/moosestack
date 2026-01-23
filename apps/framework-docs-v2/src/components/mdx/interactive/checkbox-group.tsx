"use client";

import { Suspense, createContext, useContext, ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { usePersistedState } from "./use-persisted-state";

interface CheckboxOption {
  value: string;
  label: string;
  defaultChecked?: boolean;
}

interface CheckboxGroupProps {
  /** Unique ID for persistence and referencing from other components */
  id?: string;
  /** Label displayed above the checkbox group */
  label: string;
  /** Available checkbox options */
  options: CheckboxOption[];
  /** Whether to persist selections to localStorage */
  persist?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Optional conditional content that shows based on selections */
  children?: ReactNode;
  /** Callback when selections change */
  onChange?: (checkedValues: string[]) => void;
}

// Context to share checkbox state with child components
interface CheckboxGroupContextValue {
  checkedValues: string[];
  groupId: string;
}

const CheckboxGroupContext = createContext<CheckboxGroupContextValue | null>(
  null,
);

/**
 * Hook to access checkbox group state from child components.
 * Returns the array of currently checked values.
 */
export function useCheckboxGroup(): CheckboxGroupContextValue | null {
  return useContext(CheckboxGroupContext);
}

function CheckboxGroupInner({
  id,
  label,
  options,
  persist = false,
  className,
  children,
  onChange,
}: CheckboxGroupProps) {
  // Initialize with default checked values
  const defaultChecked = options
    .filter((opt) => opt.defaultChecked)
    .map((opt) => opt.value);

  const [checkedValues, setCheckedValues] = usePersistedState<string[]>(
    id,
    defaultChecked,
    persist,
  );

  const handleCheckChange = (optionValue: string, checked: boolean) => {
    const newValues =
      checked ?
        [...checkedValues, optionValue]
      : checkedValues.filter((v) => v !== optionValue);

    setCheckedValues(newValues);
    onChange?.(newValues);
  };

  const groupId = id || `checkbox-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <CheckboxGroupContext.Provider value={{ checkedValues, groupId }}>
      <div className={cn("flex flex-col gap-3", className)}>
        <Label className="text-sm font-medium text-foreground">{label}</Label>
        <div className="flex flex-col gap-2">
          {options.map((option) => {
            const checkboxId = `${groupId}-${option.value}`;
            const isChecked = checkedValues.includes(option.value);

            return (
              <div key={option.value} className="flex items-center gap-2">
                <Checkbox
                  id={checkboxId}
                  checked={isChecked}
                  onCheckedChange={(checked) =>
                    handleCheckChange(option.value, checked === true)
                  }
                />
                <Label
                  htmlFor={checkboxId}
                  className="text-sm font-normal cursor-pointer"
                >
                  {option.label}
                </Label>
              </div>
            );
          })}
        </div>
        {children}
      </div>
    </CheckboxGroupContext.Provider>
  );
}

/**
 * Content that shows/hides based on checkbox selections.
 * Use inside a CheckboxGroup.
 */
function CheckboxGroupContent({
  whenChecked,
  children,
}: {
  /** Value(s) that must be checked for this content to show */
  whenChecked: string | string[];
  children: ReactNode;
}) {
  const context = useContext(CheckboxGroupContext);

  if (!context) {
    console.warn(
      "CheckboxGroup.Content must be used within a CheckboxGroup component",
    );
    return null;
  }

  const { checkedValues } = context;
  const requiredValues =
    Array.isArray(whenChecked) ? whenChecked : [whenChecked];

  // Show content if ANY of the required values are checked
  const isVisible = requiredValues.some((v) => checkedValues.includes(v));

  if (!isVisible) return null;

  return <>{children}</>;
}

/**
 * CheckboxGroup - A group of checkboxes with optional conditional content.
 *
 * Features:
 * - Optional localStorage persistence
 * - Context-based state sharing for conditional content
 * - Built on shadcn/ui Checkbox
 *
 * @example
 * ```tsx
 * <CheckboxGroup
 *   id="features"
 *   label="Features to Enable"
 *   options={[
 *     { value: "analytics", label: "Analytics", defaultChecked: true },
 *     { value: "auth", label: "Authentication" }
 *   ]}
 *   persist
 * >
 *   <CheckboxGroup.Content whenChecked="analytics">
 *     Analytics-specific content here...
 *   </CheckboxGroup.Content>
 * </CheckboxGroup>
 * ```
 */
function CheckboxGroupRoot(props: CheckboxGroupProps) {
  // Wrap in Suspense to handle hydration safely
  return (
    <Suspense
      fallback={
        <div className={cn("flex flex-col gap-3", props.className)}>
          <Label className="text-sm font-medium text-foreground">
            {props.label}
          </Label>
          <div className="flex flex-col gap-2">
            {props.options.map((option) => (
              <div key={option.value} className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-sm border border-primary" />
                <span className="text-sm">{option.label}</span>
              </div>
            ))}
          </div>
        </div>
      }
    >
      <CheckboxGroupInner {...props} />
    </Suspense>
  );
}

// Compose with sub-components using Object.assign pattern
export const CheckboxGroup = Object.assign(CheckboxGroupRoot, {
  Content: CheckboxGroupContent,
});

// Export sub-component separately for MDX renderer registration
export { CheckboxGroupContent };

export type { CheckboxGroupProps, CheckboxOption };
