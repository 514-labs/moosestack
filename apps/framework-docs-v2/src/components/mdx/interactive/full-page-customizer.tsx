"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IconArrowRight } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface FullPageCustomizerProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  onContinue: () => void;
  canContinue?: boolean;
  className?: string;
}

/**
 * FullPageCustomizer - Full-page customization experience for tutorials
 *
 * Renders a centered card with customization options and a continue button.
 * Used when a user first visits a tutorial or clicks "Change settings".
 *
 * @example
 * ```tsx
 * <FullPageCustomizer
 *   title="Customize this tutorial"
 *   description="Select your environment to see relevant instructions"
 *   onContinue={() => setShowContent(true)}
 *   canContinue={allFieldsSet}
 * >
 *   <SelectField ... />
 *   <SelectField ... />
 * </FullPageCustomizer>
 * ```
 */
export function FullPageCustomizer({
  title = "Customize this tutorial",
  description = "Select your preferences to see relevant instructions",
  children,
  onContinue,
  canContinue = true,
  className,
}: FullPageCustomizerProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-background flex items-center justify-center py-12 overflow-auto",
        className,
      )}
    >
      <Card className="w-full max-w-2xl mx-4">
        <CardHeader>
          <CardTitle className="text-2xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-6">{children}</CardContent>
        <CardFooter>
          <Button
            onClick={onContinue}
            disabled={!canContinue}
            className="w-full sm:w-auto sm:ml-auto"
            size="lg"
          >
            Continue to tutorial
            <IconArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
