import React, { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export interface FeatureCardProps {
  href?: string;
  Icon: React.ElementType;
  title: string;
  description: string;
  features?: string[];
  variant?: "moose" | "sloan" | "default";
  size?: "default" | "compact";
  className?: string;
}

export function FeatureCard({
  href,
  Icon,
  title,
  description,
  features = [],
  variant = "default",
  size = "default",
  className,
}: FeatureCardProps) {
  const cardClasses = cn(
    "flex flex-col rounded-xl border border-border bg-card",
    {
      "transition-colors cursor-pointer": !!href,
      "hover:border-primary hover:bg-primary/5":
        !!href && variant === "default",
      "p-6": size === "default",
      "p-3": size === "compact",
    },
    className,
  );

  const cardContent = (
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
              className={cn("h-[20px] w-[20px] text-primary", {
                "h-[24px] w-[24px]": size === "compact",
              })}
            />
          </div>
        )}
        <div>
          <h3
            className={cn("text-lg font-medium text-primary", {
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
          {features.length > 0 && (
            <ul className="mt-2 space-y-1">
              {features.map((feature, idx) => (
                <li
                  key={idx}
                  className={cn("text-muted-foreground text-sm", {
                    "text-xs": size === "compact",
                  })}
                >
                  {feature}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className={cardClasses}>
        {cardContent}
      </Link>
    );
  }

  return <div className={cardClasses}>{cardContent}</div>;
}

export interface FeatureGridProps {
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}

export function FeatureGrid({
  children,
  columns = 2,
  className,
}: FeatureGridProps) {
  const gridClass = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  }[columns];

  return (
    <div className={cn("grid gap-6 my-8", gridClass, className)}>
      {children}
    </div>
  );
}
