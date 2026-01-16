"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { IconArrowRight, type IconProps } from "@tabler/icons-react";
import { useLanguage } from "@/hooks/use-language";

interface GuideCardProps {
  title: string;
  description?: string;
  href: string;
  icon?: React.ComponentType<IconProps>;
}

export function GuideCard({
  title,
  description,
  href,
  icon: Icon,
}: GuideCardProps) {
  const searchParams = useSearchParams();
  const { language } = useLanguage();

  const buildUrl = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", language);
    return `${href}?${params.toString()}`;
  };

  return (
    <Link
      href={buildUrl()}
      className="group relative flex flex-col gap-3 rounded-xl border border-border/50 bg-card p-5 transition-all hover:border-primary/30 hover:bg-accent/50 hover:shadow-md"
    >
      {Icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" strokeWidth={1.5} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors flex items-center gap-2">
          {title}
          <IconArrowRight className="h-4 w-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
        </h3>
        {description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {description}
          </p>
        )}
      </div>
    </Link>
  );
}
