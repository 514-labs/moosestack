import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import "@/styles/globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProviderWrapper } from "@/components/language-provider-wrapper";
import { TopNavWithFlags } from "@/components/navigation/top-nav-with-flags";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { ScrollRestoration } from "@/components/scroll-restoration";
import { VercelToolbar } from "@vercel/toolbar/next";

export const metadata: Metadata = {
  title: "MooseStack Documentation",
  description: "Build data-intensive applications with MooseStack",
};

// Force dynamic to enable cookie-based flag overrides
// export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
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
                  <TopNavWithFlags />
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
