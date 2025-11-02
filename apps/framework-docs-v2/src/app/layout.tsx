import type { Metadata } from "next";
import "@/styles/globals.css";
import { PagefindLoader } from "@/components/search/pagefind-loader";

export const metadata: Metadata = {
  title: "MooseStack Documentation",
  description: "Build data-intensive applications with MooseStack",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <PagefindLoader />
      </body>
    </html>
  );
}
