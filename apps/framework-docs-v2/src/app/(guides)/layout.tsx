import type { ReactNode } from "react";
import { headers } from "next/headers";
import { AnalyticsProvider } from "@/components/analytics-provider";

interface GuidesLayoutProps {
  children: ReactNode;
}

export default async function GuidesLayout({ children }: GuidesLayoutProps) {
  // Access headers() to mark this layout as dynamic, which allows Date.now() usage
  // in the flags SDK without triggering Next.js static generation errors
  await headers();

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
