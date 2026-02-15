"use client";

import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { Badge } from "@/components/ui/badge";
import {
  GUIDE_TYPE_PROP,
  VERTICAL_PROGRESS_STEP_ITEM_MARKER,
} from "@/lib/remark-guide-stepper-markers";
import { cn } from "@/lib/utils";
import { MARKDOWN_CONTENT_CLASS } from "./markdown-content-class";

// ---------------------------------------------------------------------------
// Discriminant tag & type guard
// ---------------------------------------------------------------------------

export type ProgressStepsVariant = "numbered" | "bulleted";

const VERTICAL_PROGRESS_STEP_ITEM_TYPE = "vertical-progress-step-item";

function getProgressStepsVariant(value?: string): ProgressStepsVariant {
  return value === "bulleted" ? "bulleted" : "numbered";
}

function isVerticalProgressStepItemElement(
  node: ReactNode,
): node is ReactElement<VerticalProgressStepItemProps> {
  if (!isValidElement(node)) return false;
  // Prefer compile-time marker injected by remark plugin (survives MDX proxying)
  const props = node.props as Record<string, unknown>;
  if (props?.[GUIDE_TYPE_PROP] === VERTICAL_PROGRESS_STEP_ITEM_MARKER)
    return true;
  // Fallback: direct _type check (works outside MDX)
  const componentType = node.type as unknown as Record<string, unknown>;
  return componentType?._type === VERTICAL_PROGRESS_STEP_ITEM_TYPE;
}

// ---------------------------------------------------------------------------
// Public prop types
// ---------------------------------------------------------------------------

export interface VerticalProgressStepsProps {
  variant?: ProgressStepsVariant;
  className?: string;
  children: ReactNode;
}

export interface VerticalProgressStepItemProps {
  id?: string;
  title: string;
  __guideType?: string;
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

// Parent reads `id` and `title` from each item's element props while this
// component only renders the body content.
function VerticalProgressStepItemComponent({
  children,
}: VerticalProgressStepItemProps) {
  return <>{children}</>;
}
VerticalProgressStepItemComponent._type = VERTICAL_PROGRESS_STEP_ITEM_TYPE;

function VerticalProgressStepsRoot({
  variant = "numbered",
  className,
  children,
}: VerticalProgressStepsProps) {
  const resolvedVariant = getProgressStepsVariant(variant);
  const ListTag = resolvedVariant === "bulleted" ? "ul" : "ol";
  const items = Children.toArray(children).filter(
    isVerticalProgressStepItemElement,
  ) as ReactElement<VerticalProgressStepItemProps>[];

  if (items.length === 0) {
    return null;
  }

  return (
    <div className={cn("w-full", className)}>
      <ListTag className="list-none space-y-5 p-0">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const itemKey = item.props.id ?? `${index}-${item.props.title}`;

          return (
            <li key={itemKey} id={item.props.id} className="relative pl-11">
              {!isLast && (
                <span
                  aria-hidden
                  className="absolute left-[15px] top-7 h-[calc(100%-0.25rem)] w-px bg-border"
                />
              )}
              <span className="absolute left-0 top-0 inline-flex h-7 w-7 items-center justify-center">
                {resolvedVariant === "numbered" ?
                  <Badge
                    variant="secondary"
                    className="h-7 w-7 justify-center rounded-full p-0 text-xs font-semibold"
                  >
                    {index + 1}
                  </Badge>
                : <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
                }
              </span>

              <div className="w-full min-w-0 space-y-2">
                <p className="font-medium text-sm leading-relaxed">
                  {item.props.title}
                </p>
                <div
                  className={cn(
                    "w-full min-w-0 space-y-3 text-sm text-muted-foreground",
                    MARKDOWN_CONTENT_CLASS,
                  )}
                >
                  {item.props.children}
                </div>
              </div>
            </li>
          );
        })}
      </ListTag>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const VerticalProgressSteps = Object.assign(VerticalProgressStepsRoot, {
  Item: VerticalProgressStepItemComponent,
});

export { VerticalProgressStepItemComponent as VerticalProgressStepItem };
