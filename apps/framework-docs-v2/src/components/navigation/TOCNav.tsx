"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Heading } from "@/lib/content";

interface TOCNavProps {
  headings: Heading[];
  helpfulLinks?: Array<{ title: string; url: string }>;
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

    // Observe all headings
    headings.forEach((heading) => {
      const element = document.getElementById(heading.id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => {
      observer.disconnect();
    };
  }, [headings]);

  if (headings.length === 0 && (!helpfulLinks || helpfulLinks.length === 0)) {
    return null;
  }

  return (
    <aside className="hidden xl:block w-64 border-l">
      <ScrollArea className="h-[calc(100vh-4rem)] py-6 px-4">
        {headings.length > 0 && (
          <div className="mb-6">
            <h4 className="text-sm font-semibold mb-3">On this page</h4>
            <nav className="space-y-2">
              {headings
                .filter((h) => h.level <= 3)
                .map((heading) => (
                  <Link
                    key={heading.id}
                    href={`#${heading.id}`}
                    className={cn(
                      "block text-sm transition-colors",
                      heading.level === 3 && "pl-4",
                      activeId === heading.id
                        ? "text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {heading.text}
                  </Link>
                ))}
            </nav>
          </div>
        )}

        {helpfulLinks && helpfulLinks.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-3">Helpful links</h4>
            <nav className="space-y-2">
              {helpfulLinks.map((link, index) => (
                <a
                  key={index}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {link.title}
                </a>
              ))}
            </nav>
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}

