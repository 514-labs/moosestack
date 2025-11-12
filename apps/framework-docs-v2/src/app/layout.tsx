import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import "@/styles/globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProviderWrapper } from "@/components/language-provider-wrapper";
import { TopNav } from "@/components/navigation/top-nav";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { ScrollRestoration } from "@/components/scroll-restoration";
import { getGitHubStars } from "@/lib/github-stars";
import { showHostingSection, showGuidesSection, showAiSection } from "@/flags";
import { VercelToolbar } from "@vercel/toolbar/next";

export const metadata: Metadata = {
  title: "MooseStack Documentation",
  description: "Build data-intensive applications with MooseStack",
};

// Force dynamic to enable cookie-based flag overrides
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const stars = await getGitHubStars();

  // Evaluate feature flags (reads cookies automatically for overrides)
  const [showHosting, showGuides, showAi] = await Promise.all([
    showHostingSection().catch(() => false),
    showGuidesSection().catch(() => false),
    showAiSection().catch(() => true),
  ]);

  const shouldInjectToolbar = process.env.NODE_ENV === "development";

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ScrollRestoration />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Suspense fallback={null}>
            <LanguageProviderWrapper>
              <SidebarProvider className="flex flex-col">
                <div className="[--header-height:theme(spacing.14)]">
                  <Suspense fallback={<div className="h-14" />}>
                    <TopNav
                      stars={stars}
                      showHosting={showHosting}
                      showGuides={showGuides}
                      showAi={showAi}
                    />
                  </Suspense>
                  {children}
                </div>
              </SidebarProvider>
            </LanguageProviderWrapper>
          </Suspense>
          <Toaster position="top-center" />
        </ThemeProvider>
        {shouldInjectToolbar && <VercelToolbar />}
      </body>
    </html>
  );
}
