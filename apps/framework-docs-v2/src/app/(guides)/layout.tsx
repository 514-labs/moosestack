import type { ReactNode } from "react";
import { AnalyticsProvider } from "@/components/analytics-provider";

interface GuidesLayoutProps {
  children: ReactNode;
}

export default function GuidesLayout({ children }: GuidesLayoutProps) {
  return (
    <AnalyticsProvider>
      <div className="flex flex-1 justify-center min-w-0">
        <div className="w-full max-w-5xl lg:max-w-6xl px-4 sm:px-6 lg:px-8 min-w-0">
          <div className="pt-6 pb-12 lg:pt-8">
            <main className="relative min-w-0">{children}</main>
          </div>
        </div>
      </div>
    </AnalyticsProvider>
  );
}
