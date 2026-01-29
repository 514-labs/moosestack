import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  IconDatabase,
  IconCloud,
  IconSparkles,
  IconCode,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { getNavVariant } from "@/lib/nav-variant";

export default function HomePage() {
  // Use build-time variant (same approach as guides page)
  const variant = getNavVariant();
  const showHosting = variant !== "base";
  const showAi = variant !== "base";

  const sections = [
    {
      title: "MooseStack",
      description:
        "The core framework for building data applications with OLAP, streaming, workflows, and APIs.",
      href: `/moosestack`,
      icon: IconDatabase,
    },
    {
      title: "Templates",
      description:
        "Browse ready-to-use templates and example applications to jumpstart your MooseStack project.",
      href: `/templates`,
      icon: IconCode,
    },
    ...(showHosting ?
      [
        {
          title: "Hosting",
          description:
            "Deploy and host your MooseStack applications with our managed hosting platform.",
          href: `/hosting/overview`,
          icon: IconCloud,
        },
      ]
    : []),
    ...(showAi ?
      [
        {
          title: "AI",
          description:
            "AI-powered features and integrations for enhancing your MooseStack applications.",
          href: `/ai/overview`,
          icon: IconSparkles,
        },
      ]
    : []),
  ];

  // Centralized predicate: only render sections that have an icon
  const shouldRenderSection = (section: { icon?: unknown; title: string }) => {
    if (!section.icon) {
      console.error("[HomePage] Section missing icon:", section.title);
      return false;
    }
    return true;
  };

  // Filter sections to only include those that will actually render
  const renderableSections = sections.filter(shouldRenderSection);

  // Calculate card count from actual rendered sections
  const cardCount = renderableSections.length;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-16">
      <div className="max-w-5xl lg:max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Documentation</h1>
          <p className="text-lg text-muted-foreground">
            Choose a documentation section to get started
          </p>
        </div>

        <div
          className={cn("grid grid-cols-1 gap-6", {
            "md:grid-cols-1 md:max-w-md md:mx-auto": cardCount === 1,
            "md:grid-cols-2": cardCount === 2,
            "md:grid-cols-3": cardCount === 3,
            "md:grid-cols-2 lg:grid-cols-4": cardCount === 4,
          })}
        >
          {renderableSections.map((section) => {
            const Icon = section.icon;
            return (
              <Card
                key={section.title}
                className="flex flex-col hover:shadow-lg transition-shadow"
              >
                <CardHeader>
                  <div className="bg-muted rounded-lg p-4 border border-border w-fit mb-2">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle>{section.title}</CardTitle>
                  <CardDescription>{section.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex items-end">
                  <Button asChild className="w-full">
                    <Link href={section.href}>Get Started</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
