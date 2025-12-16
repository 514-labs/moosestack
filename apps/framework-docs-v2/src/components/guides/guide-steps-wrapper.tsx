import { Suspense } from "react";
import { GuideStepsNav } from "./guide-steps-nav";
import { StepContent } from "./step-content";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface GuideStepsWrapperProps {
  steps: Array<{
    slug: string;
    stepNumber: number;
    title: string;
  }>;
  stepsWithContent: Array<{
    slug: string;
    stepNumber: number;
    title: string;
    content: string | null;
    isMDX: boolean;
  }>;
  currentSlug: string;
}

async function StepContentWrapper({
  content,
  isMDX,
  slug,
  index,
}: {
  content: string;
  isMDX: boolean;
  slug: string;
  index: number;
}) {
  return (
    <div
      key={slug}
      data-step-index={index}
      className={`step-content ${index === 0 ? "block" : "hidden"}`}
    >
      <StepContent content={content} isMDX={isMDX} />
    </div>
  );
}

export function GuideStepsWrapper({
  steps,
  stepsWithContent,
  currentSlug,
}: GuideStepsWrapperProps) {
  // Render all step content with Suspense for async MDX rendering
  const renderedSteps = stepsWithContent.map((step, index) => {
    if (!step.content) return null;
    return (
      <Suspense
        key={step.slug}
        fallback={
          <div
            data-step-index={index}
            className={`step-content ${index === 0 ? "block" : "hidden"}`}
          >
            <div className="text-muted-foreground">Loading step content...</div>
          </div>
        }
      >
        <StepContentWrapper
          content={step.content}
          isMDX={step.isMDX}
          slug={step.slug}
          index={index}
        />
      </Suspense>
    );
  });

  return (
    <div id="guide-steps" className="mt-12 w-full">
      <GuideStepsNav steps={steps} currentSlug={currentSlug} />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="step-card-badge">
                {steps[0]?.stepNumber || 1}
              </Badge>
              <CardTitle className="step-card-title">
                {steps[0]?.title || "Step 1"}
              </CardTitle>
            </div>
            <div id="step-nav-buttons-container" className="flex gap-2"></div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="step-content-container">{renderedSteps}</div>
        </CardContent>
      </Card>
    </div>
  );
}
