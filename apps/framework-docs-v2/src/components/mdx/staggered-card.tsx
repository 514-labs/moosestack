import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function StaggeredCards({ children }: { children: React.ReactNode }) {
  return <Card className="not-prose space-y-8 my-8 p-8">{children}</Card>;
}

interface StaggeredCardProps {
  children: React.ReactNode;
  stagger?: "left" | "right";
  className?: string;
}

export function StaggeredCard({
  children,
  stagger = "left",
  className,
}: StaggeredCardProps) {
  return (
    <div>
      <div
        className={cn(
          "grid grid-cols-1 gap-8 items-start",
          stagger === "left" ?
            "md:grid-cols-[40%_60%]"
          : "md:grid-cols-[60%_40%]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface StaggeredContentProps {
  isMooseModule?: boolean;
  title?: string;
  description?: string;
  cta?: {
    label: string;
    href: string;
    variant?: "default" | "outline" | "link";
  };
}

export function StaggeredContent({
  isMooseModule = false,
  title,
  description,
  cta,
}: StaggeredContentProps) {
  return (
    <div>
      <CardHeader className="px-0 pt-0">
        <h3 className="text-2xl font-semibold">
          {isMooseModule ?
            <span className="text-muted-foreground">Moose </span>
          : ""}
          {title}
        </h3>
      </CardHeader>
      <CardContent className="px-0">
        <CardDescription>{description}</CardDescription>
      </CardContent>
      <CardFooter className="px-0">
        {cta && (
          <Button asChild variant={cta.variant}>
            <Link href={cta.href}>{cta.label}</Link>
          </Button>
        )}
      </CardFooter>
    </div>
  );
}

interface StaggeredCodeProps {
  children: React.ReactNode;
  language?: string;
}

export function StaggeredCode({
  children,
  language = "ts",
}: StaggeredCodeProps) {
  return <div className="rounded-xl overflow-x-auto pr-8">{children}</div>;
}
