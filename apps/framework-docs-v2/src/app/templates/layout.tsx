import type { ReactNode } from "react";
import { Suspense } from "react";
import { TemplatesSideNav } from "./templates-side-nav";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { SidebarInset } from "@/components/ui/sidebar";

interface TemplatesLayoutProps {
  children: ReactNode;
}

export default async function TemplatesLayout({
  children,
}: TemplatesLayoutProps) {
  return (
    <AnalyticsProvider>
      <div className="flex flex-1">
        <Suspense fallback={<div className="w-64" />}>
          <TemplatesSideNav />
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
