import type { SerializableGuideSection } from "@/config/navigation";
import { GuideCard } from "./guide-card";
import type { PreviewVariant } from "./guide-preview";

interface GuideSectionGridProps {
  sections: SerializableGuideSection[];
}

/**
 * GuideSectionGrid - Server component for rendering guide sections
 * No client-side hooks needed - all data is pre-computed server-side
 */
export function GuideSectionGrid({ sections }: GuideSectionGridProps) {
  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <div key={section.title}>
          <h2 className="text-xl font-semibold mb-4 text-foreground">
            {section.title}
          </h2>
          <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            {section.items.map((guide, index) => {
              return (
                <div key={guide.slug}>
                  <GuideCard
                    title={guide.title}
                    description={guide.description}
                    href={`/${guide.slug}`}
                    previewVariant={guide.previewVariant as PreviewVariant}
                    previewImageIndexFile={guide.previewImageIndexFile}
                    languages={guide.languages}
                    tags={guide.tags}
                  />
                  {index < section.items.length - 1 && (
                    <div className="border-b border-border/50" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
