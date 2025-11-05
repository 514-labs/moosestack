"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { analytics } from "@/lib/analytics";
import { useLanguage } from "@/hooks/use-language";

interface AnalyticsProviderProps {
  children: React.ReactNode;
}

export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  const pathname = usePathname();
  const { language } = useLanguage();

  useEffect(() => {
    // Initialize analytics on mount
    analytics.init();
  }, []);

  useEffect(() => {
    // Track page views on route change
    analytics.pageView(pathname, language);
  }, [pathname, language]);

  useEffect(() => {
    // Set up code copy tracking
    const handleCopy = (event: ClipboardEvent) => {
      const selection = document.getSelection();
      const selectedText = selection?.toString();

      if (!selectedText) return;

      // Check if the copied text is from within a code block
      const range = selection?.getRangeAt(0);
      if (!range) return;

      const container = range.commonAncestorContainer;
      const codeBlock =
        container.nodeType === Node.TEXT_NODE ?
          container.parentElement?.closest("pre code, code")
        : (container as Element)?.closest("pre code, code");

      if (codeBlock && selectedText.trim()) {
        analytics.codeCopy({
          code: selectedText,
          language,
          page: pathname,
        });
      }
    };

    document.addEventListener("copy", handleCopy);
    return () => document.removeEventListener("copy", handleCopy);
  }, [pathname, language]);

  return <>{children}</>;
}
