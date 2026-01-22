"use client";

import { type ReactNode, useState, useCallback } from "react";
import { GuideStepsNav } from "./guide-steps-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface GuideStepsWrapperProps {
  steps: Array<{
    slug: string;
    stepNumber: number;
    title: string;
  }>;
  /** Pre-rendered step content as React nodes, keyed by step slug */
  renderedSteps: Array<{
    slug: string;
    content: ReactNode;
  }>;
  currentSlug: string;
}

export function GuideStepsWrapper({
  steps,
  renderedSteps,
  currentSlug,
}: GuideStepsWrapperProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const handleStepChange = useCallback((index: number) => {
    setCurrentStepIndex(index);
  }, []);

  const currentStep = steps[currentStepIndex];

  return (
    <div id="guide-steps" className="mt-12 w-full">
      <GuideStepsNav
        steps={steps}
        currentSlug={currentSlug}
        onStepChange={handleStepChange}
      />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge variant="secondary">{currentStep?.stepNumber || 1}</Badge>
              <CardTitle>{currentStep?.title || "Step 1"}</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="step-content-container">
            {renderedSteps.map((step, index) => (
              <div
                key={step.slug}
                data-step-index={index}
                className={index === currentStepIndex ? "block" : "hidden"}
              >
                <div className="prose prose-slate dark:prose-invert max-w-none w-full min-w-0">
                  {step.content}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
