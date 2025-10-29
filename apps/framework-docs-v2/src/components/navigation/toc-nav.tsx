"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { Heading } from "@/lib/content-types";
import { ExternalLink } from "lucide-react";

interface TOCNavProps {
  headings: Heading[];
  helpfulLinks?: Array<{
    title: string;
    url: string;
  }>;
}

export function TOCNav({ headings, helpfulLinks }: TOCNavProps) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: "0% 0% -80% 0%" },
    );

    headings.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0 && (!helpfulLinks || helpfulLinks.length === 0)) {
    return null;
  }

  return (
    <aside className="fixed top-14 right-0 z-30 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto xl:block">
      <div className="py-6 px-4">
        {headings.length > 0 && (
          <div className="mb-6">
            <h4 className="mb-3 text-sm font-semibold">On this page</h4>
            <nav className="space-y-2">
              {headings.map((heading) => (
                <a
                  key={heading.id}
                  href={`#${heading.id}`}
                  className={cn(
                    "block text-sm transition-colors hover:text-foreground",
                    heading.level === 3 && "pl-4",
                    activeId === heading.id ?
                      "text-foreground font-medium"
                    : "text-muted-foreground",
                  )}
                >
                  {heading.text}
                </a>
              ))}
            </nav>
          </div>
        )}

        {helpfulLinks && helpfulLinks.length > 0 && (
          <div>
            <h4 className="mb-3 text-sm font-semibold">Helpful links</h4>
            <nav className="space-y-2">
              {helpfulLinks.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.title}
                  <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              ))}
            </nav>
          </div>
        )}
      </div>
    </aside>
  );
}
