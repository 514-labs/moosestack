import type { ReactNode } from "react";
import { Suspense } from "react";
import { SideNavServer } from "@/components/navigation/side-nav-server";
import { SidebarInset } from "@/components/ui/sidebar";
import { AnalyticsProvider } from "@/components/analytics-provider";

interface DocLayoutProps {
  children: ReactNode;
}

export default function DocLayout({ children }: DocLayoutProps) {
  return (
    <AnalyticsProvider>
      <div className="flex flex-1 min-w-0 w-full overflow-hidden">
        <Suspense fallback={<div className="w-64" />}>
          <SideNavServer />
        </Suspense>
        <SidebarInset>
          <div className="w-full min-w-0 flex-1 pt-6 pb-12 lg:pt-8 px-4 sm:px-6 lg:px-8 overflow-x-hidden">
            {/* Reserve space for the right TOC on xl+ screens */}
            <main className="relative flex flex-col gap-10 xl:grid xl:grid-cols-[minmax(0,1fr)_240px] xl:gap-12 min-w-0 w-full max-w-5xl mx-auto">
              {children}
            </main>
          </div>
        </SidebarInset>
      </div>
    </AnalyticsProvider>
  );
}
