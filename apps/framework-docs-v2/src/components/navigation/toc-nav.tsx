"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { Heading } from "@/lib/content-types";
import { IconExternalLink } from "@tabler/icons-react";

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
    if (headings.length === 0) return;

    // Find the active heading based on scroll position
    const findActiveHeading = () => {
      const root = document.documentElement;
      const windowHeight = window.innerHeight;
      const documentHeight = root.scrollHeight;
      const scrollTop = window.scrollY || root.scrollTop;

      // Get the scroll margin top from headings (matches CSS scrollMarginTop: 5rem)
      // This is the offset used when clicking anchor links, so we need to match it
      let scrollMarginTop = 80; // Default to 5rem (80px) if we can't detect it
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (el) {
          const computedStyle = getComputedStyle(el);
          const scrollMarginTopValue = computedStyle.scrollMarginTop;
          if (scrollMarginTopValue && scrollMarginTopValue !== "0px") {
            // Handle both px and rem units
            if (scrollMarginTopValue.endsWith("px")) {
              const parsed = parseFloat(scrollMarginTopValue.replace("px", ""));
              if (!Number.isNaN(parsed)) {
                scrollMarginTop = parsed;
                break; // Use the first valid value
              }
            } else if (scrollMarginTopValue.endsWith("rem")) {
              // Convert rem to px (1rem = 16px typically, but use root font size)
              const rootFontSize =
                parseFloat(getComputedStyle(root).fontSize) || 16;
              const remValue = parseFloat(
                scrollMarginTopValue.replace("rem", ""),
              );
              if (!Number.isNaN(remValue)) {
                scrollMarginTop = remValue * rootFontSize;
                break; // Use the first valid value
              }
            }
          }
        }
      }

      // If truly at the bottom, always highlight the last heading
      const isAtDocumentBottom = scrollTop + windowHeight >= documentHeight - 2;
      if (isAtDocumentBottom) {
        const last = [...headings]
          .reverse()
          .find((h) => document.getElementById(h.id));
        return last ? last.id : "";
      }

      // Check which heading is currently visible in the viewport
      // We use viewport coordinates (getBoundingClientRect) to check visibility
      // A heading is active if its top is at or above the scrollMarginTop line in the viewport
      const activeThreshold = scrollMarginTop;

      // Check headings from bottom to top to find the one that's currently in view
      // We want the heading whose top is closest to but above the threshold
      let activeIdLocal = headings[0]?.id || "";
      let closestDistance = Infinity;

      for (let i = headings.length - 1; i >= 0; i--) {
        const heading = headings[i]!;
        const el = document.getElementById(heading.id);
        if (!el) continue;

        const rect = el.getBoundingClientRect();
        const headingTopInViewport = rect.top;

        // Check if this heading is above or at the threshold
        if (headingTopInViewport <= activeThreshold) {
          // Calculate distance from threshold (negative means above, which is what we want)
          const distance = activeThreshold - headingTopInViewport;
          // We want the heading closest to the threshold (smallest positive distance)
          if (distance >= 0 && distance < closestDistance) {
            closestDistance = distance;
            activeIdLocal = heading.id;
          }
        }
      }

      return activeIdLocal;
    };

    const updateActiveHeading = () => {
      const newActiveId = findActiveHeading();
      if (newActiveId) {
        setActiveId(newActiveId);
      }
    };

    // Update on mount and scroll
    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });
    window.addEventListener("resize", updateActiveHeading, { passive: true });

    return () => {
      window.removeEventListener("scroll", updateActiveHeading);
      window.removeEventListener("resize", updateActiveHeading);
    };
  }, [headings]);

  if (headings.length === 0 && (!helpfulLinks || helpfulLinks.length === 0)) {
    return null;
  }

  return (
    <aside className="fixed top-[--header-height] right-0 z-30 hidden h-[calc(100vh-var(--header-height))] w-64 shrink-0 overflow-y-auto xl:block">
      <div className="pt-6 lg:pt-8 pb-6 pr-2">
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
                  <IconExternalLink className="ml-1 h-3 w-3" />
                </a>
              ))}
            </nav>
          </div>
        )}
      </div>
    </aside>
  );
}
