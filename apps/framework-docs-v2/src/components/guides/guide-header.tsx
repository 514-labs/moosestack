import { getGuideIcon } from "./guide-icons";
import { Badge } from "@/components/ui/badge";
import { LANGUAGE_DISPLAY_NAMES } from "./guide-constants";

interface GuideIconProps {
  iconName?: string;
}

/**
 * GuideIcon - Displays just the icon above the title
 */
export function GuideIcon({ iconName }: GuideIconProps) {
  const IconComponent = getGuideIcon(iconName);

  if (!IconComponent) {
    return null;
  }

  return (
    <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-muted text-muted-foreground shrink-0">
      <IconComponent className="h-6 w-6" strokeWidth={1.5} />
    </div>
  );
}

interface GuideBadgesProps {
  languages?: string[];
  tags?: string[];
}

/**
 * GuideBadges - Displays language and tag badges below the title
 * Uses the standard Badge component
 */
export function GuideBadges({ languages, tags }: GuideBadgesProps) {
  const badges = [
    ...(languages?.map((lang) => ({
      type: "lang" as const,
      label: LANGUAGE_DISPLAY_NAMES[lang] || lang,
    })) || []),
    ...(tags?.map((tag) => ({ type: "tag" as const, label: tag })) || []),
  ];

  if (badges.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 mt-4 mb-4">
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
  );
}
