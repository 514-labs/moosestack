import React from "react";
import { cn } from "@/lib/utils";
import { Callout } from "./callout";
import {
  IconPlus,
  IconRefresh,
  IconTrash,
  IconHammer,
  IconShield,
  IconAlertTriangle,
  IconSparkles,
} from "@tabler/icons-react";
import type { IconProps } from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
    Icon: IconSparkles,
    defaultTitle: "Release Highlights",
  },
  added: {
    calloutType: "info" as const,
    Icon: IconPlus,
    defaultTitle: "Added",
  },
  changed: {
    calloutType: "info" as const,
    Icon: IconRefresh,
    defaultTitle: "Changed",
  },
  deprecated: {
    calloutType: "warning" as const,
    Icon: IconTrash,
    defaultTitle: "Deprecated",
  },
  fixed: {
    calloutType: "info" as const,
    Icon: IconHammer,
    defaultTitle: "Fixed",
  },
  security: {
    calloutType: "info" as const,
    Icon: IconShield,
    defaultTitle: "Security",
  },
  "breaking-changes": {
    calloutType: "danger" as const,
    Icon: IconAlertTriangle,
    defaultTitle: "Breaking Changes",
  },
};

interface TitleWithIconProps {
  title: string;
  Icon: React.ComponentType<IconProps>;
  children: React.ReactNode;
}

function TitleWithIcon({ title, Icon, children }: TitleWithIconProps) {
  return (
    <Card className="my-4">
      <CardContent className="flex items-start gap-4 py-4">
        <div className="bg-muted rounded-lg p-2 shrink-0 flex items-center justify-center">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1">
          <h4 className="text-md font-semibold mb-2">{title}</h4>
          <div className="text-sm text-muted-foreground">{children}</div>
        </div>
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

  if (type === "highlights") {
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

  // Breaking changes styled as destructive alert
  if (type === "breaking-changes") {
    return (
      <Alert variant="destructive" className="my-4">
        <config.Icon className="h-4 w-4" />
        <AlertTitle>{title || config.defaultTitle}</AlertTitle>
        <AlertDescription>{children}</AlertDescription>
      </Alert>
    );
  }

  // Deprecated styled as warning alert
  if (type === "deprecated") {
    return (
      <Alert variant="warning" className="my-4">
        <config.Icon className="h-4 w-4" />
        <AlertTitle>{title || config.defaultTitle}</AlertTitle>
        <AlertDescription>{children}</AlertDescription>
      </Alert>
    );
  }

  return (
    <TitleWithIcon title={title || config.defaultTitle} Icon={config.Icon}>
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
