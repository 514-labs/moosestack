import type { Metadata } from "next";
import Link from "next/link";
import { IconBrandSlack } from "@tabler/icons-react";
import { showDraftGuides, showBetaGuides } from "@/flags";
import {
  getVisibleGuideSections,
  type SerializableGuideSection,
} from "@/config/navigation";
import { GuidesComingSoon } from "@/components/guides/coming-soon";
import { GuideSectionGrid } from "@/components/guides/guide-section-grid";
import { TemplatesCTA } from "@/components/guides/templates-cta";
import { Button } from "@/components/ui/button";
import { parseMarkdownContent } from "@/lib/content";

export const metadata: Metadata = {
  title: "Guides | MooseStack Documentation",
  description:
    "A complex blueprint to walk a developer or team of developers through how to deliver a solution using fiveonefour products (and external dependencies).",
};

export default async function GuidesPage() {
  // Check which guide levels should be shown
  const [showDraft, showBeta] = await Promise.all([
    showDraftGuides().catch(() => false),
    showBetaGuides().catch(() => false),
  ]);

  // Get visible guide sections based on flags
  const sections = getVisibleGuideSections({
    showDraftGuides: showDraft,
    showBetaGuides: showBeta,
  });

  // Load frontmatter for each guide to get languages and tags
  const sectionsWithFrontmatter: SerializableGuideSection[] = await Promise.all(
    sections.map(async (section) => {
      const itemsWithFrontmatter = await Promise.all(
        section.items.map(async (guide) => {
          try {
            const content = await parseMarkdownContent(guide.slug);
            return {
              ...guide,
              previewVariant: content.frontMatter.previewVariant as
                | string
                | undefined,
              previewImageIndexFile: content.frontMatter
                .previewImageIndexFile as string | undefined,
              languages: content.frontMatter.languages as string[] | undefined,
              tags: content.frontMatter.tags as string[] | undefined,
            };
          } catch (error) {
            console.error(
              `Failed to load frontmatter for ${guide.slug}:`,
              error,
            );
            return guide;
          }
        }),
      );
      return {
        ...section,
        items: itemsWithFrontmatter,
      };
    }),
  );

  const hasVisibleGuides = sectionsWithFrontmatter.length > 0;

  if (!hasVisibleGuides) {
    return <GuidesComingSoon />;
  }

  return (
    <>
      {/* Main content - first grid column */}
      <div className="flex flex-col gap-8">
        {/* Page header */}
        <div className="mb-2">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Guides</h1>
          <p className="text-muted-foreground text-lg">
            Comprehensive guides for common application use cases powered by
            realtime analytical infrastructure.
          </p>
        </div>

        {/* Guides sections */}
        <GuideSectionGrid sections={sectionsWithFrontmatter} />

        {/* More section */}
        <div className="flex flex-col gap-6 mt-4">
          <h2 className="text-2xl font-bold tracking-tight">More</h2>
          <div className="flex items-center gap-4 rounded-xl border border-border/50 bg-card px-6 py-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 text-primary shrink-0">
              <IconBrandSlack className="h-6 w-6" strokeWidth={1.5} />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <h3 className="text-xl font-semibold text-foreground">
                Join our Slack
              </h3>
              <p className="text-sm text-muted-foreground">
                Get help from the community
              </p>
            </div>
            <Button variant="default" asChild className="shrink-0">
              <Link
                href="https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg"
                target="_blank"
                rel="noopener noreferrer"
              >
                Join
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Sidebar - second grid column */}
      <aside className="hidden xl:block">
        <div className="sticky top-24 flex flex-col gap-6">
          <h2 className="text-xl font-semibold">More</h2>
          <TemplatesCTA />
        </div>
      </aside>
    </>
  );
}
