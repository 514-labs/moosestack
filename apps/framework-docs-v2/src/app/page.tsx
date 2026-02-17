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
  IconCompass,
} from "@tabler/icons-react";
import { getNavVariant } from "@/lib/nav-variant";

export default function HomePage() {
  // Use build-time variant (same approach as guides page)
  const variant = getNavVariant();
  const showAi = variant !== "base";

  const sections = [
    {
      title: "MooseStack",
      description:
        "Open-source, OLAP-native agent harness for designing, validating, and shipping analytical systems as code.",
      href: `/moosestack`,
      icon: IconDatabase,
    },
    {
      title: "Hosting",
      description:
        "Managed cloud control plane that lets AI agents run, test, and monitor workloads consistently across preview branches and production deployments.",
      href: `/hosting`,
      icon: IconCloud,
    },
    {
      title: "Guides",
      description:
        "Step-by-step guides for building real applications with MooseStack, from dashboards to chat.",
      href: `/guides`,
      icon: IconCompass,
    },
    {
      title: "Templates",
      description:
        "Browse ready-to-use templates and example applications to jumpstart your MooseStack project.",
      href: `/templates`,
      icon: IconCode,
    },
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

  return (
    <div className="container mx-auto px-4 py-12 md:py-16">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center md:mb-12">
          <h1 className="text-4xl font-bold mb-4">Documentation</h1>
        </div>

        {/* Center the last card on md+ when count is odd */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:[&>*:last-child:nth-child(odd)]:mx-auto md:[&>*:last-child:nth-child(odd)]:max-w-md md:[&>*:last-child:nth-child(odd)]:col-span-2">
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
