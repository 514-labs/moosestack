import type { ReactNode } from "react";
import { Suspense } from "react";
import { headers } from "next/headers";
import { SideNav } from "@/components/navigation/side-nav";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { SidebarInset } from "@/components/ui/sidebar";
import { showDataSourcesPage } from "@/flags";

interface DocLayoutProps {
  children: ReactNode;
}

async function FilteredSideNav() {
  // Evaluate feature flag
  // Note: Accessing headers() in the parent component marks this as dynamic,
  // which allows Date.now() usage in the flags SDK
  const showDataSources = await showDataSourcesPage().catch(() => false);

  // Pass flag to SideNav, which will filter navigation items after language filtering
  return <SideNav flags={{ showDataSourcesPage: showDataSources }} />;
}

export default async function DocLayout({ children }: DocLayoutProps) {
  // Access headers() to mark this layout as dynamic, which allows Date.now() usage
  // in the flags SDK without triggering Next.js static generation errors
  await headers();
  return (
    <AnalyticsProvider>
      <div className="flex flex-1">
        <Suspense fallback={<div className="w-64" />}>
          <FilteredSideNav />
        </Suspense>
        <SidebarInset>
          <div className="container flex-1 pt-6 pb-12 lg:pt-8">
            {/* Reserve space for the right TOC on xl+ screens */}
            <main className="relative flex flex-col gap-10 xl:grid xl:grid-cols-[minmax(0,1fr)_240px] xl:gap-12">
              {children}
            </main>
          </div>
        </SidebarInset>
      </div>
    </AnalyticsProvider>
  );
}
