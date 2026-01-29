import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getGuideIcon } from "./guide-icons";

interface GuideCardProps {
  title: string;
  description?: string;
  href: string;
  iconName?: string;
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
}: GuideCardProps) {
  const IconComponent = getGuideIcon(iconName);

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
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed truncate">
            {description}
          </p>
        )}
      </div>

      {/* Button */}
      <Button
        variant="default"
        size="sm"
        className="shrink-0 pointer-events-none"
      >
        Read
      </Button>
    </Link>
  );
}
