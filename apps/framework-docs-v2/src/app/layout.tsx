import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import "@/styles/globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProviderWrapper } from "@/components/language-provider-wrapper";

export const metadata: Metadata = {
  title: "MooseStack Documentation",
  description: "Build data-intensive applications with MooseStack",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
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
            <LanguageProviderWrapper>{children}</LanguageProviderWrapper>
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  );
}
