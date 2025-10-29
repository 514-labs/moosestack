import type { Metadata } from "next";

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
  return children;
}
