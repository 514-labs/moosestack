"use client";

import { type ReactNode, useState, useCallback, useEffect } from "react";
import { GuideStepsNav } from "./guide-steps-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface StepInfo {
  slug: string;
  stepNumber: number;
  title: string;
}

interface LazyStepContentProps {
  steps: StepInfo[];
  /** First step content is pre-rendered for instant display */
  firstStepContent: ReactNode;
  /** All pre-rendered step contents keyed by slug (for static guides) */
  preRenderedSteps?: Array<{ slug: string; content: ReactNode }>;
  currentSlug: string;
}

/**
 * LazyStepContent - Optimized step content display with lazy loading
 *
 * For static guides: First step is pre-rendered, others loaded on demand via API
 * For dynamic guides: Steps loaded on demand
 */
export function LazyStepContent({
  steps,
  firstStepContent,
  preRenderedSteps,
  currentSlug,
}: LazyStepContentProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [loadedSteps, setLoadedSteps] = useState<Map<number, ReactNode>>(
    () => new Map([[0, firstStepContent]]),
  );
  const [isLoading, setIsLoading] = useState(false);

  // If we have pre-rendered steps, load them all into state on mount
  useEffect(() => {
    if (preRenderedSteps && preRenderedSteps.length > 0) {
      const stepMap = new Map<number, ReactNode>();
      preRenderedSteps.forEach((step, index) => {
        stepMap.set(index, step.content);
      });
      setLoadedSteps(stepMap);
    }
  }, [preRenderedSteps]);

  const handleStepChange = useCallback(
    async (index: number) => {
      setCurrentStepIndex(index);

      // If we already have the content, don't reload
      if (loadedSteps.has(index)) {
        return;
      }

      // Get the step info for the requested index
      const step = steps[index];
      if (!step) return;

      // Fetch step content from API
      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/guide-step?slug=${encodeURIComponent(step.slug)}`,
        );
        if (!response.ok) {
          throw new Error("Failed to fetch step content");
        }
        const data = await response.json();

        // Create content from HTML
        const content = (
          <div
            className="prose prose-slate dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: data.html }}
          />
        );

        setLoadedSteps((prev) => new Map(prev).set(index, content));
      } catch (error) {
        console.error("Failed to load step:", error);
        setLoadedSteps((prev) =>
          new Map(prev).set(
            index,
            <div className="text-red-500">Failed to load step content</div>,
          ),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [loadedSteps, steps],
  );

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
            {isLoading ?
              <StepSkeleton />
            : <div className="prose prose-slate dark:prose-invert max-w-none w-full min-w-0">
                {loadedSteps.get(currentStepIndex) || <StepSkeleton />}
              </div>
            }
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StepSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
