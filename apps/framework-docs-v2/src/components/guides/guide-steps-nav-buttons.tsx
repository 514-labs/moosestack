"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

interface GuideStepsNavButtonsProps {
  currentStepIndex: number;
  totalSteps: number;
  onPrevious: () => void;
  onNext: () => void;
}

export function GuideStepsNavButtons({
  currentStepIndex,
  totalSteps,
  onPrevious,
  onNext,
}: GuideStepsNavButtonsProps) {
  const hasPrevious = currentStepIndex > 0;
  const hasNext = currentStepIndex < totalSteps - 1;

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onPrevious}
        disabled={!hasPrevious}
        className="step-nav-prev"
      >
        <IconChevronLeft className="h-4 w-4" />
        Previous
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={!hasNext}
        className="step-nav-next"
      >
        Next
        <IconChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
