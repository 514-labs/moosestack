import type { Metadata } from "next";
import type { JSX, ReactNode } from "react";
import "./globals.css";
import { auth } from "@/auth";
import { ChatLayoutWrapper } from "@/components/layout/chat-layout-wrapper";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "TypeScript Agent Starter",
  description:
    "TypeScript agent starter with local debug identities, tenant-aware data access, MCP tools, and Moose-owned dashboard APIs.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): Promise<JSX.Element> {
  const session = await auth();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            {session ?
              <ChatLayoutWrapper>{children}</ChatLayoutWrapper>
            : children}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
