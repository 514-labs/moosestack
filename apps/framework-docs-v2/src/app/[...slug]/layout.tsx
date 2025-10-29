import type { ReactNode } from "react";
import { Suspense } from "react";
import { SideNav } from "@/components/navigation/side-nav";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { SidebarInset } from "@/components/ui/sidebar";

interface DocLayoutProps {
  children: ReactNode;
  params: Promise<{
    slug?: string[];
  }>;
}

export default async function DocLayout({
  children,
  params,
}: DocLayoutProps): Promise<ReactNode> {
  // SideNav now handles language filtering internally using the declarative config
  return (
    <AnalyticsProvider>
      <div className="flex flex-1">
        <Suspense fallback={<div className="w-64" />}>
          <SideNav />
        </Suspense>
        <SidebarInset>
          <div className="container flex-1 items-start py-6 lg:py-8">
            {/* Reserve space for the right TOC on xl+ screens */}
            <main className="relative xl:grid xl:grid-cols-[1fr_240px] lg:gap-10">
              {children}
            </main>
          </div>
        </SidebarInset>
      </div>
    </AnalyticsProvider>
  );
}
