import type { ReactNode } from "react";
import { Suspense } from "react";
import { SideNavServer } from "@/components/navigation/side-nav-server";
import { SidebarInset } from "@/components/ui/sidebar";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { GuideSettingsProvider } from "@/contexts/guide-settings-context";
import { GlobalGuideSettingsPanel } from "@/components/mdx/interactive/global-guide-settings-panel";

interface DocLayoutProps {
  children: ReactNode;
}

export default function DocLayout({ children }: DocLayoutProps) {
  return (
    <AnalyticsProvider>
      <GuideSettingsProvider>
        <div className="flex flex-1">
          <Suspense fallback={<div className="w-64" />}>
            <SideNavServer />
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
        <GlobalGuideSettingsPanel />
      </GuideSettingsProvider>
    </AnalyticsProvider>
  );
}
