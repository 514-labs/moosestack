"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { IconBook, type IconProps } from "@tabler/icons-react";
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
      className="group relative flex flex-col gap-6 rounded-xl border border-border/50 bg-card p-8 transition-all hover:border-primary/30 hover:bg-accent/50 cursor-pointer"
    >
      {Icon && (
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-muted">
          <Icon className="h-10 w-10 text-foreground" strokeWidth={1.5} />
        </div>
      )}
      <div className="flex flex-col gap-4">
        <h3 className="text-2xl font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-base text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors group-hover:bg-accent w-fit">
        <IconBook className="h-4 w-4" strokeWidth={2} />
        Start Guide
      </div>
    </Link>
  );
}
