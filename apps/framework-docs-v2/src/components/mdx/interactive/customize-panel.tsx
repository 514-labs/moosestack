"use client";

import { ReactNode } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CustomizePanelProps {
  /** Panel title (default: "Customize") */
  title?: string;
  /** Panel description text */
  description?: string;
  /** Panel contents (SelectFields, CheckboxGroups, etc.) */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * CustomizePanel - A styled container for guide customization options.
 *
 * Matches the Figma "Customize" panel design with a dark background.
 * Use this as a wrapper for SelectField and CheckboxGroup components.
 *
 * @example
 * ```tsx
 * <CustomizePanel
 *   title="Customize"
 *   description="Select options to customize this guide."
 * >
 *   <CustomizeGrid columns={2}>
 *     <SelectField label="Language" options={[...]} />
 *     <SelectField label="Framework" options={[...]} />
 *   </CustomizeGrid>
 * </CustomizePanel>
 * ```
 */
export function CustomizePanel({
  title = "Customize",
  description,
  children,
  className,
}: CustomizePanelProps) {
  return (
    <Card
      className={cn(
        "my-6 bg-muted/50 dark:bg-zinc-900/50 border-border/50",
        className,
      )}
    >
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        {description && (
          <CardDescription className="text-muted-foreground">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">{children}</CardContent>
    </Card>
  );
}
