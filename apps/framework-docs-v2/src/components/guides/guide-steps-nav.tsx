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
}

export function GuideStepsNav({
  steps,
  currentSlug,
  children,
}: GuideStepsNavProps) {
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

  // Update URL hash and show/hide steps when step changes
  React.useEffect(() => {
    if (steps.length > 0 && currentStepIndex < steps.length) {
      const currentStep = steps[currentStepIndex];
      if (currentStep) {
        const hasPrevious = currentStepIndex > 0;
        const hasNext = currentStepIndex < steps.length - 1;

        // Update URL hash
        window.history.replaceState(
          null,
          "",
          `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}#step-${currentStep.stepNumber}`,
        );

        // Show/hide step content
        const stepContents = document.querySelectorAll(".step-content");
        stepContents.forEach((content, index) => {
          if (index === currentStepIndex) {
            content.classList.remove("hidden");
            content.classList.add("block");
          } else {
            content.classList.add("hidden");
            content.classList.remove("block");
          }
        });

        // Update card header with current step info
        const cardTitle = document.querySelector(".step-card-title");
        const cardBadge = document.querySelector(".step-card-badge");
        const buttonsContainer = document.getElementById(
          "step-nav-buttons-container",
        );
        if (cardTitle) cardTitle.textContent = currentStep.title;
        if (cardBadge)
          cardBadge.textContent = currentStep.stepNumber.toString();

        // Update navigation buttons
        if (buttonsContainer) {
          buttonsContainer.innerHTML = `
            <button
              class="step-nav-prev inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              ${hasPrevious ? "" : "disabled"}
              onclick="window.__goToStep(${currentStepIndex - 1})"
            >
              <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              Previous
            </button>
            <button
              class="step-nav-next inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              ${hasNext ? "" : "disabled"}
              onclick="window.__goToStep(${currentStepIndex + 1})"
            >
              Next
              <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </button>
          `;
        }
      }
    }
  }, [currentStepIndex, steps, pathname, searchParams]);

  if (steps.length === 0) return null;

  const currentStep = steps[currentStepIndex];
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

  // Expose goToStep to window for button onclick handlers
  React.useEffect(() => {
    (window as any).__goToStep = goToStep;
    return () => {
      delete (window as any).__goToStep;
    };
  }, [goToStep]);

  const buildUrl = (stepSlug: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", language);
    return `/${stepSlug}?${params.toString()}`;
  };

  return (
    <>
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
    </>
  );
}
