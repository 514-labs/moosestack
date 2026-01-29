import { getGuideIcon } from "./guide-icons";
import { Badge } from "@/components/ui/badge";

const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  typescript: "TypeScript",
  python: "Python",
};

interface GuideHeaderProps {
  iconName?: string;
  languages?: string[];
  tags?: string[];
}

/**
 * GuideHeader - Displays icon and badges for a guide detail page
 * Matches the visual style of guide cards on the listing page
 */
export function GuideHeader({ iconName, languages, tags }: GuideHeaderProps) {
  const IconComponent = getGuideIcon(iconName);

  // Combine languages and tags for badge display
  const badges = [
    ...(languages?.map((lang) => ({
      type: "lang" as const,
      label: LANGUAGE_DISPLAY_NAMES[lang] || lang,
    })) || []),
    ...(tags?.map((tag) => ({ type: "tag" as const, label: tag })) || []),
  ];

  // If no icon and no badges, don't render anything
  if (!IconComponent && badges.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-4 mb-4">
      {IconComponent && (
        <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-muted text-muted-foreground shrink-0">
          <IconComponent className="h-6 w-6" strokeWidth={1.5} />
        </div>
      )}
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {badges.map((badge) => (
            <Badge
              key={`${badge.type}-${badge.label}`}
              variant="outline"
              className="bg-muted border-border text-muted-foreground"
            >
              {badge.label}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
