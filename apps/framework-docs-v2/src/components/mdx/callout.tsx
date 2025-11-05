import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  IconInfoCircle,
  IconBulb,
  IconConfetti,
  IconAlertCircle,
} from "@tabler/icons-react";
import type { IconProps } from "@tabler/icons-react";
import * as TablerIcons from "@tabler/icons-react";

type CalloutVariant = {
  icon: React.ComponentType<IconProps>;
  variant: "success" | "default" | "warning" | "destructive";
  title: string;
};

type CalloutVariants = {
  success: CalloutVariant;
  info: CalloutVariant;
  warning: CalloutVariant;
  danger: CalloutVariant;
};

const calloutVariants: CalloutVariants = {
  success: {
    icon: IconConfetti,
    variant: "success" as const,
    title: "Congrats!",
  },
  info: {
    icon: IconInfoCircle,
    variant: "default" as const,
    title: "MooseTip:",
  },
  warning: {
    icon: IconAlertCircle,
    variant: "warning" as const,
    title: "Warning:",
  },
  danger: {
    icon: IconAlertCircle,
    variant: "destructive" as const,
    title: "Error:",
  },
};

type CalloutType = keyof typeof calloutVariants;

interface CalloutProps {
  type: CalloutType;
  title?: string;
  href?: string;
  icon?: React.ComponentType<IconProps> | boolean | string;
  ctaLabel?: string;
  children: React.ReactNode;
  compact?: boolean;
  className?: string;
}

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

  // Resolve icon: boolean -> default, string -> lookup from Tabler icons, component -> use directly
  const Icon =
    typeof icon === "boolean" && icon ? variantProps.icon
    : typeof icon === "string" ?
      (TablerIcons as any)[`Icon${icon}`] || variantProps.icon
    : (icon as React.ComponentType<IconProps>) || variantProps.icon;

  const displayTitle = title || variantProps.title;

  if (compact) {
    return (
      <Alert variant={variantProps.variant} className={cn("my-2", className)}>
        {icon && <Icon className="h-4 w-4" />}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {displayTitle && (
              <AlertTitle className="mb-0.5 inline mr-1.5">
                {displayTitle}
              </AlertTitle>
            )}
            <AlertDescription className="inline">{children}</AlertDescription>
          </div>
          {href && (
            <Link href={href} className="shrink-0">
              <Button
                variant="secondary"
                size="sm"
                className="h-6 px-2 text-xs"
              >
                {ctaLabel}
              </Button>
            </Link>
          )}
        </div>
      </Alert>
    );
  }

  return (
    <Alert variant={variantProps.variant} className={cn("my-4", className)}>
      {icon && <Icon className="h-4 w-4" />}
      {displayTitle && <AlertTitle>{displayTitle}</AlertTitle>}
      <AlertDescription>
        {children}
        {href && (
          <div className="mt-3">
            <Link href={href}>
              <Button variant="secondary" size="sm">
                {ctaLabel}
              </Button>
            </Link>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
