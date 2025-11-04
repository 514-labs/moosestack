import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  Button,
} from "@/components/ui";
import Link from "next/link";
import {
  Heading,
  HeadingLevel,
  SmallText,
  Text,
} from "@/components/typography";
import { cn } from "@/lib/utils";
import { IconBadge } from "@/components/badges";
import { ArrowRight } from "lucide-react";

interface CTACardProps {
  title: string;
  description: string;
  ctaLink: string;
  ctaLabel: string;
  Icon?: React.ElementType;
  badge?: {
    variant: "boreal" | "sloan" | "moose" | "default";
    text: string;
  };
  className?: string;
  cardName?: string;
  variant?: "default" | "gradient" | "sloan";
  orientation?: "vertical" | "horizontal";
  isMooseModule?: boolean;
  secondaryCtaLink?: string;
  secondaryCtaLabel?: string;
}

export function CTACard({
  title,
  description,
  ctaLink,
  ctaLabel,
  cardName,
  Icon,
  badge,
  className = "",
  variant = "default",
  orientation = "vertical",
  isMooseModule = false,
  secondaryCtaLink,
  secondaryCtaLabel,
}: CTACardProps) {
  return orientation == "horizontal" ?
      <Link href={ctaLink} className={cn("w-full", className)}>
        <Card
          className={cn(
            "h-full flex flex-row items-center hover:bg-muted transition w-auto md:w-full",
          )}
        >
          {badge ?
            <IconBadge variant={badge.variant} label={badge.text} />
          : Icon ?
            <div className="ml-4 bg-muted rounded-lg p-4 shrink-0 flex items-center justify-center border border-neutral-200 dark:border-neutral-800">
              <Icon
                className={cn(
                  "h-6 w-6",
                  variant === "sloan" ? "text-sloan-teal" : "text-primary",
                )}
              />
            </div>
          : null}
          <CardContent className="min-w-0 px-6 py-4 flex-1 text-left inline-block md:block">
            <Heading
              className="text-primary mb-0 mt-0 pt-0 text-left"
              level={HeadingLevel.l5}
            >
              {isMooseModule ?
                <span className="text-muted-foreground">Moose </span>
              : ""}
              {title}
            </Heading>
            <CardDescription className="mt-2 text-left">
              {description}
            </CardDescription>
          </CardContent>
          <div className="mr-6 rounded-lg p-4 shrink-0 flex items-center justify-center">
            <ArrowRight className="h-6 w-6" />
            <span className="sr-only">{ctaLabel}</span>
          </div>
        </Card>
      </Link>
    : <Card className={cn("h-full flex flex-col", className)}>
        <CardHeader>
          <div className="flex gap-2 items-center">
            {badge ?
              <IconBadge variant={badge.variant} label={badge.text} />
            : orientation === "vertical" && Icon ?
              <div className="bg-muted rounded-lg p-4 border border-neutral-200 dark:border-neutral-800">
                <Icon
                  className={cn(
                    "h-6 w-6",
                    variant === "sloan" ? "text-sloan-teal" : "text-primary",
                  )}
                />
              </div>
            : null}
          </div>
        </CardHeader>
        <CardContent>
          <Heading className="text-primary mb-0" level={HeadingLevel.l5}>
            {isMooseModule ?
              <span className="text-muted-foreground">Moose</span>
            : ""}
            {title}
          </Heading>
          <CardDescription className="mt-2">{description}</CardDescription>
        </CardContent>
        <CardFooter className="flex gap-2">
          <Link href={ctaLink}>
            <Button className="font-normal" variant="secondary">
              {ctaLabel}
            </Button>
          </Link>
          {secondaryCtaLink && secondaryCtaLabel && (
            <Link href={secondaryCtaLink}>
              <Button className="font-normal" variant="secondary">
                {secondaryCtaLabel}
              </Button>
            </Link>
          )}
        </CardFooter>
      </Card>;
}

interface CTACardsProps {
  children: React.ReactNode;
  columns?: number;
  rows?: number;
}

export function CTACards({ children, columns = 2, rows = 1 }: CTACardsProps) {
  const gridColumns = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  };

  return (
    <div
      className={cn(
        "grid gap-5 mt-5",
        gridColumns[columns as keyof typeof gridColumns],
        `grid-rows-${rows}`,
        columns === 1 ? "justify-items-start" : "", // Allow auto-width for single column
      )}
    >
      {children}
    </div>
  );
}
