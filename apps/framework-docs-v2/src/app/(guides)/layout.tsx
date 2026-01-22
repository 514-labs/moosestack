import type { ReactNode } from "react";

interface GuidesLayoutProps {
  children: ReactNode;
}

export default function GuidesLayout({ children }: GuidesLayoutProps) {
  return (
    <div className="flex flex-1">
      {/* Invisible spacer to match sidebar width */}
      <div className="w-64 shrink-0" />
      <div className="flex-1">
        <div className="container mx-auto pt-6 pb-12 lg:pt-8">
          {/* Match the grid layout of guide pages (reserves space for TOC on right) */}
          <main className="relative flex flex-col gap-10 xl:grid xl:grid-cols-[minmax(0,1fr)_240px] xl:gap-12">
            {children}
            {/* Empty TOC space to match guide page layout */}
            <div className="hidden xl:block" />
          </main>
        </div>
      </div>
    </div>
  );
}
