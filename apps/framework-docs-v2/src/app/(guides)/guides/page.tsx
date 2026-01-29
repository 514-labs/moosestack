import type { Metadata } from "next";
import Link from "next/link";
import { IconBrandSlack } from "@tabler/icons-react";
import {
  getVisibleGuideSections,
  type SerializableGuideSection,
} from "@/config/navigation";
import { GuidesComingSoon } from "@/components/guides/coming-soon";
import { GuideSectionGrid } from "@/components/guides/guide-section-grid";
import { Button } from "@/components/ui/button";
import { getNavVariant } from "@/lib/nav-variant";
import { parseMarkdownContent } from "@/lib/content";

export const metadata: Metadata = {
  title: "Guides | MooseStack Documentation",
  description:
    "A complex blueprint to walk a developer or team of developers through how to deliver a solution using fiveonefour products (and external dependencies).",
};

export default async function GuidesPage() {
  // Use build-time variant instead of runtime flags
  const variant = getNavVariant();
  const showDraft = variant === "draft" || variant === "full";
  const showBeta = variant === "beta" || variant === "full";

  // Get visible guide sections based on variant
  const sections = getVisibleGuideSections({
    showDraftGuides: showDraft,
    showBetaGuides: showBeta,
  });

  // Load frontmatter for each guide to get preview data, languages, and tags
  const sectionsWithFrontmatter: SerializableGuideSection[] = await Promise.all(
    sections.map(async (section) => {
      const itemsWithFrontmatter = await Promise.all(
        section.items.map(async (guide) => {
          try {
            const content = await parseMarkdownContent(guide.slug);
            return {
              ...guide,
              previewVariant: content.frontMatter.previewVariant,
              previewImageIndexFile: content.frontMatter.previewImageIndexFile,
              languages: content.frontMatter.languages,
              tags: content.frontMatter.tags,
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
    <div className="flex w-full min-w-0 flex-col gap-6 pt-4">
      {/* Page header */}
      <article className="prose dark:prose-invert max-w-none w-full min-w-0">
        <h1>Guides</h1>
        <p>
          Comprehensive guides for common application use cases powered by
          realtime analytical infrastructure.
        </p>
      </article>

      {/* Guides sections */}
      <GuideSectionGrid sections={sectionsWithFrontmatter} />

      {/* More section */}
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-muted-foreground">More</h2>
        <div className="rounded-xl border bg-card text-card-foreground shadow overflow-hidden">
          <div className="flex items-center gap-4 px-6 py-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted text-muted-foreground shrink-0">
              <IconBrandSlack className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <h3 className="text-base font-semibold text-foreground">
                Join the Community
              </h3>
              <p className="text-sm text-muted-foreground">
                Ask questions or just join the conversation
              </p>
            </div>
            <Button variant="default" size="sm" asChild className="shrink-0">
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
    </div>
  );
}
