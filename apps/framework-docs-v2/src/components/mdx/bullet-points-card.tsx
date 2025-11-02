import { cn } from "@/lib/utils";
import { IconCheck, IconX, IconExternalLink } from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import React from "react";

export type BulletStyle = "default" | "number" | "check" | "x";

export interface BasicBulletPoint {
  title: string;
  description?: string;
  link?: {
    text: string;
    href: string;
    external?: boolean;
  };
}

interface BulletPointCardProps {
  title: string;
  bullets: Array<BasicBulletPoint> | string[];
  className?: string;
  divider?: boolean;
  bulletStyle?: BulletStyle;
  uppercase?: boolean;
  compact?: boolean;
}

// ------------------- Shared components -------------------

// BulletIcon component
export function BulletIcon({
  index,
  bulletStyle,
  compact,
}: {
  index: number;
  bulletStyle?: BulletStyle;
  compact?: boolean;
}) {
  if (!bulletStyle) return null;
  const baseIconClasses = "shrink-0 mr-3";
  switch (bulletStyle) {
    case "default":
      return (
        <span
          className={cn(
            baseIconClasses,
            "inline-block w-2 h-2 bg-primary rounded-full mt-1.5",
          )}
        />
      );
    case "number":
      return (
        <span
          className={cn(
            baseIconClasses,
            "inline-flex items-center justify-center w-6 h-6 text-muted-foreground font-medium bg-primary/10 rounded-full text-sm",
          )}
        >
          {index + 1}
        </span>
      );
    case "check":
      return (
        <div
          className={cn(
            baseIconClasses,
            "p-1 bg-green-500/10 dark:bg-green-400/10 rounded-full",
          )}
        >
          <IconCheck className="w-4 h-4 text-green-600 dark:text-green-400" />
        </div>
      );
    case "x":
      return (
        <div
          className={cn(baseIconClasses, "p-1 bg-destructive/10 rounded-full")}
        >
          <IconX className="w-4 h-4 text-destructive" />
        </div>
      );
    default:
      return null;
  }
}

// BulletPointContent component
export function BulletPointContent({
  point,
  compact,
}: {
  point: BasicBulletPoint | string;
  compact?: boolean;
}) {
  return (
    <div className="flex-1 space-y-1">
      <h4 className={cn("font-medium text-primary", compact && "text-sm")}>
        {typeof point === "string" ? point : point.title}
      </h4>
      {typeof point === "object" && "description" in point && (
        <div
          className={cn(
            "text-muted-foreground leading-relaxed",
            compact ? "text-xs" : "text-sm",
          )}
        >
          <p className="mb-1">{point.description}</p>
          {point.link &&
            (point.link.external ?
              <Link
                href={point.link.href}
                className="text-primary hover:underline transition-colors inline-flex items-center gap-1"
                target="_blank"
                rel="noopener noreferrer"
              >
                {point.link.text}
                <IconExternalLink className="w-3 h-3" />
              </Link>
            : <Link
                href={point.link.href}
                className="text-primary hover:underline transition-colors inline-flex items-center gap-1"
              >
                {point.link.text}
              </Link>)}
        </div>
      )}
    </div>
  );
}

// Base card component
function BulletPointCard({
  children,
  className,
  compact,
  maxWidth = "max-w-3xl",
}: {
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
  maxWidth?: string;
}) {
  return (
    <Card
      className={cn(
        "rounded-xl shadow-sm my-6",
        maxWidth,
        compact ? "p-4" : "p-6",
        className,
      )}
    >
      {children}
    </Card>
  );
}

// Title component
function BulletPointTitle({
  title,
  uppercase = true,
  compact = false,
}: {
  title: string;
  uppercase?: boolean;
  compact?: boolean;
}) {
  return (
    <h3
      className={cn(
        "font-mono text-sm tracking-wider text-muted-foreground",
        compact ? "mb-3" : "mb-6",
        uppercase && "uppercase",
      )}
    >
      {title}
    </h3>
  );
}

// Divider component
function BulletPointDivider({ compact }: { compact?: boolean }) {
  return (
    <div className={cn("border-t border-border", compact ? "my-2" : "my-4")} />
  );
}

// Row component
interface RowProps {
  compact?: boolean;
  children: React.ReactNode;
}

const Row = ({ compact, children }: RowProps) => (
  <div className={cn(compact ? "py-0.5" : "py-1", "flex w-full")}>
    {children}
  </div>
);

// BulletPoint component for a single bullet (icon + content)
function BulletPoint({
  bullet,
  index,
  bulletStyle,
  compact,
}: {
  bullet: BasicBulletPoint | string | undefined;
  index: number;
  bulletStyle?: BulletStyle;
  compact?: boolean;
}) {
  return (
    <div className="flex items-start flex-1">
      <BulletIcon index={index} bulletStyle={bulletStyle} compact={compact} />
      <BulletPointContent point={bullet!} compact={compact} />
    </div>
  );
}

// ------------------- Implementation -------------------

// BulletPointsCard component (single column)
export function BulletPointsCard({
  title,
  bullets,
  className,
  divider = true,
  bulletStyle,
  uppercase = true,
  compact = false,
}: BulletPointCardProps) {
  return (
    <BulletPointCard className={className} compact={compact}>
      <div className="flex w-full">
        <BulletPointTitle
          title={title}
          uppercase={uppercase}
          compact={compact}
        />
      </div>
      <div className={compact ? "space-y-2" : "space-y-4"}>
        {bullets.map((point, index) => (
          <React.Fragment key={index}>
            {divider && index > 0 && <BulletPointDivider compact={compact} />}
            <Row compact={compact}>
              <BulletPoint
                bullet={point}
                index={index}
                bulletStyle={bulletStyle}
                compact={compact}
              />
            </Row>
          </React.Fragment>
        ))}
      </div>
    </BulletPointCard>
  );
}

// CompareBulletPointsCard component (two columns)
interface CompareBulletPointsCardProps {
  leftColumn: {
    title: string;
    bullets: Array<BasicBulletPoint> | string[];
    bulletStyle?: BulletStyle;
  };
  rightColumn: {
    title: string;
    bullets: Array<BasicBulletPoint> | string[];
    bulletStyle?: BulletStyle;
  };
  className?: string;
  divider?: boolean;
  uppercase?: boolean;
  compact?: boolean;
}

export function CompareBulletPointsCard({
  leftColumn,
  rightColumn,
  className,
  divider = true,
  uppercase = true,
  compact = false,
}: CompareBulletPointsCardProps) {
  return (
    <BulletPointCard
      className={className}
      compact={compact}
      maxWidth="max-w-5xl"
    >
      <div
        className={cn(
          "flex w-full border-b border-border",
          compact ? "mb-2" : "mb-4",
        )}
      >
        <div className="flex-1 pr-4">
          <BulletPointTitle
            title={leftColumn.title}
            uppercase={uppercase}
            compact={compact}
          />
        </div>
        <div className="flex-1 pl-4">
          <BulletPointTitle
            title={rightColumn.title}
            uppercase={uppercase}
            compact={compact}
          />
        </div>
      </div>
      {leftColumn.bullets.map((_, index) => (
        <React.Fragment key={index}>
          {divider && index > 0 && <BulletPointDivider compact={compact} />}
          <Row compact={compact}>
            <BulletPoint
              bullet={leftColumn.bullets[index]}
              index={index}
              bulletStyle={leftColumn.bulletStyle}
              compact={compact}
            />
            <BulletPoint
              bullet={rightColumn.bullets[index]}
              index={index}
              bulletStyle={rightColumn.bulletStyle}
              compact={compact}
            />
          </Row>
        </React.Fragment>
      ))}
    </BulletPointCard>
  );
}
