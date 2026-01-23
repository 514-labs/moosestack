import React, { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CustomizeGridProps {
  /** Grid contents (SelectFields, CheckboxGroups) */
  children: ReactNode;
  /** Number of columns (default: 2) */
  columns?: 2 | 3 | 4;
  /** Additional CSS classes */
  className?: string;
}

const columnClasses = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
} as const;

/**
 * CustomizeGrid - A responsive grid layout for CustomizePanel contents.
 *
 * Use inside CustomizePanel to arrange SelectFields and CheckboxGroups
 * in a responsive grid layout.
 *
 * @example
 * ```tsx
 * <CustomizePanel>
 *   <CustomizeGrid columns={2}>
 *     <SelectField label="Start Point" options={[...]} />
 *     <SelectField label="Language" options={[...]} />
 *   </CustomizeGrid>
 *   <CustomizeGrid columns={2}>
 *     <CheckboxGroup label="Sources" options={[...]} />
 *     <CheckboxGroup label="Steps Completed" options={[...]} />
 *   </CustomizeGrid>
 * </CustomizePanel>
 * ```
 */
export function CustomizeGrid({
  children,
  columns = 2,
  className,
}: CustomizeGridProps): React.JSX.Element {
  return (
    <div className={cn("grid gap-4", columnClasses[columns], className)}>
      {children}
    </div>
  );
}
