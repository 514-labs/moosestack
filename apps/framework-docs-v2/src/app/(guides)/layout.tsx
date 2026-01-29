import type { ReactNode } from "react";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { SidebarInset } from "@/components/ui/sidebar";

interface GuidesLayoutProps {
  children: ReactNode;
}

export default function GuidesLayout({ children }: GuidesLayoutProps) {
  return (
    <AnalyticsProvider>
      <div className="flex flex-1 min-w-0 w-full overflow-hidden">
        <SidebarInset>
          <div className="w-full min-w-0 flex-1 pt-6 pb-12 lg:pt-8 px-4 sm:px-6 lg:px-8 overflow-x-hidden">
            <main className="relative flex flex-col gap-10 min-w-0 w-full max-w-3xl lg:max-w-4xl mx-auto">
              {children}
            </main>
          </div>
        </SidebarInset>
      </div>
    </AnalyticsProvider>
  );
}
