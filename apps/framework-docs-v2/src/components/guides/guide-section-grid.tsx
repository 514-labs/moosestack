import type { SerializableGuideSection } from "@/config/navigation";
import { getGuideIcon } from "./guide-icons";
import { GuideCard } from "./guide-card";

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
    <div className="space-y-10">
      {sections.map((section, index) => (
        <div key={section.title ?? `uncategorized-${index}`}>
          {section.title && (
            <h2 className="text-xl font-semibold mb-4 text-foreground">
              {section.title}
            </h2>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {section.items.map((guide) => {
              const IconComponent = getGuideIcon(guide.iconName);
              return (
                <GuideCard
                  key={guide.slug}
                  title={guide.title}
                  description={guide.description}
                  href={`/${guide.slug}`}
                  icon={IconComponent}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
