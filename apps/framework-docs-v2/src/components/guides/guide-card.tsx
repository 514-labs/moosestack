"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLanguage } from "@/hooks/use-language";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GuidePreview } from "./guide-preview";

type PreviewVariant =
  | "chat"
  | "performance"
  | "dashboards"
  | "migrations"
  | "cdp"
  | "production";

interface GuideCardProps {
  title: string;
  description?: string;
  href: string;
  previewVariant?: PreviewVariant;
  previewImageIndexFile?: string;
  languages?: string[];
  tags?: string[];
}

export function GuideCard({
  title,
  description,
  href,
  previewVariant,
  previewImageIndexFile,
  languages,
  tags,
}: GuideCardProps) {
  const searchParams = useSearchParams();
  const { language } = useLanguage();

  const buildUrl = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", language);
    return `${href}?${params.toString()}`;
  };

  // Map language codes to display names
  const languageDisplayNames: Record<string, string> = {
    typescript: "TypeScript",
    python: "Python",
  };

  // Combine languages and tags for badge display
  const badges = [
    ...(languages?.map((lang) => languageDisplayNames[lang] || lang) || []),
    ...(tags || []),
  ];

  return (
    <Link
      href={buildUrl()}
      className="group relative flex items-center gap-4 px-6 py-4 hover:bg-accent/50 transition-colors cursor-pointer"
    >
      <GuidePreview
        variant={previewVariant}
        imagePath={previewImageIndexFile}
        title={title}
      />
      <div className="flex flex-1 flex-col gap-2">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {badges.map((badge) => (
              <Badge
                key={badge}
                variant="outline"
                className="bg-neutral-800 border-neutral-700 text-white"
              >
                {badge}
              </Badge>
            ))}
          </div>
        )}
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <Button variant="default" className="shrink-0 pointer-events-none">
        Read
      </Button>
    </Link>
  );
}
