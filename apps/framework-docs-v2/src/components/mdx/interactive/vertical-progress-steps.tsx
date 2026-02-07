"use client";

import { Children, type ReactElement, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type ProgressStepsVariant,
  getProgressStepsVariant,
  isVerticalProgressStepItemElement,
} from "./vertical-progress-steps-utils";

export interface VerticalProgressStepsProps {
  variant?: ProgressStepsVariant;
  className?: string;
  children: ReactNode;
}

export interface VerticalProgressStepItemProps {
  id?: string;
  title: string;
  children: ReactNode;
}

function VerticalProgressStepItemComponent({
  children,
}: VerticalProgressStepItemProps) {
  return <>{children}</>;
}

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
      <ListTag className="list-none space-y-4 p-0">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const itemKey = item.props.id ?? `${index}-${item.props.title}`;

          return (
            <li key={itemKey} id={item.props.id} className="relative pl-10">
              {!isLast && (
                <span
                  aria-hidden
                  className="absolute left-[13px] top-7 h-[calc(100%-0.5rem)] w-px bg-border"
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

              <div className="space-y-2">
                <p className="font-medium text-sm leading-relaxed">
                  {item.props.title}
                </p>
                <div className="space-y-3 text-sm">{item.props.children}</div>
              </div>
            </li>
          );
        })}
      </ListTag>
    </div>
  );
}

export const VerticalProgressSteps = Object.assign(VerticalProgressStepsRoot, {
  Item: VerticalProgressStepItemComponent,
});

export { VerticalProgressStepItemComponent as VerticalProgressStepItem };
