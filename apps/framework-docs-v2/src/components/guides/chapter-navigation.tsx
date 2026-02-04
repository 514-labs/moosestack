"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface Chapter {
  id: string;
  title: string;
  subtitle?: string;
}

interface ChapterNavigationProps {
  chapters: Chapter[];
  currentChapter: number;
  onChapterChange: (index: number) => void;
  className?: string;
}

export function ChapterNavigation({
  chapters,
  currentChapter,
  onChapterChange,
  className,
}: ChapterNavigationProps) {
  return (
    <nav className={cn("w-full", className)}>
      {/* Elegant horizontal chapter tabs */}
      <div className="flex items-center justify-center gap-0">
        {chapters.map((chapter, index) => {
          const isActive = index === currentChapter;
          const chapterNumber = index;

          return (
            <button
              key={chapter.id}
              onClick={() => onChapterChange(index)}
              className={cn(
                "group relative px-8 py-4 text-sm tracking-wide transition-all duration-300",
                "border-b-2",
                isActive ?
                  "border-foreground text-foreground"
                : "border-transparent text-muted-foreground/60 hover:text-muted-foreground hover:border-muted-foreground/30",
              )}
            >
              {/* Chapter number */}
              <span
                className={cn(
                  "mr-2 font-mono text-xs transition-opacity duration-300",
                  isActive ? "opacity-60" : "opacity-40 group-hover:opacity-50",
                )}
              >
                {chapterNumber}.
              </span>

              {/* Chapter title */}
              <span className="font-medium">{chapter.title}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

interface ChapterGuideProps {
  chapters: Chapter[];
  children: React.ReactNode[];
  className?: string;
}

export function ChapterGuide({
  chapters,
  children,
  className,
}: ChapterGuideProps) {
  const [currentChapter, setCurrentChapter] = React.useState(0);
  const [isTransitioning, setIsTransitioning] = React.useState(false);

  // Sync with URL hash
  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const hash = window.location.hash.slice(1);
    if (hash) {
      const index = chapters.findIndex((c) => c.id === hash);
      if (index >= 0) {
        setCurrentChapter(index);
      }
    }
  }, [chapters]);

  // Handle chapter change with smooth transition
  const handleChapterChange = React.useCallback(
    (index: number) => {
      if (index === currentChapter) return;

      setIsTransitioning(true);

      // Short delay for fade out
      setTimeout(() => {
        setCurrentChapter(index);
        const chapter = chapters[index];
        if (chapter) {
          window.history.replaceState(null, "", `#${chapter.id}`);
        }
        // Scroll to top smoothly
        window.scrollTo({ top: 0, behavior: "smooth" });

        // Fade back in
        setTimeout(() => setIsTransitioning(false), 50);
      }, 150);
    },
    [chapters, currentChapter],
  );

  const currentChapterData = chapters[currentChapter];

  return (
    <div className={cn("w-full", className)}>
      {/* Navigation */}
      <ChapterNavigation
        chapters={chapters}
        currentChapter={currentChapter}
        onChapterChange={handleChapterChange}
        className="mb-12"
      />

      {/* Chapter subtitle */}
      {currentChapterData?.subtitle && (
        <p
          className={cn(
            "text-center text-sm text-muted-foreground mb-12 transition-opacity duration-300",
            isTransitioning ? "opacity-0" : "opacity-100",
          )}
        >
          {currentChapterData.subtitle}
        </p>
      )}

      {/* Chapter content with fade transition */}
      <div
        className={cn(
          "transition-opacity duration-300",
          isTransitioning ? "opacity-0" : "opacity-100",
        )}
      >
        {children[currentChapter]}
      </div>

      {/* Bottom navigation - minimal and elegant */}
      <div className="mt-24 pt-12 border-t border-border/50">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          {currentChapter > 0 ?
            <button
              onClick={() => handleChapterChange(currentChapter - 1)}
              className="group flex flex-col items-start gap-1 text-left transition-opacity hover:opacity-70"
            >
              <span className="text-xs text-muted-foreground/60 uppercase tracking-widest">
                Previous
              </span>
              <span className="text-sm text-muted-foreground">
                <span className="font-mono text-xs mr-1 opacity-50">
                  {currentChapter - 1}.
                </span>
                {chapters[currentChapter - 1]?.title}
              </span>
            </button>
          : <div />}

          {/* Page indicator dots */}
          <div className="flex items-center gap-2">
            {chapters.map((_, index) => (
              <button
                key={index}
                onClick={() => handleChapterChange(index)}
                className={cn(
                  "w-2 h-2 rounded-full transition-all duration-300",
                  index === currentChapter ?
                    "bg-foreground scale-100"
                  : "bg-muted-foreground/30 scale-75 hover:scale-90 hover:bg-muted-foreground/50",
                )}
                aria-label={`Go to chapter ${index}`}
              />
            ))}
          </div>

          {currentChapter < chapters.length - 1 ?
            <button
              onClick={() => handleChapterChange(currentChapter + 1)}
              className="group flex flex-col items-end gap-1 text-right transition-opacity hover:opacity-70"
            >
              <span className="text-xs text-muted-foreground/60 uppercase tracking-widest">
                Next
              </span>
              <span className="text-sm text-muted-foreground">
                <span className="font-mono text-xs mr-1 opacity-50">
                  {currentChapter + 1}.
                </span>
                {chapters[currentChapter + 1]?.title}
              </span>
            </button>
          : <div />}
        </div>
      </div>
    </div>
  );
}

// Context for nested chapter access
interface ChapterContextValue {
  currentChapter: number;
  chapters: Chapter[];
  goToChapter: (index: number) => void;
}

export const ChapterContext = React.createContext<ChapterContextValue | null>(
  null,
);

export function useChapterContext() {
  return React.useContext(ChapterContext);
}
