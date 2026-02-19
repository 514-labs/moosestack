import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import "@/styles/globals.css";
import { VercelToolbar } from "@vercel/toolbar/next";
import { Apollo } from "@/components/apollo";
import { CommonRoom } from "@/components/common-room";
import { ConsentBanner } from "@/components/consent-banner";
import { ConsentProvider } from "@/lib/consent-context";
import { CONSENT_COOKIE_NAME, parseConsentCookie } from "@/lib/consent-cookie";
import { LanguageProviderWrapper } from "@/components/language-provider-wrapper";
import { TopNavWithFlags } from "@/components/navigation/top-nav-with-flags";
import { ScrollRestoration } from "@/components/scroll-restoration";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";

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
  const cookieStore = await cookies();
  const initialConsent = parseConsentCookie(
    cookieStore.get(CONSENT_COOKIE_NAME)?.value,
  );
  const consentGranted = initialConsent?.analytics === true;

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ConsentProvider initialConsent={initialConsent}>
          {consentGranted && <Apollo />}
          {consentGranted && <CommonRoom />}
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
            <ConsentBanner />
          </ThemeProvider>
          {shouldInjectToolbar && <VercelToolbar />}
        </ConsentProvider>
      </body>
    </html>
  );
}
