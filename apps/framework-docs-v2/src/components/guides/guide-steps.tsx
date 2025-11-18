"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";

interface Step {
  slug: string;
  stepNumber: number;
  title: string;
}

interface GuideStepsProps {
  steps: Step[];
  renderedSteps: React.ReactElement[];
  currentSlug: string;
}

export function GuideSteps({
  steps,
  renderedSteps,
  currentSlug,
}: GuideStepsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { language } = useLanguage();
  const [currentStepIndex, setCurrentStepIndex] = React.useState(0);

  // Determine current step from URL hash or default to first step
  React.useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const stepMatch = hash.match(/step-(\d+)/);
      if (stepMatch) {
        const stepNum = parseInt(stepMatch[1]!, 10);
        const index = steps.findIndex((s) => s.stepNumber === stepNum);
        if (index >= 0) {
          setCurrentStepIndex(index);
        }
      }
    }
  }, [steps]);

  // Update URL hash when step changes
  React.useEffect(() => {
    if (steps.length > 0 && currentStepIndex < steps.length) {
      const currentStep = steps[currentStepIndex];
      if (currentStep) {
        window.history.replaceState(
          null,
          "",
          `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}#step-${currentStep.stepNumber}`,
        );
      }
    }
  }, [currentStepIndex, steps, pathname, searchParams]);

  if (steps.length === 0) return null;

  const currentStep = steps[currentStepIndex];
  if (!currentStep) return null;

  const currentRenderedStep = renderedSteps[currentStepIndex];
  const hasPrevious = currentStepIndex > 0;
  const hasNext = currentStepIndex < steps.length - 1;

  const goToStep = (index: number) => {
    if (index >= 0 && index < steps.length) {
      setCurrentStepIndex(index);
      // Scroll to top of steps section
      const element = document.getElementById("guide-steps");
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  };

  const buildUrl = (stepSlug: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", language);
    return `/${stepSlug}?${params.toString()}`;
  };

  return (
    <div id="guide-steps" className="mt-12 w-full">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Implementation Steps</h2>
        <div className="flex gap-2">
          {steps.map((step, index) => (
            <Button
              key={step.slug}
              variant={index === currentStepIndex ? "default" : "outline"}
              size="sm"
              onClick={() => goToStep(index)}
              className="h-8 w-8 p-0"
            >
              {step.stepNumber}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge variant="secondary">{currentStep.stepNumber}</Badge>
              <CardTitle>{currentStep.title}</CardTitle>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToStep(currentStepIndex - 1)}
                disabled={!hasPrevious}
              >
                <IconChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToStep(currentStepIndex + 1)}
                disabled={!hasNext}
              >
                Next
                <IconChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="step-content-wrapper">
            {renderedSteps.map((stepContent, index) => (
              <div
                key={steps[index]?.slug}
                style={{
                  display: index === currentStepIndex ? "block" : "none",
                }}
              >
                {stepContent || (
                  <div className="text-muted-foreground">
                    Step content not available
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Step list for navigation */}
      <div className="mt-6 space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">All Steps</h3>
        <div className="space-y-1">
          {steps.map((step, index) => (
            <Link
              key={step.slug}
              href={buildUrl(step.slug)}
              onClick={(e) => {
                e.preventDefault();
                goToStep(index);
              }}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                index === currentStepIndex ?
                  "bg-accent text-accent-foreground"
                : "hover:bg-accent/50"
              }`}
            >
              <Badge variant="outline" className="h-5 min-w-5 px-1">
                {step.stepNumber}
              </Badge>
              <span>{step.title}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
