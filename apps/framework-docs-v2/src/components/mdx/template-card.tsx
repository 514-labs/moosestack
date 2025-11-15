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
import { IconBrandGithub, IconRocket } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
        className,
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              {language && (
                <Badge variant="secondary" className="text-xs">
                  {language === "typescript" ? "TypeScript" : "Python"}
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
            <h3 className="text-xl  text-foreground mb-1">
              {isTemplate ? formatTemplateName(name) : name}
            </h3>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <CardDescription className="mb-4 flex-1">{description}</CardDescription>
        {isTemplate && template && (
          <div className="w-full min-w-0">
            <ShellSnippet code={template.initCommand} />
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-2 pt-4 w-full">
        {isTemplate && template && (
          <>
            {(frameworks.length > 0 || features.length > 0) && (
              <>
                <Separator className="my-2" />
                <div className="flex flex-wrap gap-1.5 justify-start w-full">
                  {frameworks.map((framework) => (
                    <Badge
                      key={framework}
                      variant="secondary"
                      className="text-xs"
                    >
                      {framework}
                    </Badge>
                  ))}
                  {features.map((feature) => (
                    <Badge key={feature} variant="outline" className="text-xs">
                      {feature}
                    </Badge>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {!isTemplate && app && (
          <>
            {app.blogPost && (
              <Link
                href={app.blogPost}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 w-full"
              >
                Read Blog Post →
              </Link>
            )}
            {app.blogPost && (frameworks.length > 0 || features.length > 0) && (
              <Separator className="my-2" />
            )}
            {(frameworks.length > 0 || features.length > 0) && (
              <div className="flex flex-wrap gap-1.5 justify-start w-full">
                {frameworks.map((framework) => (
                  <Badge
                    key={framework}
                    variant="secondary"
                    className="text-xs"
                  >
                    {framework}
                  </Badge>
                ))}
                {features.map((feature) => (
                  <Badge key={feature} variant="outline" className="text-xs">
                    {feature}
                  </Badge>
                ))}
              </div>
            )}
          </>
        )}
        <div className="flex w-full items-center justify-start gap-2 mt-auto pt-2">
          <Button variant="default" asChild>
            <Link
              href={`https://moose.dev/deploy?template=${isTemplate ? template!.slug : app!.slug}`}
            >
              <IconRocket className="h-4 w-4" />
              Deploy
            </Link>
          </Button>
          <Button variant="outline" size="icon" asChild>
            <Link
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View on GitHub"
            >
              <IconBrandGithub className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
