import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getGuideIcon } from "./guide-icons";
import { LANGUAGE_DISPLAY_NAMES } from "./guide-constants";

interface GuideCardProps {
  title: string;
  description?: string;
  href: string;
  iconName?: string;
  languages?: string[];
  tags?: string[];
}

/**
 * GuideCard - Compact card component for guide navigation
 * Uses small icons instead of large preview images
 */
export function GuideCard({
  title,
  description,
  href,
  iconName,
  languages,
  tags,
}: GuideCardProps) {
  const IconComponent = getGuideIcon(iconName);

  // Combine languages and tags for badge display with type prefix for unique keys
  const badges = [
    ...(languages?.map((lang) => ({
      type: "lang" as const,
      label: LANGUAGE_DISPLAY_NAMES[lang] || lang,
    })) || []),
    ...(tags?.map((tag) => ({ type: "tag" as const, label: tag })) || []),
  ];

  return (
    <Link
      href={href}
      prefetch={true}
      className="group relative flex items-center gap-4 px-6 py-4 hover:bg-accent/50 transition-colors cursor-pointer"
    >
      {/* Icon */}
      {IconComponent && (
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted text-muted-foreground shrink-0">
          <IconComponent className="h-5 w-5" strokeWidth={1.5} />
        </div>
      )}

      {/* Content */}
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {badges.map((badge) => (
              <Badge
                key={`${badge.type}-${badge.label}`}
                variant="outline"
                className="bg-muted border-border text-muted-foreground text-xs"
              >
                {badge.label}
              </Badge>
            ))}
          </div>
        )}
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed truncate">
            {description}
          </p>
        )}
      </div>

      {/* Button - using asChild with span to avoid invalid <button> inside <a> */}
      <Button
        variant="default"
        size="sm"
        className="shrink-0 pointer-events-none"
        asChild
      >
        <span>Read</span>
      </Button>
    </Link>
  );
}
