import React from "react";
import { cn } from "@/lib/utils";
import { Callout } from "@/components";
import {
  PlusCircle,
  RefreshCw,
  Trash2,
  Wrench,
  Shield,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardDescription } from "@/components/ui/card";

type ChangelogCategoryType =
  | "highlights"
  | "added"
  | "changed"
  | "deprecated"
  | "fixed"
  | "security"
  | "breaking-changes";

interface ChangelogCategoryProps {
  type: ChangelogCategoryType;
  title?: string;
  children: React.ReactNode;
}

const categoryConfig = {
  highlights: {
    calloutType: "success" as const,
    Icon: Sparkles,
    defaultTitle: "Release Highlights",
    color: "primary",
  },
  added: {
    calloutType: "info" as const,
    Icon: PlusCircle,
    defaultTitle: "Added",
    color: "primary",
  },
  changed: {
    calloutType: "info" as const,
    Icon: RefreshCw,
    defaultTitle: "Changed",
    color: "primary",
  },
  deprecated: {
    calloutType: "warning" as const,
    Icon: Trash2,
    defaultTitle: "Deprecated",
    color: "warning",
  },
  fixed: {
    calloutType: "info" as const,
    Icon: Wrench,
    defaultTitle: "Fixed",
    color: "primary",
  },
  security: {
    calloutType: "info" as const,
    Icon: Shield,
    defaultTitle: "Security",
    color: "primary",
  },
  "breaking-changes": {
    calloutType: "danger" as const,
    Icon: AlertTriangle,
    defaultTitle: "Breaking Changes",
    color: "destructive",
  },
};

interface TitleWithIconProps {
  title: string;
  Icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
  color?: string;
}

export function TitleWithIcon({
  title,
  Icon,
  children,
  className,
  color,
}: TitleWithIconProps) {
  return (
    <Card
      className={cn(
        `bg-transparent flex items-center my-4 py-0 border-x-0`,
        className,
      )}
    >
      <div className="ml-6 bg-muted rounded-lg p-4 shrink-0 flex items-start justify-center">
        <Icon className={cn("h-6 w-6", `text-muted-foreground`)} />
      </div>
      <CardContent className="flex-1 mb-2">
        <p className={cn("pt-4 mb-0 text-md", `text-${color}`)}>{title}</p>
        <CardDescription className="mt-2">{children}</CardDescription>
      </CardContent>
    </Card>
  );
}

export function ChangelogCategory({
  type,
  title,
  children,
}: ChangelogCategoryProps) {
  const config = categoryConfig[type];

  if (type === "highlights" || type === "breaking-changes") {
    return (
      <Callout
        type={config.calloutType}
        title={title || config.defaultTitle}
        icon={config.Icon}
      >
        {children}
      </Callout>
    );
  }
  return (
    <TitleWithIcon
      title={title || config.defaultTitle}
      Icon={config.Icon}
      color={config.color}
    >
      {children}
    </TitleWithIcon>
  );
}

// Convenience components for each category
export function ReleaseHighlights({ children }: { children: React.ReactNode }) {
  return <ChangelogCategory type="highlights">{children}</ChangelogCategory>;
}

export function Added({ children }: { children: React.ReactNode }) {
  return <ChangelogCategory type="added">{children}</ChangelogCategory>;
}

export function Changed({ children }: { children: React.ReactNode }) {
  return <ChangelogCategory type="changed">{children}</ChangelogCategory>;
}

export function Deprecated({ children }: { children: React.ReactNode }) {
  return <ChangelogCategory type="deprecated">{children}</ChangelogCategory>;
}

export function Fixed({ children }: { children: React.ReactNode }) {
  return <ChangelogCategory type="fixed">{children}</ChangelogCategory>;
}

export function Security({ children }: { children: React.ReactNode }) {
  return <ChangelogCategory type="security">{children}</ChangelogCategory>;
}

export function BreakingChanges({ children }: { children: React.ReactNode }) {
  return (
    <ChangelogCategory type="breaking-changes">{children}</ChangelogCategory>
  );
}
