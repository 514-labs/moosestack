import * as React from "react";
import { cn } from "@/lib/utils";
import { Heading, HeadingLevel } from "@/components/typography";
import {
  Card,
  CardContent,
  CardTitle,
  CardFooter,
  CardDescription,
} from "@/components/ui";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { InfoIcon, Lightbulb, PartyPopper, StopCircle } from "lucide-react";

interface CalloutProps {
  type: CalloutType;
  title?: string;
  href?: string;
  icon?: React.ElementType | boolean;
  ctaLabel?: string;
  children: React.ReactNode;
  compact?: boolean;
  className?: string;
}

const calloutVariants = {
  success: {
    icon: PartyPopper,
    color: "bg-muted/50",
    border: "border-boreal-green/10",
    title: "Congrats!",
    titleColor: "text-boreal-green/90",
  },
  info: {
    icon: InfoIcon,
    color: "bg-muted/50",
    border: "border",
    title: "MooseTip:",
    titleColor: "text-primary",
  },
  warning: {
    icon: StopCircle,
    color: "bg-muted/50",
    border: "border-moose-yellow/20",
    title: "Warning:",
    titleColor: "text-primary",
  },
  danger: {
    icon: StopCircle,
    color: "bg-muted/50",
    border: "border-destructive/20",
    title: "Error:",
    titleColor: "text-muted-foreground",
  },
};

type CalloutType = keyof typeof calloutVariants;

export function Callout({
  type,
  title,
  href,
  icon = true,
  ctaLabel = "Learn more",
  children,
  compact = false,
  className,
}: CalloutProps) {
  const variantProps = calloutVariants[type];

  const Icon =
    typeof icon === "boolean" && icon ?
      variantProps.icon
    : (icon as React.ElementType);

  if (compact) {
    return (
      <Card
        className={cn(
          "flex items-start my-2 p-3",
          variantProps.color,
          variantProps.border,
          className,
        )}
      >
        {icon && (
          <div className="mr-3 bg-muted rounded-md p-2 shrink-0 flex items-center justify-center">
            <Icon className={cn("h-4 w-4", variantProps.titleColor)} />
          </div>
        )}
        <CardContent className="flex-1 min-w-0 p-0">
          <div>
            <span
              className={cn(
                "text-sm font-medium mr-1.5",
                variantProps.titleColor,
              )}
            >
              {title || variantProps.title}
            </span>
            <span className="text-sm text-muted-foreground">{children}</span>
          </div>
        </CardContent>
        {href && (
          <CardFooter className="p-0 ml-2 self-center">
            <Link href={href}>
              <Button
                variant="secondary"
                size="sm"
                className="h-6 px-2 text-xs"
              >
                {ctaLabel}
              </Button>
            </Link>
          </CardFooter>
        )}
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "flex flex-col md:flex-row items-start md:items-center my-4 p-4 gap-4",
        variantProps.color,
        variantProps.border,
      )}
    >
      {icon && (
        <div className="bg-muted rounded-lg p-4 shrink-0 flex items-start justify-center">
          <Icon className={cn("h-6 w-6", variantProps.titleColor)} />
        </div>
      )}
      <CardContent className="flex-1 min-w-0 p-0 items-start">
        <p className={cn("mb-0 text-md", variantProps.titleColor)}>
          {title || variantProps.title}
        </p>
        <CardDescription className="mt-2">{children}</CardDescription>
      </CardContent>
      {href && (
        <CardFooter className="items-start p-0">
          <Link href={href}>
            <Button variant="secondary">{ctaLabel}</Button>
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}
