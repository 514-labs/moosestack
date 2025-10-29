import type { ReactNode } from "react";
import { TopNav } from "@/components/navigation/top-nav";
import { SideNav } from "@/components/navigation/side-nav";
import { buildNavigationTree } from "@/lib/content";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

export default function TypeScriptLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const navItems = buildNavigationTree("typescript");

  return (
    <AnalyticsProvider language="typescript">
      <div className="[--header-height:theme(spacing.14)]">
        <SidebarProvider className="flex flex-col">
          <TopNav language="typescript" />
          <div className="flex flex-1">
            <SideNav items={navItems} language="typescript" />
            <SidebarInset>
              <div className="container flex-1 items-start py-6 lg:py-8">
                {/* Reserve space for the right TOC on xl+ screens */}
                <main className="relative xl:grid xl:grid-cols-[1fr_240px] lg:gap-10">
                  {children}
                </main>
              </div>
            </SidebarInset>
          </div>
        </SidebarProvider>
      </div>
    </AnalyticsProvider>
  );
}
