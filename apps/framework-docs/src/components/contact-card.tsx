import React from "react";
import { Card, CardContent, Button } from "@/components/ui";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface ContactCardProps {
  title: string;
  description: string;
  ctaLink: string;
  ctaLabel: string;
  Icon?: React.ElementType;
  className?: string;
  variant?: "default" | "gradient" | "sloan";
}

export function ContactCard({
  title,
  description,
  ctaLink,
  ctaLabel,
  Icon,
  className = "",
  variant = "default",
}: ContactCardProps) {
  return (
    <Card
      className={cn("transition-all duration-200 hover:shadow-md", className)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {Icon && (
            <div className="flex-shrink-0 mt-1">
              <Icon
                className={cn(
                  "h-5 w-5",
                  variant === "sloan" ? "text-sloan-teal" : "text-moose-purple",
                )}
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm text-primary mb-1">{title}</h4>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
              {description}
            </p>
            <Link href={ctaLink}>
              <Button
                variant="secondary"
                size="sm"
                className="text-xs h-7 px-3 font-normal border hover:bg-secondary/20"
              >
                {ctaLabel}
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ContactCardsProps {
  children: React.ReactNode;
  columns?: number;
}

export function ContactCards({ children, columns = 2 }: ContactCardsProps) {
  const gridColumns = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  };

  return (
    <div
      className={cn(
        "grid gap-3",
        gridColumns[columns as keyof typeof gridColumns],
      )}
    >
      {children}
    </div>
  );
}
