import React, { ReactNode, FC } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface FeatureCardProps {
  href?: string;
  Icon: React.ElementType;
  title: string;
  description: string;
  features?: string[];
  variant?: "moose" | "sloan";
  size?: "default" | "compact";
}

export function FeatureCard({
  href,
  Icon,
  title,
  description,
  features = [],
  variant = "moose",
  size = "default",
}: FeatureCardProps) {
  const cardClasses = cn(
    "flex flex-col rounded-xl border border-border bg-card",
    {
      "transition-colors cursor-pointer": !!href,
      "hover:border-moose-purple hover:bg-moose-purple/10":
        !!href && variant === "moose",
      "hover:border-sloan-teal hover:bg-sloan-teal/10":
        !!href && variant === "sloan",
      "p-6": size === "default",
      "p-3": size === "compact",
    },
  );

  const CardContent = () => (
    <div
      className={cn("flex flex-col gap-2", {
        "flex-row items-center gap-3": size === "compact",
      })}
    >
      <div
        className={cn("flex items-center gap-4", {
          "gap-3": size === "compact",
        })}
      >
        {Icon && (
          <div
            className={cn("flex-shrink-0 self-start mt-1", {
              "mt-0": size === "compact",
            })}
          >
            <Icon
              className={cn(
                "h-[20px] w-[20px]",
                variant === "moose" ? "text-moose-purple" : "text-sloan-teal",
                {
                  "h-[24px] w-[24px]": size === "compact",
                },
              )}
            />
          </div>
        )}
        <div>
          <h3
            className={cn("text-lg font-medium", {
              "text-sm": size === "compact",
            })}
          >
            {title}
          </h3>
          {description && (
            <div
              className={cn("text-muted-foreground text-sm mt-1", {
                "text-xs": size === "compact",
              })}
            >
              {description}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className={cardClasses}>
        <CardContent />
      </Link>
    );
  }

  return (
    <div className={cardClasses}>
      <CardContent />
    </div>
  );
}

export interface FeatureGridProps {
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
}

export function FeatureGrid({ children, columns = 2 }: FeatureGridProps) {
  const gridClass = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  }[columns];

  return <div className={`grid ${gridClass} gap-6 my-8`}>{children}</div>;
}
