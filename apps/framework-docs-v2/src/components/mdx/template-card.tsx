"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { IconBrandGithub } from "@tabler/icons-react";
import {
  Snippet,
  SnippetCopyButton,
  SnippetHeader,
  SnippetTabsContent,
  SnippetTabsList,
  SnippetTabsTrigger,
} from "@/components/ui/snippet";
import type {
  ItemMetadata,
  TemplateMetadata,
  AppMetadata,
} from "@/lib/template-types";

interface TemplateCardProps {
  item: ItemMetadata;
  className?: string;
}

function ShellSnippet({ code }: { code: string }) {
  const [value, setValue] = React.useState("terminal");

  return (
    <Snippet value={value} onValueChange={setValue} className="my-0 w-full">
      <SnippetHeader>
        <SnippetTabsList>
          <SnippetTabsTrigger value="terminal">Terminal</SnippetTabsTrigger>
        </SnippetTabsList>
        <SnippetCopyButton value={code} />
      </SnippetHeader>
      <SnippetTabsContent value="terminal">{code}</SnippetTabsContent>
    </Snippet>
  );
}

export function TemplateCard({ item, className }: TemplateCardProps) {
  const isTemplate = item.type === "template";
  const template = isTemplate ? (item as TemplateMetadata) : null;
  const app = !isTemplate ? (item as AppMetadata) : null;

  const categoryColors = {
    starter: "border-blue-200 dark:border-blue-800",
    framework: "border-purple-200 dark:border-purple-800",
    example: "border-green-200 dark:border-green-800",
  };

  const categoryLabels = {
    starter: "Starter",
    framework: "Framework",
    example: "Example",
  };

  const formatTemplateName = (name: string): string => {
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const language = isTemplate ? template!.language : app!.language;
  const features = isTemplate ? template!.features : app!.features;
  const frameworks = isTemplate ? template!.frameworks : app!.frameworks;
  const githubUrl = isTemplate ? template!.githubUrl : app!.githubUrl;
  const description = isTemplate ? template!.description : app!.description;
  const name = isTemplate ? template!.name : app!.name;

  return (
    <Card
      className={cn(
        "h-full flex flex-col transition-all hover:shadow-lg",
        isTemplate && template ?
          categoryColors[template.category]
        : "border-orange-200 dark:border-orange-800",
        className,
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              {language && (
                <Badge
                  variant={language === "typescript" ? "default" : "secondary"}
                  className="text-xs"
                >
                  {language === "typescript" ? "TS" : "Python"}
                </Badge>
              )}
              {isTemplate && template && (
                <Badge variant="outline" className="text-xs">
                  {categoryLabels[template.category]}
                </Badge>
              )}
              {!isTemplate && (
                <Badge variant="outline" className="text-xs">
                  Demo App
                </Badge>
              )}
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-1">
              {isTemplate ? formatTemplateName(name) : name}
            </h3>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <CardDescription className="mb-4">{description}</CardDescription>

        {frameworks.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-muted-foreground mb-1.5 font-medium">
              Frameworks:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {frameworks.map((framework) => (
                <Badge key={framework} variant="outline" className="text-xs">
                  {framework}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {features.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1.5 font-medium">
              Features:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {features.map((feature) => (
                <Badge key={feature} variant="outline" className="text-xs">
                  {feature}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-2 pt-4 w-full">
        {isTemplate && template && (
          <div className="w-full min-w-0">
            <ShellSnippet code={template.initCommand} />
          </div>
        )}
        {!isTemplate && app && app.blogPost && (
          <Link
            href={app.blogPost}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 w-full mb-1"
          >
            Read Blog Post →
          </Link>
        )}
        <Link
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 w-full"
        >
          <IconBrandGithub className="h-3 w-3" />
          View on GitHub
        </Link>
      </CardFooter>
    </Card>
  );
}
