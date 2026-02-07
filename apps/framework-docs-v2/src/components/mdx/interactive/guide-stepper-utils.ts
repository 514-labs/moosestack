import { type ReactNode, type ReactElement, isValidElement } from "react";

interface DefaultExpandedInput {
  stepIds: string[];
  completedStepIds: string[];
  defaultExpanded?: string[];
}

interface CompletionToggleInput {
  stepId: string;
  checked: boolean;
}

interface GuideStepLikeProps {
  id?: unknown;
  number?: unknown;
  title?: unknown;
}

interface GuideCheckpointLikeProps {
  id?: unknown;
  title?: unknown;
  number?: unknown;
  rawContent?: unknown;
}

interface GuideAtAGlanceLikeProps {
  rawContent?: unknown;
  id?: unknown;
  title?: unknown;
  number?: unknown;
}

interface BuildGuideStepPromptInput {
  checkpointRawContents: string[];
}

export function sanitizeCompletedStepIds(
  completedStepIds: string[],
  validStepIds: string[],
): string[] {
  return sanitizeStepIds(completedStepIds, validStepIds);
}

export function getSanitizedOpenStepIds(
  openStepIds: string[],
  validStepIds: string[],
): string[] {
  return sanitizeStepIds(openStepIds, validStepIds);
}

export function sanitizeStepIds(
  ids: string[],
  validStepIds: string[],
): string[] {
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

export function getOpenStepIdsAfterCompletionToggle(
  openStepIds: string[],
  { stepId, checked }: CompletionToggleInput,
): string[] {
  if (!checked) return openStepIds;
  return openStepIds.filter((openStepId) => openStepId !== stepId);
}

export function buildGuideStepPromptMarkdown({
  checkpointRawContents,
}: BuildGuideStepPromptInput): string {
  const segments = checkpointRawContents
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return segments.join("\n\n");
}

export function calculateProgress(
  stepIds: string[],
  completedStepIds: string[],
) {
  const safeCompleted = sanitizeCompletedStepIds(completedStepIds, stepIds);
  const total = stepIds.length;
  const completed = safeCompleted.length;

  if (total === 0) {
    return {
      completed: 0,
      total: 0,
      percentage: 0,
    };
  }

  return {
    completed,
    total,
    percentage: Math.round((completed / total) * 100),
  };
}

export function getDefaultExpandedValues({
  stepIds,
  completedStepIds,
  defaultExpanded,
}: DefaultExpandedInput): string[] {
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

export function isGuideStepperStepElement(
  node: ReactNode,
): node is ReactElement<GuideStepLikeProps> {
  if (!isValidElement(node)) return false;
  const props = node.props as GuideStepLikeProps;
  return (
    typeof props.id === "string" &&
    typeof props.number === "number" &&
    typeof props.title === "string"
  );
}

export function isGuideStepperCheckpointElement(
  node: ReactNode,
): node is ReactElement<GuideCheckpointLikeProps> {
  if (!isValidElement(node)) return false;
  const props = node.props as GuideCheckpointLikeProps;
  // Checkpoints do not define `number`; steps do. Keep this invariant unless we
  // add an explicit discriminant prop across GuideStepper child components.
  return (
    typeof props.id === "string" &&
    typeof props.title === "string" &&
    typeof props.number === "undefined"
  );
}

export function isGuideStepperAtAGlanceElement(
  node: ReactNode,
): node is ReactElement<GuideAtAGlanceLikeProps> {
  if (!isValidElement(node)) return false;
  const props = node.props as GuideAtAGlanceLikeProps;
  return (
    typeof props.rawContent === "string" &&
    typeof props.id === "undefined" &&
    (typeof props.title === "undefined" || typeof props.title === "string") &&
    typeof props.number === "undefined"
  );
}
