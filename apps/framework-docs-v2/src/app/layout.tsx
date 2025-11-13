import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import "@/styles/globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProviderWrapper } from "@/components/language-provider-wrapper";
import { TopNav } from "@/components/navigation/top-nav";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { getGitHubStars } from "@/lib/github-stars";

export const metadata: Metadata = {
  title: "MooseStack Documentation",
  description: "Build data-intensive applications with MooseStack",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  // Fetch GitHub stars on the server with caching
  const stars = await getGitHubStars();

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
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
                    <TopNav stars={stars} />
                  </Suspense>
                  {children}
                </div>
              </SidebarProvider>
            </LanguageProviderWrapper>
          </Suspense>
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
