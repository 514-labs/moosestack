import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconDatabase, IconCloud, IconSparkles } from "@tabler/icons-react";
import { showHostingSection, showAiSection } from "@/flags";
import { cn } from "@/lib/utils";

// export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Evaluate feature flags
  const [showHosting, showAi] = await Promise.all([
    showHostingSection().catch(() => false),
    showAiSection().catch(() => true),
  ]);

  // Calculate number of visible cards based on flags
  // MooseStack is always visible (1), plus conditional cards
  const cardCount = 1 + (showHosting ? 1 : 0) + (showAi ? 1 : 0);

  const sections = [
    {
      title: "MooseStack",
      description:
        "The core framework for building data applications with OLAP, streaming, workflows, and APIs.",
      href: `/moosestack`,
      icon: IconDatabase,
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

  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-4xl mx-auto">
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
          })}
        >
          {sections.map((section) => {
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
