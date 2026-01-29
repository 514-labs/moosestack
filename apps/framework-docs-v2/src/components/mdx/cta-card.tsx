import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { IconBadge } from "./icon-badge";
import type { IconProps } from "@tabler/icons-react";
import * as TablerIcons from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

interface CTACardProps {
  title: string;
  description: string;
  ctaLink: string;
  ctaLabel?: string;
  Icon?:
    | React.ComponentType<IconProps>
    | React.FC<React.SVGProps<SVGSVGElement>>
    | string;
  badge?: {
    variant: "boreal" | "sloan" | "moose" | "default";
    text: string;
  };
  className?: string;
  variant?: "default" | "gradient" | "sloan";
  orientation?: "vertical" | "horizontal";
  isMooseModule?: boolean;
  /** @internal Used by CTACards grouped mode */
  _grouped?: boolean;
}

export function CTACard({
  title,
  description,
  ctaLink,
  ctaLabel = "Learn more",
  Icon,
  badge,
  className = "",
  variant = "default",
  orientation = "vertical",
  isMooseModule = false,
  _grouped = false,
}: CTACardProps) {
  // If Icon is a string, look it up in Tabler icons
  const IconComponent =
    typeof Icon === "string" ? (TablerIcons as any)[`Icon${Icon}`] : Icon;

  // Grouped horizontal card (inside CTACards with grouped=true)
  if (orientation === "horizontal" && _grouped) {
    return (
      <Link
        href={ctaLink}
        className="group relative flex items-center gap-4 px-6 py-4 hover:bg-accent/50 transition-colors cursor-pointer"
      >
        {badge ?
          <IconBadge variant={badge.variant} label={badge.text} />
        : IconComponent ?
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted text-muted-foreground shrink-0">
            <IconComponent className="h-5 w-5" strokeWidth={1.5} />
          </div>
        : null}
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <h3 className="text-base font-semibold text-foreground">
            {isMooseModule ?
              <span className="text-muted-foreground">Moose </span>
            : ""}
            {title}
          </h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button
          variant="default"
          size="sm"
          className="shrink-0 pointer-events-none"
        >
          {ctaLabel}
        </Button>
      </Link>
    );
  }

  // Standalone horizontal card
  if (orientation === "horizontal") {
    return (
      <div
        className={cn(
          "rounded-xl border bg-card text-card-foreground shadow overflow-hidden w-full",
          className,
        )}
      >
        <Link
          href={ctaLink}
          className="flex items-center gap-4 px-6 py-4 hover:bg-accent/50 transition-colors"
        >
          {badge ?
            <IconBadge variant={badge.variant} label={badge.text} />
          : IconComponent ?
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted text-muted-foreground shrink-0">
              <IconComponent className="h-5 w-5" strokeWidth={1.5} />
            </div>
          : null}
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <h3 className="text-base font-semibold text-foreground">
              {isMooseModule ?
                <span className="text-muted-foreground">Moose </span>
              : ""}
              {title}
            </h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <Button
            variant="default"
            size="sm"
            className="shrink-0 pointer-events-none"
          >
            {ctaLabel}
          </Button>
        </Link>
      </div>
    );
  }

  // Vertical card (default)
  return (
    <Card className={cn("h-full flex flex-col", className)}>
      <CardHeader>
        <div className="flex gap-2 items-center">
          {badge ?
            <IconBadge variant={badge.variant} label={badge.text} />
          : IconComponent ?
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-muted text-muted-foreground shrink-0">
              <IconComponent className="h-6 w-6" strokeWidth={1.5} />
            </div>
          : null}
        </div>
      </CardHeader>
      <CardContent>
        <h5 className="text-primary mb-0 text-lg font-semibold">
          {isMooseModule ?
            <span className="text-muted-foreground">Moose </span>
          : ""}
          {title}
        </h5>
        <CardDescription className="mt-2">{description}</CardDescription>
      </CardContent>
      <CardFooter>
        <Link href={ctaLink}>
          <Button className="font-normal" variant="secondary">
            {ctaLabel}
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
}

interface CTACardsProps {
  children: React.ReactNode;
  columns?: number;
  rows?: number;
  /** Render cards in a grouped container like guide cards */
  grouped?: boolean;
}

export function CTACards({
  children,
  columns = 2,
  rows = 1,
  grouped = false,
}: CTACardsProps) {
  const gridColumns = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  };

  // Grouped mode - render cards in a single card container with dividers
  if (grouped) {
    const childArray = React.Children.toArray(children);
    return (
      <div className="not-prose rounded-xl border bg-card text-card-foreground shadow overflow-hidden mt-5 w-full">
        {childArray.map((child, index) => (
          <React.Fragment key={index}>
            {React.isValidElement(child) ?
              React.cloneElement(child as React.ReactElement<CTACardProps>, {
                _grouped: true,
              })
            : child}
            {index < childArray.length - 1 && (
              <div className="border-b border-border/50" />
            )}
          </React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "not-prose grid gap-5 mt-5 w-full",
        gridColumns[columns as keyof typeof gridColumns],
        `grid-rows-${rows}`,
      )}
    >
      {children}
    </div>
  );
}
