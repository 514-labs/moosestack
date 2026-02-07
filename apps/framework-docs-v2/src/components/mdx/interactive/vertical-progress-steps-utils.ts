import { type ReactElement, type ReactNode, isValidElement } from "react";

export type ProgressStepsVariant = "numbered" | "bulleted";

interface VerticalProgressStepLikeProps {
  id?: unknown;
  title?: unknown;
}

export function getProgressStepsVariant(value?: string): ProgressStepsVariant {
  return value === "bulleted" ? "bulleted" : "numbered";
}

export function isVerticalProgressStepItemElement(
  node: ReactNode,
): node is ReactElement<VerticalProgressStepLikeProps> {
  if (!isValidElement(node)) return false;
  const props = node.props as VerticalProgressStepLikeProps;
  return (
    typeof props.title === "string" &&
    (typeof props.id === "undefined" || typeof props.id === "string")
  );
}
