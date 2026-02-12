import type { SerializableGuideSection } from "@/config/navigation";
import { GuideCard } from "./guide-card";

interface GuideSectionGridProps {
  sections: SerializableGuideSection[];
}

/**
 * GuideSectionGrid - Server component for rendering guide sections
 * Displays guides in compact card format with icons
 */
export function GuideSectionGrid({ sections }: GuideSectionGridProps) {
  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="space-y-8">
      {sections.map((section, sectionIndex) => (
        <div key={section.title || `section-${sectionIndex}`}>
          {section.title && (
            <h2 className="text-lg font-semibold mb-4 text-muted-foreground">
              {section.title}
            </h2>
          )}
          <div className="rounded-xl border bg-card text-card-foreground shadow overflow-hidden">
            {section.items.map((guide, index) => {
              return (
                <div key={guide.slug}>
                  <GuideCard
                    title={guide.title}
                    description={guide.description}
                    href={`/${guide.slug}`}
                    iconName={guide.iconName}
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
