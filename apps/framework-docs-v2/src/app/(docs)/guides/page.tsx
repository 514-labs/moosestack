import type { Metadata } from "next";
import { showDraftGuides, showBetaGuides } from "@/flags";
import { getVisibleGuideSections } from "@/config/navigation";
import { GuidesComingSoon } from "@/components/guides/coming-soon";
import { GuideSectionGrid } from "@/components/guides/guide-section-grid";

export const metadata: Metadata = {
  title: "Guides | MooseStack Documentation",
  description:
    "Comprehensive guides for building applications, managing data, and implementing data warehousing strategies",
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
    <>
      <div className="flex w-full flex-col gap-6 pt-4">
        {hasVisibleGuides ?
          <>
            <div className="mb-2">
              <h1 className="text-3xl font-bold tracking-tight mb-2">Guides</h1>
              <p className="text-muted-foreground text-lg">
                Comprehensive guides for building applications, managing data,
                and implementing data warehousing strategies.
              </p>
            </div>
            <GuideSectionGrid sections={sections} />
          </>
        : <GuidesComingSoon />}
      </div>
      {/* No TOC needed for guides index */}
      <div className="hidden xl:block" />
    </>
  );
}
