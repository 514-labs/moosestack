"use client";

import { useEffect, useState, useRef } from "react";
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
  const intersectingIdRef = useRef<string>("");
  const isAtBottomRef = useRef<boolean>(false);
  const intersectingIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (headings.length === 0) return;

    // Reset intersecting IDs when headings change
    intersectingIdsRef.current.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        // Update the set of intersecting headings
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            intersectingIdsRef.current.add(entry.target.id);
          } else {
            intersectingIdsRef.current.delete(entry.target.id);
          }
        });

        // Find the most recently intersecting heading (last in DOM order)
        // This ensures we highlight the heading closest to the viewport top
        let mostRecentId = "";
        let mostRecentIndex = -1;

        intersectingIdsRef.current.forEach((id) => {
          const index = headings.findIndex((h) => h.id === id);
          if (index > mostRecentIndex) {
            mostRecentIndex = index;
            mostRecentId = id;
          }
        });

        intersectingIdRef.current = mostRecentId;

        // Only update activeId from IntersectionObserver if we're not in bottom mode
        // or if there are intersecting headings
        if (mostRecentId && !isAtBottomRef.current) {
          setActiveId(mostRecentId);
        }
      },
      { rootMargin: "0% 0% -80% 0%" },
    );

    headings.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
      }
    });

    // Check if we're at the bottom of the page
    const checkBottomScroll = () => {
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;

      const lastHeading = headings[headings.length - 1];
      if (!lastHeading) return;

      const lastElement = document.getElementById(lastHeading.id);
      if (!lastElement) return;

      // Check if the last heading is currently intersecting
      const isLastHeadingIntersecting = intersectingIdsRef.current.has(
        lastHeading.id,
      );

      // Check if we're near the document bottom
      const isNearDocumentBottom =
        scrollTop + windowHeight >= documentHeight - 100;

      // Only activate bottom mode if:
      // 1. We're near the document bottom
      // 2. AND the last heading is NOT currently intersecting (we've scrolled past it)
      isAtBottomRef.current =
        isNearDocumentBottom && !isLastHeadingIntersecting;

      if (isAtBottomRef.current) {
        setActiveId(lastHeading.id);
      } else if (intersectingIdRef.current) {
        // If not at bottom and we have an intersecting heading, use it
        setActiveId(intersectingIdRef.current);
      }
    };

    // Check on mount and scroll
    checkBottomScroll();
    window.addEventListener("scroll", checkBottomScroll, { passive: true });
    window.addEventListener("resize", checkBottomScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", checkBottomScroll);
      window.removeEventListener("resize", checkBottomScroll);
    };
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
