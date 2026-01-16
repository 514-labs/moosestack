import type { Metadata } from "next";
import Link from "next/link";
import { IconBrandSlack } from "@tabler/icons-react";
import { showDraftGuides, showBetaGuides } from "@/flags";
import { getVisibleGuideSections } from "@/config/navigation";
import { GuidesComingSoon } from "@/components/guides/coming-soon";
import { GuideSectionGrid } from "@/components/guides/guide-section-grid";

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
  const hasVisibleGuides = sections.length > 0;

  return (
    <div className="flex w-full flex-col gap-8 pt-4">
      {hasVisibleGuides ?
        <>
          <div className="mb-2">
            <h1 className="text-3xl font-bold tracking-tight mb-2">Guides</h1>
            <p className="text-muted-foreground text-lg">
              Comprehensive guides for common application use cases powered by realtime 
              analytical infrastructure.
            </p>
          </div>
          <GuideSectionGrid sections={sections} />

          {/* More section */}
          <div className="flex flex-col gap-6 mt-4">
            <h2 className="text-2xl font-bold tracking-tight">More</h2>
            <div className="flex flex-col md:flex-row gap-4 rounded-xl border border-border/50 bg-card p-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 text-primary shrink-0">
                <IconBrandSlack className="h-6 w-6" strokeWidth={1.5} />
              </div>
              <div className="flex flex-col gap-3 flex-1">
                <h3 className="text-xl font-semibold text-foreground">
                  Join our Slack
                </h3>
                <p className="text-sm text-muted-foreground">
                  Get help from the community
                </p>
                <Link
                  href="https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 w-fit"
                >
                  Join
                </Link>
              </div>
            </div>
          </div>
        </>
      : <GuidesComingSoon />}
    </div>
  );
}
