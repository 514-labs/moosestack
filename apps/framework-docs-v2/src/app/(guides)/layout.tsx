import type { ReactNode } from "react";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { GuideSettingsProvider } from "@/contexts/guide-settings-context";
import { GlobalGuideSettingsPanel } from "@/components/mdx/interactive/global-guide-settings-panel";

interface GuidesLayoutProps {
  children: ReactNode;
}

export default function GuidesLayout({ children }: GuidesLayoutProps) {
  return (
    <AnalyticsProvider>
      <GuideSettingsProvider>
        <div className="flex flex-1 justify-center">
          <div className="w-full max-w-4xl px-8">
            <div className="pt-6 pb-12 lg:pt-8">
              <main className="relative">{children}</main>
            </div>
          </div>
        </div>
        <GlobalGuideSettingsPanel />
      </GuideSettingsProvider>
    </AnalyticsProvider>
  );
}
