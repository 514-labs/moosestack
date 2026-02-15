import {
  Children,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { buildGuideStepPromptMarkdown } from "./guide-stepper-prompt-builder";
import {
  GUIDE_STEPPER_CHECKPOINT_MARKER,
  GUIDE_STEPPER_PROMPT_MARKER,
  GUIDE_STEPPER_WHAT_YOU_GET_MARKER,
  GUIDE_STEPPER_WHAT_YOU_NEED_MARKER,
  GUIDE_TYPE_PROP,
} from "./remark-guide-stepper-markers";

export interface GuideStepperCheckpointNodeProps {
  id: string;
  title: string;
  children: ReactNode;
  rawContent?: string;
}

export interface GuideStepperWhatYouNeedNodeProps {
  children: ReactNode;
}

export interface GuideStepperWhatYouGetNodeProps {
  children: ReactNode;
}

export interface GuideStepperPromptNodeProps {
  children: ReactNode;
  rawContent?: string;
}

export interface ParsedGuideStepperCheckpoint {
  checkpoint: ReactElement<GuideStepperCheckpointNodeProps>;
  visibility?: GuideStepperConditionalVisibility;
}

export interface ParsedGuideStepperStepChildren {
  checkpoints: ParsedGuideStepperCheckpoint[];
  whatYouNeedBlocks: ReactElement<GuideStepperWhatYouNeedNodeProps>[];
  whatYouGetBlocks: ReactElement<GuideStepperWhatYouGetNodeProps>[];
  bodyChildren: ReactNode[];
  promptToCopy: string;
}

export interface GuideStepperConditionalVisibility {
  whenId: string;
  whenValue: string | string[];
  match?: "equals" | "includes";
  fallback?: ReactNode;
}

function hasGuideTypeMarker(node: ReactElement, marker: string): boolean {
  const props = node.props as Record<string, unknown>;
  return props?.[GUIDE_TYPE_PROP] === marker;
}

function isGuideStepperCheckpointElement(
  node: ReactNode,
): node is ReactElement<GuideStepperCheckpointNodeProps> {
  if (!isValidElement(node)) return false;
  return hasGuideTypeMarker(node, GUIDE_STEPPER_CHECKPOINT_MARKER);
}

function isGuideStepperWhatYouNeedElement(
  node: ReactNode,
): node is ReactElement<GuideStepperWhatYouNeedNodeProps> {
  if (!isValidElement(node)) return false;
  return hasGuideTypeMarker(node, GUIDE_STEPPER_WHAT_YOU_NEED_MARKER);
}

function isGuideStepperWhatYouGetElement(
  node: ReactNode,
): node is ReactElement<GuideStepperWhatYouGetNodeProps> {
  if (!isValidElement(node)) return false;
  return hasGuideTypeMarker(node, GUIDE_STEPPER_WHAT_YOU_GET_MARKER);
}

function isGuideStepperPromptElement(
  node: ReactNode,
): node is ReactElement<GuideStepperPromptNodeProps> {
  if (!isValidElement(node)) return false;
  return hasGuideTypeMarker(node, GUIDE_STEPPER_PROMPT_MARKER);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isWhitespaceTextNode(node: ReactNode): boolean {
  return typeof node === "string" && node.trim().length === 0;
}

function flattenChildren(children: ReactNode): ReactNode[] {
  const flattened: ReactNode[] = [];

  for (const child of Children.toArray(children)) {
    if (isValidElement(child) && child.type === Fragment) {
      const props = child.props as { children?: ReactNode };
      flattened.push(...flattenChildren(props.children));
      continue;
    }

    flattened.push(child);
  }

  return flattened;
}

function getConditionalVisibilityRule(
  node: ReactNode,
): GuideStepperConditionalVisibility | null {
  if (!isValidElement(node)) return null;

  const props = node.props as {
    whenId?: unknown;
    whenValue?: unknown;
    match?: unknown;
    fallback?: ReactNode;
  };

  if (typeof props.whenId !== "string") return null;
  if (typeof props.whenValue !== "string" && !isStringArray(props.whenValue)) {
    return null;
  }
  if (
    props.match !== undefined &&
    props.match !== "equals" &&
    props.match !== "includes"
  ) {
    return null;
  }

  return {
    whenId: props.whenId,
    whenValue: props.whenValue,
    match: props.match,
    fallback: props.fallback,
  };
}

export function parseGuideStepperStepChildren(
  children: ReactNode,
): ParsedGuideStepperStepChildren {
  const checkpoints: ParsedGuideStepperCheckpoint[] = [];
  const whatYouNeedBlocks: ReactElement<GuideStepperWhatYouNeedNodeProps>[] =
    [];
  const whatYouGetBlocks: ReactElement<GuideStepperWhatYouGetNodeProps>[] = [];
  const bodyChildren: ReactNode[] = [];
  const promptRawContents: string[] = [];

  for (const child of Children.toArray(children)) {
    if (isGuideStepperCheckpointElement(child)) {
      checkpoints.push({ checkpoint: child });
      continue;
    }

    if (isGuideStepperWhatYouNeedElement(child)) {
      whatYouNeedBlocks.push(child);
      continue;
    }

    if (isGuideStepperWhatYouGetElement(child)) {
      whatYouGetBlocks.push(child);
      continue;
    }

    if (isGuideStepperPromptElement(child)) {
      promptRawContents.push(child.props.rawContent ?? "");
      continue;
    }

    const visibilityRule = getConditionalVisibilityRule(child);
    if (visibilityRule && isValidElement(child)) {
      const nestedChildren = flattenChildren(
        (child.props as { children?: ReactNode }).children,
      ).filter((nestedChild) => !isWhitespaceTextNode(nestedChild));
      const nestedCheckpoints = nestedChildren.filter(
        isGuideStepperCheckpointElement,
      );

      if (
        nestedChildren.length > 0 &&
        nestedCheckpoints.length === nestedChildren.length
      ) {
        checkpoints.push(
          ...nestedCheckpoints.map((checkpoint) => ({
            checkpoint,
            visibility: visibilityRule,
          })),
        );
        continue;
      }
    }

    bodyChildren.push(child);
  }

  return {
    checkpoints,
    whatYouNeedBlocks,
    whatYouGetBlocks,
    bodyChildren,
    promptToCopy: buildGuideStepPromptMarkdown({
      promptRawContents,
      checkpoints: checkpoints.map(({ checkpoint }) => ({
        title: checkpoint.props.title,
        rawContent: checkpoint.props.rawContent,
      })),
    }),
  };
}
