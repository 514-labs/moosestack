"use client";

import {
  Children,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  GUIDE_STEPPER_CHECKPOINT_MARKER,
  GUIDE_STEPPER_STEP_MARKER,
  GUIDE_STEPPER_PROMPT_MARKER,
  GUIDE_STEPPER_WHAT_YOU_GET_MARKER,
  GUIDE_STEPPER_WHAT_YOU_NEED_MARKER,
  GUIDE_TYPE_PROP,
} from "@/lib/remark-guide-stepper-markers";
import { parseGuideStepperStepChildren } from "@/lib/guide-stepper-step-children-parser";
import { cn } from "@/lib/utils";
import { ConditionalContent } from "./conditional-content";
import { MARKDOWN_CONTENT_CLASS } from "./markdown-content-class";
import { usePersistedState } from "./use-persisted-state";
import { VerticalProgressSteps } from "./vertical-progress-steps";

// ---------------------------------------------------------------------------
// Discriminant tags & type guards
// ---------------------------------------------------------------------------

/**
 * Discriminant tags attached as static `_type` properties on GuideStepper
 * child component functions.
 *
 * MDX + RSC/client-reference pipelines can proxy/wrap `node.type`, so runtime
 * checks based only on function identity are brittle. We therefore prefer
 * compile-time marker props injected by a remark plugin.
 */
function hasGuideTypeMarker(node: ReactElement, marker: string): boolean {
  const props = node.props as Record<string, unknown>;
  return props?.[GUIDE_TYPE_PROP] === marker;
}

function isGuideStepperStepElement(
  node: ReactNode,
): node is ReactElement<GuideStepperStepProps> {
  if (!isValidElement(node)) return false;
  if (hasGuideTypeMarker(node, GUIDE_STEPPER_STEP_MARKER)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function sanitizeStepIds(ids: string[], validStepIds: string[]): string[] {
  const validIds = new Set(validStepIds);
  const uniqueOrdered: string[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    if (!validIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    uniqueOrdered.push(id);
  }

  return uniqueOrdered;
}

function sanitizeCompletedStepIds(
  completedStepIds: string[],
  validStepIds: string[],
): string[] {
  return sanitizeStepIds(completedStepIds, validStepIds);
}

function getSanitizedOpenStepIds(
  openStepIds: string[],
  validStepIds: string[],
): string[] {
  return sanitizeStepIds(openStepIds, validStepIds);
}

function getOpenStepIdsAfterCompletionToggle(
  openStepIds: string[],
  { stepId, checked }: { stepId: string; checked: boolean },
): string[] {
  if (!checked) return openStepIds;
  return openStepIds.filter((openStepId) => openStepId !== stepId);
}

function calculateProgress(stepIds: string[], completedStepIds: string[]) {
  const safeCompleted = sanitizeCompletedStepIds(completedStepIds, stepIds);
  const total = stepIds.length;
  const completed = safeCompleted.length;

  if (total === 0) {
    return { completed: 0, total: 0, percentage: 0 };
  }

  return {
    completed,
    total,
    percentage: Math.round((completed / total) * 100),
  };
}

function getDefaultExpandedValues({
  stepIds,
  completedStepIds,
  defaultExpanded,
}: {
  stepIds: string[];
  completedStepIds: string[];
  defaultExpanded?: string[];
}): string[] {
  if (defaultExpanded && defaultExpanded.length > 0) {
    const validDefaults = defaultExpanded.filter((id) => stepIds.includes(id));
    if (validDefaults.length > 0) {
      return validDefaults;
    }
  }

  if (stepIds.length === 0) {
    return [];
  }

  const safeCompleted = new Set(
    sanitizeCompletedStepIds(completedStepIds, stepIds),
  );
  const firstIncomplete = stepIds.find((id) => !safeCompleted.has(id));

  return [firstIncomplete || stepIds[0]!];
}

function hasSameItems(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

// ---------------------------------------------------------------------------
// Public prop types
// ---------------------------------------------------------------------------

export interface GuideStepperProps {
  id?: string;
  persist?: boolean;
  defaultExpanded?: string[];
  className?: string;
  children: ReactNode;
}

export interface GuideStepperStepProps {
  id: string;
  number: number;
  title: string;
  summary?: string;
  checkpointVariant?: "numbered" | "bulleted";
  __guideType?: typeof GUIDE_STEPPER_STEP_MARKER;
  children: ReactNode;
}

export interface GuideStepperCheckpointProps {
  id: string;
  title: string;
  rawContent?: string;
  __guideType?: typeof GUIDE_STEPPER_CHECKPOINT_MARKER;
  children: ReactNode;
}

export interface GuideStepperPromptProps {
  rawContent?: string;
  __guideType?: typeof GUIDE_STEPPER_PROMPT_MARKER;
  children: ReactNode;
}
export interface GuideStepperWhatYouNeedProps {
  children: ReactNode;
  __guideType?: typeof GUIDE_STEPPER_WHAT_YOU_NEED_MARKER;
}

export interface GuideStepperWhatYouGetProps {
  children: ReactNode;
  __guideType?: typeof GUIDE_STEPPER_WHAT_YOU_GET_MARKER;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface GuideStepperContextValue {
  completedStepIds: Set<string>;
  toggleStepComplete: (stepId: string, checked: boolean) => void;
}

const GuideStepperContext = createContext<GuideStepperContextValue | null>(
  null,
);

function useGuideStepperContext(): GuideStepperContextValue {
  const context = useContext(GuideStepperContext);
  if (!context) {
    throw new Error("GuideStepper.Step must be used within GuideStepper");
  }
  return context;
}

// ---------------------------------------------------------------------------
// Child components
// ---------------------------------------------------------------------------

function GuideStepperCheckpointComponent({
  id: _id,
  title,
  children,
}: GuideStepperCheckpointProps) {
  return (
    <div>
      <p className="font-medium text-sm mb-2">{title}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function GuideStepperPromptComponent({ children }: GuideStepperPromptProps) {
  // Hidden on-page by design. Prompt text is consumed via rawContent for copy.
  return <div className="hidden">{children}</div>;
}

function GuideStepperWhatYouNeedComponent({
  children,
}: GuideStepperWhatYouNeedProps) {
  return <>{children}</>;
}

function GuideStepperWhatYouGetComponent({
  children,
}: GuideStepperWhatYouGetProps) {
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Step component
// ---------------------------------------------------------------------------

function GuideStepperStepComponent({
  id,
  number,
  title,
  summary,
  checkpointVariant = "numbered",
  children,
}: GuideStepperStepProps) {
  const { completedStepIds, toggleStepComplete } = useGuideStepperContext();
  const isComplete = completedStepIds.has(id);

  const {
    checkpoints,
    whatYouNeedBlocks,
    whatYouGetBlocks,
    bodyChildren,
    promptToCopy,
  } = useMemo(() => parseGuideStepperStepChildren(children), [children]);
  const hasPromptToCopy = promptToCopy.trim().length > 0;
  const hasWhatYouNeedSnapshot = whatYouNeedBlocks.length > 0;
  const hasWhatYouGetSnapshot = whatYouGetBlocks.length > 0;
  const hasStepSnapshot = hasWhatYouNeedSnapshot || hasWhatYouGetSnapshot;
  const hasStepContent =
    bodyChildren.length > 0 || checkpoints.length > 0 || hasStepSnapshot;
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopyPrompt = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }

    if (!hasPromptToCopy) return;

    try {
      await navigator.clipboard.writeText(promptToCopy);
      setCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy step prompt:", error);
    }
  }, [hasPromptToCopy, promptToCopy]);

  return (
    <AccordionItem
      value={id}
      className="border border-border rounded-lg px-4 bg-card mb-3"
    >
      <div className="relative">
        <div className="absolute left-0 top-4 z-10 h-6 flex items-center">
          <Checkbox
            checked={isComplete}
            onCheckedChange={(checked) =>
              toggleStepComplete(id, checked === true)
            }
            onClick={(event) => event.stopPropagation()}
            aria-label={`Mark ${title} complete`}
          />
        </div>
        <AccordionTrigger className="hover:no-underline py-4 pl-7">
          <div className="min-w-0 flex-1 text-left pr-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={isComplete ? "default" : "secondary"}
                className="h-6 min-w-6 justify-center rounded-full px-2"
              >
                {number}
              </Badge>
              <span className="font-semibold text-base leading-tight">
                {title}
              </span>
              {isComplete && (
                <Badge
                  variant="outline"
                  className="text-xs border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                >
                  Complete
                </Badge>
              )}
            </div>
            {summary && (
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {summary}
              </p>
            )}
          </div>
        </AccordionTrigger>
      </div>

      <AccordionContent className="pt-1 pb-4">
        {hasStepContent && (
          <Card className="space-y-4 bg-background/80 p-4">
            <CardContent className="px-4">
              {hasStepSnapshot ?
                <div className="space-y-4 pb-4">
                  {hasWhatYouNeedSnapshot && (
                    <section>
                      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        What you need
                      </p>
                      <div
                        className={cn(
                          "mt-2 text-sm",
                          MARKDOWN_CONTENT_CLASS,
                          "[&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
                        )}
                      >
                        {whatYouNeedBlocks}
                      </div>
                    </section>
                  )}

                  {hasWhatYouNeedSnapshot && hasWhatYouGetSnapshot && (
                    <div className="h-px bg-border/60" aria-hidden="true" />
                  )}

                  {hasWhatYouGetSnapshot && (
                    <section>
                      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        What you get
                      </p>
                      <div
                        className={cn(
                          "mt-2 text-sm",
                          MARKDOWN_CONTENT_CLASS,
                          "[&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
                        )}
                      >
                        {whatYouGetBlocks}
                      </div>
                    </section>
                  )}
                </div>
              : null}
              {bodyChildren.length > 0 && (
                <div className={cn("space-y-3 px-4", MARKDOWN_CONTENT_CLASS)}>
                  {bodyChildren}
                </div>
              )}

              {checkpoints.length > 0 && (
                <section className="border-t border-border/60 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      Workflow
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 gap-1.5 px-2.5 text-xs transition-colors hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2"
                      onClick={handleCopyPrompt}
                      disabled={!hasPromptToCopy}
                    >
                      {copied ?
                        <IconCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      : <IconCopy className="h-3.5 w-3.5" aria-hidden="true" />}
                      <span aria-live="polite">
                        {copied ? "Copied!" : "Copy AI Prompt"}
                      </span>
                    </Button>
                  </div>
                  <div className="mt-3">
                    <VerticalProgressSteps variant={checkpointVariant}>
                      {checkpoints.map(({ checkpoint, visibility }, index) => {
                        const checkpointKey = `${checkpoint.props.id}-${index}`;

                        if (!visibility) {
                          return (
                            <VerticalProgressSteps.Item
                              key={checkpointKey}
                              id={checkpoint.props.id}
                              title={checkpoint.props.title}
                            >
                              {checkpoint.props.children}
                            </VerticalProgressSteps.Item>
                          );
                        }

                        return (
                          <ConditionalContent
                            key={checkpointKey}
                            whenId={visibility.whenId}
                            whenValue={visibility.whenValue}
                            match={visibility.match}
                            fallback={visibility.fallback}
                          >
                            <VerticalProgressSteps.Item
                              id={checkpoint.props.id}
                              title={checkpoint.props.title}
                            >
                              {checkpoint.props.children}
                            </VerticalProgressSteps.Item>
                          </ConditionalContent>
                        );
                      })}
                    </VerticalProgressSteps>
                  </div>
                </section>
              )}
            </CardContent>
          </Card>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

function GuideStepperInner({
  id,
  persist = false,
  defaultExpanded,
  className,
  children,
}: GuideStepperProps) {
  const steps = useMemo(
    () =>
      Children.toArray(children).filter(
        isGuideStepperStepElement,
      ) as ReactElement<GuideStepperStepProps>[],
    [children],
  );
  const stepIds = useMemo(() => steps.map((step) => step.props.id), [steps]);

  const [storedCompletedStepIds, setStoredCompletedStepIds] = usePersistedState<
    string[]
  >(id ? `${id}-completed` : undefined, [], persist && Boolean(id));

  const completedStepIds = useMemo(
    () => sanitizeCompletedStepIds(storedCompletedStepIds, stepIds),
    [storedCompletedStepIds, stepIds],
  );
  const defaultExpandedValues = useMemo(
    () =>
      getDefaultExpandedValues({
        stepIds,
        completedStepIds,
        defaultExpanded,
      }),
    [completedStepIds, defaultExpanded, stepIds],
  );
  const [openStepIds, setOpenStepIds] = useState<string[]>(
    defaultExpandedValues,
  );

  useEffect(() => {
    if (completedStepIds.length !== storedCompletedStepIds.length) {
      setStoredCompletedStepIds(completedStepIds);
    }
  }, [
    completedStepIds,
    setStoredCompletedStepIds,
    storedCompletedStepIds.length,
  ]);

  useEffect(() => {
    setOpenStepIds((prev) => {
      const sanitized = getSanitizedOpenStepIds(prev, stepIds);
      return hasSameItems(prev, sanitized) ? prev : sanitized;
    });
  }, [stepIds]);

  const progress = useMemo(
    () => calculateProgress(stepIds, completedStepIds),
    [stepIds, completedStepIds],
  );

  const toggleStepComplete = useCallback(
    (stepId: string, checked: boolean) => {
      setStoredCompletedStepIds((prev) => {
        const next = sanitizeCompletedStepIds(prev, stepIds);
        if (checked) {
          return next.includes(stepId) ? next : [...next, stepId];
        }
        return next.filter((idValue) => idValue !== stepId);
      });

      setOpenStepIds((prev) =>
        getOpenStepIdsAfterCompletionToggle(prev, { stepId, checked }),
      );
    },
    [setStoredCompletedStepIds, stepIds],
  );

  const contextValue = useMemo<GuideStepperContextValue>(
    () => ({
      completedStepIds: new Set(completedStepIds),
      toggleStepComplete,
    }),
    [completedStepIds, toggleStepComplete],
  );

  if (steps.length === 0) {
    return null;
  }

  return (
    <GuideStepperContext.Provider value={contextValue}>
      <div className={cn("my-6 space-y-4", className)}>
        <Card className="border-border bg-muted/20">
          <CardContent className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Step Progress</p>
              <p className="text-xs text-muted-foreground">
                {progress.completed} of {progress.total} complete
              </p>
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Accordion
          type="multiple"
          value={openStepIds}
          onValueChange={(nextOpenStepIds) =>
            setOpenStepIds((prev) => {
              const sanitized = getSanitizedOpenStepIds(
                nextOpenStepIds,
                stepIds,
              );
              return hasSameItems(prev, sanitized) ? prev : sanitized;
            })
          }
        >
          {steps}
        </Accordion>
      </div>
    </GuideStepperContext.Provider>
  );
}

function GuideStepperRoot(props: GuideStepperProps) {
  return (
    <Suspense
      fallback={
        <div className={cn("my-6 space-y-3", props.className)}>
          <div className="h-14 rounded-lg border bg-muted/20" />
          <div className="h-16 rounded-lg border" />
          <div className="h-16 rounded-lg border" />
        </div>
      }
    >
      <GuideStepperInner {...props} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const GuideStepper = Object.assign(GuideStepperRoot, {
  Step: GuideStepperStepComponent,
  Checkpoint: GuideStepperCheckpointComponent,
  WhatYouNeed: GuideStepperWhatYouNeedComponent,
  WhatYouGet: GuideStepperWhatYouGetComponent,
  Prompt: GuideStepperPromptComponent,
});

export { GuideStepperStepComponent as GuideStepperStep };
export { GuideStepperCheckpointComponent as GuideStepperCheckpoint };
export { GuideStepperWhatYouNeedComponent as GuideStepperWhatYouNeed };
export { GuideStepperWhatYouGetComponent as GuideStepperWhatYouGet };
export { GuideStepperPromptComponent as GuideStepperPrompt };
