"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/hooks/use-language";

interface Step {
  slug: string;
  stepNumber: number;
  title: string;
}

interface GuideStepsNavProps {
  steps: Step[];
  currentSlug: string;
  children?: React.ReactNode;
  // Callback to update step visibility in parent
  onStepChange?: (stepIndex: number) => void;
}

// Context for sharing step state with wrapper
interface StepContextValue {
  currentStepIndex: number;
  setCurrentStepIndex: (index: number) => void;
  steps: Step[];
}

export const StepContext = React.createContext<StepContextValue | null>(null);

export function useStepContext() {
  return React.useContext(StepContext);
}

export function GuideStepsNav({
  steps,
  currentSlug,
  children,
  onStepChange,
}: GuideStepsNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { language } = useLanguage();
  const [currentStepIndex, setCurrentStepIndex] = React.useState(0);
  const isInitialMount = React.useRef(true);

  // Determine current step from URL hash on mount only
  React.useEffect(() => {
    if (typeof window === "undefined") return;

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

  // Update URL hash when step changes (but not on initial mount)
  React.useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (steps.length > 0 && currentStepIndex < steps.length) {
      const currentStep = steps[currentStepIndex];
      if (currentStep) {
        // Update URL hash without triggering navigation
        const searchString = searchParams?.toString();
        const url = `${pathname}${searchString ? `?${searchString}` : ""}#step-${currentStep.stepNumber}`;
        window.history.replaceState(null, "", url);
      }
    }
  }, [currentStepIndex, steps, pathname, searchParams]);

  // Notify parent of step changes for visibility updates
  React.useEffect(() => {
    onStepChange?.(currentStepIndex);
  }, [currentStepIndex, onStepChange]);

  const goToStep = React.useCallback(
    (index: number) => {
      if (index >= 0 && index < steps.length) {
        setCurrentStepIndex(index);
        // Scroll to top of steps section
        requestAnimationFrame(() => {
          const element = document.getElementById("guide-steps");
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      }
    },
    [steps.length],
  );

  // Pre-compute URL base once
  const urlBase = React.useMemo(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("lang", language);
    return `?${params.toString()}`;
  }, [searchParams, language]);

  const buildUrl = React.useCallback(
    (stepSlug: string) => `/${stepSlug}${urlBase}`,
    [urlBase],
  );

  if (steps.length === 0) return null;

  const currentStep = steps[currentStepIndex];
  const hasPrevious = currentStepIndex > 0;
  const hasNext = currentStepIndex < steps.length - 1;

  const contextValue = React.useMemo(
    () => ({ currentStepIndex, setCurrentStepIndex, steps }),
    [currentStepIndex, steps],
  );

  return (
    <StepContext.Provider value={contextValue}>
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

      {children}

      {/* Navigation buttons - rendered in React instead of innerHTML */}
      <div className="flex gap-2 mt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => goToStep(currentStepIndex - 1)}
          disabled={!hasPrevious}
          className="gap-2"
        >
          <IconChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => goToStep(currentStepIndex + 1)}
          disabled={!hasNext}
          className="gap-2"
        >
          Next
          <IconChevronRight className="h-4 w-4" />
        </Button>
      </div>

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
    </StepContext.Provider>
  );
}
