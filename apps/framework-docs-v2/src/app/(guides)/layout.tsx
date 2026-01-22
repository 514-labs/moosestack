import type { ReactNode } from "react";
import { AnalyticsProvider } from "@/components/analytics-provider";

interface GuidesLayoutProps {
  children: ReactNode;
}

export default function GuidesLayout({ children }: GuidesLayoutProps) {
  return (
    <AnalyticsProvider>
      <div className="flex flex-1 justify-center">
        <div className="w-full max-w-4xl px-8">
          <div className="pt-6 pb-12 lg:pt-8">
            <main className="relative">{children}</main>
          </div>
        </div>
      </div>
    </AnalyticsProvider>
  );
}
