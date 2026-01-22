import type { ReactNode } from "react";
import { headers } from "next/headers";
import { AnalyticsProvider } from "@/components/analytics-provider";

interface GuidesLayoutProps {
  children: ReactNode;
}

export default async function GuidesLayout({ children }: GuidesLayoutProps) {
  // Access headers() to mark this layout as dynamic, which allows Date.now() usage
  // in the flags SDK without triggering Next.js static generation errors
  await headers();

  return (
    <AnalyticsProvider>
      <div className="flex flex-1">
        {/* Invisible spacer to match sidebar width - compresses first before content */}
        <div className="hidden md:block flex-none lg:flex-[0_1_16rem] min-w-0" />
        <div className="flex-[1_0_48rem] min-w-[48rem]">
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
    </AnalyticsProvider>
  );
}
