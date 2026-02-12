"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconArrowRight } from "@tabler/icons-react";

interface FullPageCustomizerProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  onContinue: () => void;
  canContinue?: boolean;
  onClose?: () => void;
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
  onClose,
}: FullPageCustomizerProps): React.JSX.Element {
  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open && onClose) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-6 py-4">{children}</div>
        <DialogFooter>
          <Button
            onClick={onContinue}
            disabled={!canContinue}
            className="w-full sm:w-auto"
            size="lg"
          >
            Continue to tutorial
            <IconArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
