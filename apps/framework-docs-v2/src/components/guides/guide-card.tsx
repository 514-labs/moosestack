import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GuidePreview, type PreviewVariant } from "./guide-preview";

const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  typescript: "TypeScript",
  python: "Python",
};

interface GuideCardProps {
  title: string;
  description?: string;
  href: string;
  previewVariant?: PreviewVariant;
  previewImageIndexFile?: string;
  languages?: string[];
  tags?: string[];
}

/**
 * GuideCard - Server component for guide navigation cards
 * Uses static hrefs for optimal prefetching and no client-side hydration delays
 */
export function GuideCard({
  title,
  description,
  href,
  previewVariant,
  previewImageIndexFile,
  languages,
  tags,
}: GuideCardProps) {
  // Combine languages and tags for badge display
  const badges = [
    ...(languages?.map((lang) => ({
      type: "lang",
      label: LANGUAGE_DISPLAY_NAMES[lang] || lang,
    })) || []),
    ...(tags?.map((tag) => ({ type: "tag", label: tag })) || []),
  ];

  return (
    <Link
      href={href}
      prefetch={true}
      className="group relative flex flex-col md:flex-row md:items-center gap-4 px-6 py-4 hover:bg-accent/50 transition-colors cursor-pointer"
    >
      {/* Preview: Full width header on mobile, left media on desktop */}
      <GuidePreview
        variant={previewVariant}
        imagePath={previewImageIndexFile}
        title={title}
      />

      {/* Content: Full width on mobile, flex-1 on desktop */}
      <div className="flex flex-1 flex-col gap-2">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {badges.map((badge) => (
              <Badge
                key={`${badge.type}-${badge.label}`}
                variant="outline"
                className="bg-muted border-neutral-700 text-foreground"
              >
                {badge.label}
              </Badge>
            ))}
          </div>
        )}
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}

        {/* Button: Inline on mobile, separate on desktop */}
        <div className="md:hidden mt-2">
          <Button variant="default" className="pointer-events-none">
            Read
          </Button>
        </div>
      </div>

      {/* Button: Side-aligned on desktop only */}
      <Button
        variant="default"
        className="hidden md:block shrink-0 pointer-events-none"
      >
        Read
      </Button>
    </Link>
  );
}
