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
import { cn } from "@/lib/utils";
import { usePersistedState } from "./use-persisted-state";
import { VerticalProgressSteps } from "./vertical-progress-steps";

// ---------------------------------------------------------------------------
// Discriminant tags & type guards
// ---------------------------------------------------------------------------

/**
 * Discriminant tags attached as static `_type` properties on GuideStepper
 * child component functions. Type guards below check this field instead of
 * duck-typing props, which avoids false positives and removes the dependency
 * on preprocessor-injected props like `rawContent`.
 */
const GUIDE_STEPPER_STEP_TYPE = "guide-stepper-step";
const GUIDE_STEPPER_CHECKPOINT_TYPE = "guide-stepper-checkpoint";
const GUIDE_STEPPER_AT_A_GLANCE_TYPE = "guide-stepper-at-a-glance";

function hasComponentType(node: ReactElement, type: string): boolean {
  const componentType = node.type as unknown as Record<string, unknown>;
  return componentType?._type === type;
}

function isGuideStepperStepElement(
  node: ReactNode,
): node is ReactElement<GuideStepperStepProps> {
  if (!isValidElement(node)) return false;
  return hasComponentType(node, GUIDE_STEPPER_STEP_TYPE);
}

function isGuideStepperCheckpointElement(
  node: ReactNode,
): node is ReactElement<GuideStepperCheckpointProps> {
  if (!isValidElement(node)) return false;
  return hasComponentType(node, GUIDE_STEPPER_CHECKPOINT_TYPE);
}

function isGuideStepperAtAGlanceElement(
  node: ReactNode,
): node is ReactElement<GuideStepperAtAGlanceProps> {
  if (!isValidElement(node)) return false;
  return hasComponentType(node, GUIDE_STEPPER_AT_A_GLANCE_TYPE);
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

function buildGuideStepPromptMarkdown(checkpointRawContents: string[]): string {
  const segments = checkpointRawContents
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return segments.join("\n\n");
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
  children: ReactNode;
}

export interface GuideStepperCheckpointProps {
  id: string;
  title: string;
  rawContent?: string;
  children: ReactNode;
}

export interface GuideStepperPromptProps {
  rawContent?: string;
  children: ReactNode;
}
export interface GuideStepperAtAGlanceProps extends GuideStepperPromptProps {
  title?: string;
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
GuideStepperCheckpointComponent._type = GUIDE_STEPPER_CHECKPOINT_TYPE;

function GuideStepperPromptComponent({ children }: GuideStepperPromptProps) {
  return <div className="space-y-3 text-sm">{children}</div>;
}

function GuideStepperAtAGlanceComponent({
  title = "Checkpoints At A Glance",
  children,
}: GuideStepperAtAGlanceProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="text-sm text-muted-foreground [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1">
        {children}
      </div>
    </div>
  );
}
GuideStepperAtAGlanceComponent._type = GUIDE_STEPPER_AT_A_GLANCE_TYPE;

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

  const childNodes = Children.toArray(children);
  const checkpoints = childNodes.filter(
    isGuideStepperCheckpointElement,
  ) as ReactElement<GuideStepperCheckpointProps>[];
  const atAGlanceBlocks = childNodes.filter(
    isGuideStepperAtAGlanceElement,
  ) as ReactElement<GuideStepperAtAGlanceProps>[];
  const checkpointTitles = checkpoints.map(
    (checkpoint) => checkpoint.props.title,
  );
  const bodyChildren = childNodes.filter(
    (child) =>
      !isGuideStepperCheckpointElement(child) &&
      !isGuideStepperAtAGlanceElement(child),
  );
  const promptToCopy = buildGuideStepPromptMarkdown(
    checkpoints.map((checkpoint) => checkpoint.props.rawContent ?? ""),
  );
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

    if (!promptToCopy.trim()) return;

    try {
      await navigator.clipboard.writeText(promptToCopy);
      setCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy checkpoints prompt:", error);
    }
  }, [promptToCopy]);

  return (
    <AccordionItem
      value={id}
      className="border border-border rounded-lg px-4 bg-card mb-3"
    >
      <AccordionTrigger className="hover:no-underline py-4">
        <div className="flex w-full items-start gap-3 pr-2">
          <Checkbox
            checked={isComplete}
            onCheckedChange={(checked) =>
              toggleStepComplete(id, checked === true)
            }
            onClick={(event) => event.stopPropagation()}
            aria-label={`Mark ${title} complete`}
            className="mt-1"
          />
          <div className="min-w-0 flex-1 text-left">
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
        </div>
      </AccordionTrigger>

      <AccordionContent className="pt-1 pb-4 space-y-4">
        {checkpointTitles.length > 0 && (
          <Card className="bg-muted/40 border-border/60">
            <CardContent className="px-4 py-3">
              {atAGlanceBlocks.length > 0 ?
                <div className="space-y-3">{atAGlanceBlocks}</div>
              : <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Checkpoints At A Glance
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                    {checkpointTitles.map((checkpointTitle) => (
                      <li key={checkpointTitle}>{checkpointTitle}</li>
                    ))}
                  </ul>
                </div>
              }
            </CardContent>
          </Card>
        )}

        {bodyChildren.length > 0 && (
          <div className="space-y-3">{bodyChildren}</div>
        )}

        {checkpoints.length > 0 && (
          <Card className="border-border/60">
            <CardContent className="px-4 py-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Checkpoints
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={handleCopyPrompt}
                  disabled={!promptToCopy.trim()}
                >
                  {copied ?
                    <IconCheck className="h-3.5 w-3.5" />
                  : <IconCopy className="h-3.5 w-3.5" />}
                  {copied ? "Copied!" : "Copy Prompt"}
                </Button>
              </div>
              <VerticalProgressSteps variant={checkpointVariant}>
                {checkpoints.map((checkpoint) => (
                  <VerticalProgressSteps.Item
                    key={checkpoint.props.id}
                    id={checkpoint.props.id}
                    title={checkpoint.props.title}
                  >
                    {checkpoint.props.children}
                  </VerticalProgressSteps.Item>
                ))}
              </VerticalProgressSteps>
            </CardContent>
          </Card>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
GuideStepperStepComponent._type = GUIDE_STEPPER_STEP_TYPE;

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
  AtAGlance: GuideStepperAtAGlanceComponent,
  Prompt: GuideStepperPromptComponent,
});

export { GuideStepperStepComponent as GuideStepperStep };
export { GuideStepperCheckpointComponent as GuideStepperCheckpoint };
export { GuideStepperAtAGlanceComponent as GuideStepperAtAGlance };
export { GuideStepperPromptComponent as GuideStepperPrompt };
