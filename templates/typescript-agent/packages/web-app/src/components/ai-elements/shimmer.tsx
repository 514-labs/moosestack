"use client";

import type { CSSProperties, ElementType } from "react";
import { memo } from "react";

import { cn } from "@/lib/utils";

export interface TextShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const shimmerStyle = {
    "--shimmer-duration": `${duration}s`,
    "--shimmer-spread": `${Math.max(children.length * spread, 24)}px`,
    backgroundImage:
      "linear-gradient(90deg, var(--color-muted-foreground) calc(50% - var(--shimmer-spread)), var(--color-foreground), var(--color-muted-foreground) calc(50% + var(--shimmer-spread)))",
  } as CSSProperties;

  return (
    <Component
      className={cn(
        "inline-block bg-[length:250%_100%] bg-clip-text text-transparent [animation:shimmer-slide_var(--shimmer-duration)_linear_infinite]",
        className,
      )}
      style={shimmerStyle}
    >
      {children}
    </Component>
  );
};

export const Shimmer = memo(ShimmerComponent);
