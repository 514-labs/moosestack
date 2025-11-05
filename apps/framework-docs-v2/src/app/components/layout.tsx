import type { Metadata } from "next";
import React from "react";

// Hide this page from search engines and sitemap
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function ComponentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
